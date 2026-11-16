import type { SiteContext } from "../shared/types.ts";

// A cap on what one site can spend on the model, by the hour and by the day.
// The limit on steps per minute slows one caller down. It does not bound the
// bill: many callers, or one that changes address, each get their own
// allowance. This does. Past the cap, visitors get a fixed sentence and the
// model is not called until the hour or the day turns.
//
// A step's cost is only known once the model has answered, and steps arrive
// together. So a step is let through with the most it could cost set aside,
// and that is swapped for what it did cost when it ends. Without that, every
// step that arrived before the first one finished would pass on the same
// reading, and a burst could spend many times the limit.
//
// It is the second line of defence. The first is a spend limit set at the
// model provider, on a workspace of its own, which holds even if this code is wrong.
//
// The arithmetic is here, with nothing about where the numbers are kept. The
// Node server keeps them in memory (MemoryBudget below). The online server
// keeps them in a Durable Object, one per site (worker/budget.ts).

export interface Limits {
  /** US dollars a site may spend in one clock hour (UTC). */
  hour: number;
  /** US dollars a site may spend in one day (UTC). */
  day: number;
  /** Steps one visitor may take in a day. Left out, there is no such limit. */
  perCaller?: number;
}

/** Used for whatever a site and the server's settings leave out. */
export const DEFAULT_LIMITS = { hour: 2, day: 10 } as const;

export interface Gate {
  /** Whether the site may make another model call now. */
  open: boolean;
  /** Which limit closed it. */
  why?: "hour" | "day" | "caller";
}

/** Sent once each time a site passes half, four fifths and all of a limit. A step that passes two at once sends the higher. */
export interface Alert {
  window: "hour" | "day";
  level: 50 | 80 | 100;
  spent: number;
  limit: number;
}

export interface Report {
  gate: Gate;
  alerts: Alert[];
}

/**
 * The most a step could cost on the model it asks for. `cold` is with the
 * site's prompt written to the provider's cache, which every step pays until
 * the first one has finished. `warm` is with the prompt read back from it.
 */
export interface Ceiling {
  cold: number;
  warm: number;
}

/** The answer to "may this step go ahead?". When it may, `hold` names what was set aside for it. */
export interface Admission {
  gate: Gate;
  hold?: number;
}

/** A step that was let through and has not ended yet. */
interface Hold {
  id: number;
  /** When it was let through, in milliseconds. */
  at: number;
  /** What is set aside for it. */
  usd: number;
  caller: string;
}

/** What is kept for one site. */
export interface MeterState {
  /** The hour and the day the sums below belong to, like "2026-11-15T15" and "2026-11-15". */
  hour: string;
  hourSpent: number;
  day: string;
  daySpent: number;
  /** Alerts already sent in these windows, like "day:50". */
  alerted: string[];
  /** Steps taken today, by caller. Only filled in when a per-caller limit is set. */
  callers: Record<string, number>;
  /** Steps let through and not yet paid for. */
  holds: Hold[];
  /** Counts up, so each hold has a number of its own. */
  nextHold: number;
  /** When a step was last paid for, in milliseconds. The site's prompt stays ready at the provider for a while after. */
  paidAt: number;
}

export const emptyMeter = (): MeterState => ({ hour: "", hourSpent: 0, day: "", daySpent: 0, alerted: [], callers: {}, holds: [], nextHold: 1, paidAt: 0 });

const LEVELS = [50, 80, 100] as const;
/** Beyond this many callers in a day the per-caller count stops taking new ones. The site's own cap still holds. */
const MAX_CALLERS = 20_000;

/** A step that has not ended after this long never will: its server stopped. What was set aside for it is given back. */
const HOLD_MS = 2 * 60_000;
/**
 * A prompt written to the provider's cache is kept at least five minutes from
 * its last use. A site that paid for a step within four is taken to be warm.
 */
const WARM_MS = 4 * 60_000;

/** Starts a new hour or day when the clock has moved into one, and gives back what was set aside for steps that never ended. */
export function turnOver(state: MeterState, now = new Date()) {
  const stamp = now.toISOString();
  const hour = stamp.slice(0, 13);
  const day = stamp.slice(0, 10);
  if (state.hour !== hour) {
    state.hour = hour;
    state.hourSpent = 0;
    state.alerted = state.alerted.filter((sent) => !sent.startsWith("hour:"));
  }
  if (state.day !== day) {
    state.day = day;
    state.daySpent = 0;
    state.alerted = state.alerted.filter((sent) => !sent.startsWith("day:"));
    state.callers = {};
  }
  state.holds = (state.holds ?? []).filter((hold) => now.getTime() - hold.at < HOLD_MS);
  state.nextHold ??= 1;
  state.paidAt ??= 0;
}

/** Whether one more step may start: what is spent, plus what is set aside for steps under way, against each limit. */
function gateOf(state: MeterState, limits: Limits, caller: string): Gate {
  const held = state.holds.reduce((sum, hold) => sum + hold.usd, 0);
  if (state.daySpent + held >= limits.day) return { open: false, why: "day" };
  if (state.hourSpent + held >= limits.hour) return { open: false, why: "hour" };
  if (limits.perCaller) {
    const underWay = state.holds.filter((hold) => hold.caller === caller).length;
    if ((state.callers[caller] ?? 0) + underWay >= limits.perCaller) return { open: false, why: "caller" };
  }
  return { open: true };
}

/**
 * Asks whether a step may go ahead. If it may, the most it could cost is set
 * aside until `settle` is called with the `hold` this returns, so the steps
 * that arrive beside it are counted against what is left. `state` is changed
 * in place.
 */
export function admit(state: MeterState, limits: Limits, caller: string, ceiling: Ceiling, now = new Date()): Admission {
  turnOver(state, now);
  const gate = gateOf(state, limits, caller);
  if (!gate.open) return { gate };
  const at = now.getTime();
  const hold: Hold = { id: state.nextHold++, at, usd: at - state.paidAt < WARM_MS ? ceiling.warm : ceiling.cold, caller };
  state.holds.push(hold);
  return { gate, hold: hold.id };
}

/**
 * Adds what a step cost to a site's sums and gives back what was set aside for
 * it. A step that failed is settled too, with whatever it cost, which may be
 * nothing. `state` is changed in place.
 */
export function settle(state: MeterState, limits: Limits, caller: string, hold: number | undefined, usd: number, steps: number, now = new Date()): Report {
  turnOver(state, now);
  if (hold !== undefined) state.holds = state.holds.filter((held) => held.id !== hold);

  state.hourSpent += usd;
  state.daySpent += usd;
  if (usd > 0) state.paidAt = now.getTime();
  if (limits.perCaller && steps > 0 && (caller in state.callers || Object.keys(state.callers).length < MAX_CALLERS)) {
    state.callers[caller] = (state.callers[caller] ?? 0) + steps;
  }

  const alerts: Alert[] = [];
  if (usd > 0) {
    for (const window of ["hour", "day"] as const) {
      const spent = window === "hour" ? state.hourSpent : state.daySpent;
      // One step can pass more than one level. Only the highest is worth telling anyone about.
      const passed = LEVELS.filter((level) => spent >= (limits[window] * level) / 100 && !state.alerted.includes(`${window}:${level}`));
      const level = passed.pop();
      if (!level) continue;
      state.alerted.push(...LEVELS.filter((lower) => lower <= level && !state.alerted.includes(`${window}:${lower}`)).map((lower) => `${window}:${lower}`));
      alerts.push({ window, level, spent, limit: limits[window] });
    }
  }
  return { gate: gateOf(state, limits, caller), alerts };
}

/** A site's own limits, then the server's settings (HAPTIC_BUDGET_HOUR and HAPTIC_BUDGET_DAY), then the defaults. */
export function limitsFor(site: SiteContext, env: Record<string, string | undefined>): Limits {
  const dollars = (...values: unknown[]) => values.map(Number).find((value) => value > 0);
  const limits: Limits = {
    hour: dollars(site.budget?.hour, env.HAPTIC_BUDGET_HOUR) ?? DEFAULT_LIMITS.hour,
    day: dollars(site.budget?.day, env.HAPTIC_BUDGET_DAY) ?? DEFAULT_LIMITS.day,
  };
  const perCaller = Math.floor(Number(site.budget?.perCaller));
  if (perCaller > 0) limits.perCaller = perCaller;
  return limits;
}

/** An alert in words, for a log line or a message to the team. */
export function describeAlert(site: SiteContext, alert: Alert): string {
  const span = alert.window === "hour" ? "hourly" : "daily";
  const who = `${site.id}${site.name ? ` (${site.name})` : ""}`;
  if (alert.level === 100) return `Haptic: ${who} has reached its ${span} budget of $${alert.limit.toFixed(2)} and is resting until the next ${alert.window}.`;
  return `Haptic: ${who} has used ${alert.level}% of its ${span} budget ($${alert.spent.toFixed(2)} of $${alert.limit.toFixed(2)}).`;
}

/** What a host supplies so the server can keep a budget. */
export interface Budget {
  /** Asks whether a step may go ahead for a site and one of its callers. If it may, `ceiling` is set aside until the step is settled. */
  admit(site: SiteContext, caller: string, ceiling: Ceiling): Promise<Admission>;
  /** Adds what a step cost, and how many steps it was, and gives back what was set aside under `hold`. */
  settle(site: SiteContext, caller: string, hold: number | undefined, usd: number, steps: number): Promise<Report>;
}

/** Sums kept in memory, for the Node server. They start again from nothing when it restarts. */
export class MemoryBudget implements Budget {
  private readonly meters = new Map<string, MeterState>();

  constructor(
    private readonly env: Record<string, string | undefined> = {},
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private meter(site: SiteContext): MeterState {
    let state = this.meters.get(site.id);
    if (!state) this.meters.set(site.id, (state = emptyMeter()));
    return state;
  }

  async admit(site: SiteContext, caller: string, ceiling: Ceiling): Promise<Admission> {
    return admit(this.meter(site), limitsFor(site, this.env), caller, ceiling, this.clock());
  }

  async settle(site: SiteContext, caller: string, hold: number | undefined, usd: number, steps: number): Promise<Report> {
    return settle(this.meter(site), limitsFor(site, this.env), caller, hold, usd, steps, this.clock());
  }
}
