import { createApp, turnCounts, type AppParts } from "../src/server/app.ts";
import { describeAlert, meterFor, type Admission, type Ceiling, type Gate, type Limits, type Report } from "../src/server/budget.ts";
import { Store } from "../src/server/db.ts";
import { labelThreshold, networkThreshold } from "../src/server/learned.ts";
import { configure } from "../src/server/model.ts";
import type { RouteLookup } from "../src/server/routes.ts";
import { createSiteCache } from "../src/server/site-cache.ts";
import { NeonTeachStore } from "../src/server/teach.ts";
import type { SiteContext } from "../src/shared/types.ts";
import mapper from "../dist/map.txt";
import widgetActing from "../dist/widget-act.txt";
import widgetTeaching from "../dist/widget-teach.txt";
import widget from "../dist/widget.txt";

export { BudgetMeter } from "./budget.ts";

// The Haptic server as customers' browsers reach it: a Cloudflare Worker at
// widget.joinhaptic.com. It gives the same answers as the Node server in
// src/server (both run app.ts). What differs is where things are kept: sites,
// and every guide and step, are in Neon (src/server/db.ts), and the widget's three
// files (widget.js, widget-act.js for acting and widget-teach.js for teach mode) are packed into the Worker when it is built.
//
// Without the DATABASE_URL secret it still answers, from the KV store sites
// were kept in before Neon, and records nothing. A site missing from Neon is
// also looked for there, until every site has moved.
//
// The KV store also holds the off switch: a key called "off:all" stops every
// site, and "off:<site id>" stops one. `npm run site:off` and `site:on` set
// and clear them. It needs no deploy, and it works when Neon cannot be reached.

export interface Env {
  /** Sites from before Neon, under their ids, read only when a site is not in Neon. And the off switch. */
  SITES: { get(key: string, type: "json"): Promise<unknown>; get(key: string): Promise<string | null> };
  /** Neon's connection string. A secret: npx wrangler secret put DATABASE_URL */
  DATABASE_URL?: string;
  /** Slows down anyone asking for steps too fast. */
  TURN_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Slows down anyone checking teach tokens or posting taught steps too fast. TURN_LIMIT when it is not bound. */
  TEACH_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** What each site has spent on the model this hour and today. One object per site, in worker/budget.ts. */
  BUDGET?: {
    idFromName(name: string): unknown;
    get(id: unknown): {
      admit(limits: Limits, caller: string, ceiling: Ceiling): Promise<Admission>;
      settle(limits: Limits, caller: string, hold: number | undefined, usd: number, steps: number): Promise<Report>;
    };
  };
  /** US dollars a site may spend in an hour and in a day, unless the site sets its own. */
  HAPTIC_BUDGET_HOUR?: string;
  HAPTIC_BUDGET_DAY?: string;
  /** "1": every site shares one meter, held to the two limits above whatever a site sets. For the staging Worker (wrangler.staging.jsonc). */
  HAPTIC_BUDGET_SHARED?: string;
  /** A secret. When set, budget alerts are posted here as {"text": …}, the shape Slack's incoming webhooks take. */
  HAPTIC_ALERT_WEBHOOK?: string;
  HAPTIC_MODEL?: string;
  HAPTIC_EFFORT?: string;
  HAPTIC_THINKING?: string;
  HAPTIC_CACHE?: string;
  /** "log", "ask" or "off": what is done with a reply that tells the visitor to use a control and points at nothing. See src/server/check.ts. */
  HAPTIC_RECHECK?: string;
  HAPTIC_MOCK_PAUSE_MS?: string;
  HAPTIC_MOCK_USD?: string;
  /** "1" switches every site off. It takes a deploy to change, so the keys in SITES are the quicker switch. */
  HAPTIC_OFF?: string;
  /** How many different visitors must have seen a learned label before the prompt gets it. 3 unless set. */
  HAPTIC_LABEL_THRESHOLD?: string;
  /** How many different networks those visitors must have called from. 3 unless set, and never more than the visitors needed. */
  HAPTIC_NETWORK_THRESHOLD?: string;
  /** A secret, set with `wrangler secret put`. Not needed while HAPTIC_MODEL is "mock". */
  ANTHROPIC_API_KEY?: string;
  /** A secret. With it, a guide kept as finished is sent to Stripe as usage at once. Without it, the site's hourly sweep sends it. */
  STRIPE_SECRET_KEY?: string;
}

const SITE_ID = /^site_[a-z0-9_]{3,40}$/;
/**
 * Sites are kept in memory for a minute, so a change made in the dashboard
 * shows up within that the next time the widget loads on a page. A step of a
 * guide never waits on the database while a copy up to ten minutes old is
 * held: it uses that copy and the fresh one is fetched after the response.
 */
const sites = createSiteCache({ keepMs: 60_000, maxStaleMs: 10 * 60_000 });

/** One per isolate, so its note of which origins were seen lately is shared by every request. */
let store: { url: string; stripeKey: string | undefined; store: Store } | undefined;
let teachStore: { url: string; store: NeonTeachStore } | undefined;
/** Teach sessions are in Neon, beside the sites (db/migrations/0014_teach_sessions.sql). Without the database there is no teach mode. */
function teachFor(env: Env): NeonTeachStore | undefined {
  if (!env.DATABASE_URL) return undefined;
  if (teachStore?.url !== env.DATABASE_URL) teachStore = { url: env.DATABASE_URL, store: new NeonTeachStore(env.DATABASE_URL) };
  return teachStore.store;
}

function storeFor(env: Env): Store | undefined {
  if (!env.DATABASE_URL) return undefined;
  if (store?.url !== env.DATABASE_URL || store.stripeKey !== env.STRIPE_SECRET_KEY) {
    const online = { HAPTIC_LABEL_THRESHOLD: env.HAPTIC_LABEL_THRESHOLD, HAPTIC_NETWORK_THRESHOLD: env.HAPTIC_NETWORK_THRESHOLD, HAPTIC_PRODUCTION: "1" };
    const options = { labelNetworks: networkThreshold(online), stripeKey: env.STRIPE_SECRET_KEY };
    store = { url: env.DATABASE_URL, stripeKey: env.STRIPE_SECRET_KEY, store: new Store(env.DATABASE_URL, labelThreshold(online), options) };
  }
  return store.store;
}

/** Reads a site from Neon, or from the KV store for a site not yet moved. Throws when Neon failed and the KV store has no copy, so "no such site" is never concluded from a failure. */
async function readSite(env: Env, id: string): Promise<SiteContext | undefined> {
  let site: SiteContext | undefined;
  let failure: unknown;
  try {
    site = await storeFor(env)?.loadSite(id);
  } catch (error) {
    failure = error;
  }
  site ??= ((await env.SITES.get(id, "json")) as SiteContext | null) ?? undefined;
  if (!site && failure) throw failure;
  return site;
}

/** How long an answer about the off switch is trusted. The store itself can lag by up to a minute more. */
const SWITCH_KEEP_MS = 30_000;
/** How soon the store is asked again after it failed to answer. */
const SWITCH_RETRY_MS = 5_000;
/** How long a step waits for the store's answer. Past it, the read is taken as failed. */
const SWITCH_WAIT_MS = 300;
const switches = new Map<string, { at: number; off: boolean }>();

async function isOff(env: Env, id: string): Promise<boolean> {
  if (env.HAPTIC_OFF === "1") return true;
  const held = switches.get(id);
  if (held && Date.now() - held.at < SWITCH_KEEP_MS) return held.off;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${SWITCH_WAIT_MS} ms`)), SWITCH_WAIT_MS);
    });
    const [all, one] = await Promise.race([Promise.all([env.SITES.get("off:all"), env.SITES.get(`off:${id}`)]), late]);
    const off = all !== null || one !== null;
    if (switches.size > 1000) switches.clear();
    switches.set(id, { at: Date.now(), off });
    return off;
  } catch (error) {
    // The store did not answer, or not in time. Whatever was last known stands, so a blip neither
    // stops a site nor restarts one. When nothing was known the site runs: a copy of the Worker that
    // starts during an outage cannot know a site was switched off. Either way the store is asked
    // again in a few seconds and not on every step, so a store that fails slowly does not slow them all.
    console.error("Couldn't read the off switch:", error);
    const off = held?.off ?? false;
    if (switches.size > 1000) switches.clear();
    switches.set(id, { at: Date.now() - SWITCH_KEEP_MS + SWITCH_RETRY_MS, off });
    return off;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every step asks its site's budget before the model is called, because that
 * is where what the step could cost is set aside. Only a "no" is remembered,
 * and only for a few seconds: a site that has stopped does not need asking on
 * every step, and it starts again that soon after the hour or the day turns.
 */
const CLOSED_KEEP_MS = 5_000;
const closed = new Map<string, { at: number; gate: Gate }>();

function budgetFor(env: Env): AppParts["budget"] {
  const store = env.BUDGET;
  if (!store) return undefined;
  const reach = async (site: SiteContext, caller: string) => {
    const { name, limits } = meterFor(site, { HAPTIC_BUDGET_HOUR: env.HAPTIC_BUDGET_HOUR, HAPTIC_BUDGET_DAY: env.HAPTIC_BUDGET_DAY, HAPTIC_BUDGET_SHARED: env.HAPTIC_BUDGET_SHARED });
    // Callers are only told apart when the site limits each one. A caller is an IPv4 address, or the /64 an IPv6 one is
    // in (`callerKey` in src/server/learned.ts, applied by app.ts), so one home has one allowance. The site's own object
    // scrambles it before it keeps it. This copy of the Worker holds it only in memory, for a few seconds.
    const who = limits.perCaller ? caller : "";
    return { limits, who, key: `${name} ${who}`, meter: store.get(store.idFromName(name)) };
  };
  const remember = (key: string, gate: Gate) => {
    if (gate.open) return closed.delete(key);
    if (closed.size > 5000) closed.clear();
    closed.set(key, { at: Date.now(), gate });
  };
  return {
    async admit(site, caller, ceiling) {
      const { limits, who, key, meter } = await reach(site, caller);
      const held = closed.get(key);
      if (held && Date.now() - held.at < CLOSED_KEEP_MS) return { gate: held.gate };
      const admission = await meter.admit(limits, who, ceiling);
      remember(key, admission.gate);
      return admission;
    },
    async settle(site, caller, hold, usd, steps) {
      const { limits, who, key, meter } = await reach(site, caller);
      const report = await meter.settle(limits, who, hold, usd, steps);
      remember(key, report.gate);
      return report;
    },
  };
}

async function sendAlert(env: Env, text: string): Promise<void> {
  console.warn(text);
  if (!env.HAPTIC_ALERT_WEBHOOK) return;
  try {
    // "text" is what Slack reads and "content" is what Discord reads.
    await fetch(env.HAPTIC_ALERT_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }) });
  } catch (error) {
    console.error("Couldn't send an alert:", error);
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    configure({
      HAPTIC_MODEL: env.HAPTIC_MODEL,
      HAPTIC_EFFORT: env.HAPTIC_EFFORT,
      HAPTIC_THINKING: env.HAPTIC_THINKING,
      HAPTIC_CACHE: env.HAPTIC_CACHE,
      HAPTIC_RECHECK: env.HAPTIC_RECHECK,
      HAPTIC_MOCK_PAUSE_MS: env.HAPTIC_MOCK_PAUSE_MS,
      HAPTIC_MOCK_USD: env.HAPTIC_MOCK_USD,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    });
    const db = storeFor(env);
    const later = (work: Promise<void> | undefined) => work && ctx.waitUntil(work);
    const app = createApp({
      loadSite: async (id, hurry) => (SITE_ID.test(id) ? sites(id, () => readSite(env, id), hurry ? (work) => ctx.waitUntil(work) : undefined) : undefined),
      widget: async () => widget,
      widgetActing: async () => widgetActing,
      widgetTeaching: async () => widgetTeaching,
      mapper: async () => mapper,
      widgetMaxAge: 300,
      overLimit: async (key) => (env.TURN_LIMIT ? !(await env.TURN_LIMIT.limit({ key })).success : false),
      overTeachLimit: async (key) => {
        const limit = env.TEACH_LIMIT ?? env.TURN_LIMIT;
        return limit ? !(await limit.limit({ key })).success : false;
      },
      teach: teachFor(env),
      isOff: (site) => isOff(env, site.id),
      budget: budgetFor(env),
      onAlert: (site, alert) => ctx.waitUntil(sendAlert(env, describeAlert(site, alert))),
      background: (work) => ctx.waitUntil(work),
      onSeen: (site, origin, allowed) => later(db?.seenAt(site, origin, allowed)),
      onAsk: (turn, _site, origin) => later(db?.startGuide(turn, origin)),
      onTurn: (turn, measure, site, origin, route) => {
        // One line of counts per step, with nothing from the visitor or their page, so that how guides and acting go on a site can be seen.
        try {
          console.log(JSON.stringify(turnCounts(turn, measure, site)));
        } catch {
          // A line that cannot be written must not cost the visitor their step.
        }
        // And the step on the guide's record, as the dashboard shows it (src/server/db.ts).
        later(db?.recordStep(turn, measure, origin, route));
      },
      ...(db ? { findRoute: (site: SiteContext, lookup: RouteLookup) => db.findRoute(site.id, lookup) } : {}),
      onReport: (site, guide, report) => later(db?.report(site, guide, report)),
      onCancel: (turn) => later(db?.cancelStep(turn)),
      onOutline: (site, visitor, outline, network) => later(db?.recordOutline(site, visitor, outline, network)),
      ...(db ? { mapping: { allowed: (site, pass) => db.mappingAllowed(site.id, pass), save: (site, page) => db.saveMappedPage(site.id, page) } } : {}),
    });
    try {
      const response = await app(request, request.headers.get("CF-Connecting-IP") ?? "");
      if (response) return response;
      if (new URL(request.url).pathname === "/") return new Response("Haptic's widget server. The widget is at /widget.js.\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return json(404, { error: "Not found." });
    } catch (error) {
      console.error(error);
      return json(500, { error: "Something went wrong." });
    }
  },
};
