import type { SiteContext } from "../shared/types.ts";

// A cap on what one site can spend on the model, by the hour and by the day.
// The limit on steps per minute slows one caller down. It does not bound the
// bill: many callers, or one that changes address, each get their own
// allowance. This does. Past the cap, visitors get a fixed sentence and the
// model is not called until the hour or the day turns.
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
}

export const emptyMeter = (): MeterState => ({ hour: "", hourSpent: 0, day: "", daySpent: 0, alerted: [], callers: {} });

const LEVELS = [50, 80, 100] as const;
/** Beyond this many callers in a day the per-caller count stops taking new ones. The site's own cap still holds. */
const MAX_CALLERS = 20_000;

/**
 * Adds what a step cost to a site's sums, and says whether the next step may
 * go ahead. Call it with 0 and 0 to only ask. `state` is changed in place.
 */
export function meter(state: MeterState, limits: Limits, caller: string, usd: number, steps: number, now = new Date()): Report {
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

  state.hourSpent += usd;
  state.daySpent += usd;
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

  let gate: Gate = { open: true };
  if (state.daySpent >= limits.day) gate = { open: false, why: "day" };
  else if (state.hourSpent >= limits.hour) gate = { open: false, why: "hour" };
  else if (limits.perCaller && (state.callers[caller] ?? 0) >= limits.perCaller) gate = { open: false, why: "caller" };
  return { gate, alerts };
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
  /** Adds a step's cost and count for a site and one of its callers, and says whether the next step may go ahead. 0 and 0 only asks. */
  spend(site: SiteContext, caller: string, usd: number, steps: number): Promise<Report>;
}

/** Sums kept in memory, for the Node server. They start again from nothing when it restarts. */
export class MemoryBudget implements Budget {
  private readonly meters = new Map<string, MeterState>();

  constructor(
    private readonly env: Record<string, string | undefined> = {},
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async spend(site: SiteContext, caller: string, usd: number, steps: number): Promise<Report> {
    let state = this.meters.get(site.id);
    if (!state) this.meters.set(site.id, (state = emptyMeter()));
    return meter(state, limitsFor(site, this.env), caller, usd, steps, this.clock());
  }
}
