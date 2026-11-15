import { createApp } from "../src/server/app.ts";
import { Store } from "../src/server/db.ts";
import { configure } from "../src/server/model.ts";
import { createSiteCache } from "../src/server/site-cache.ts";
import type { SiteContext } from "../src/shared/types.ts";
import widget from "../dist/widget.txt";

// The Haptic server as customers' browsers reach it: a Cloudflare Worker at
// widget.joinhaptic.com. It gives the same answers as the Node server in
// src/server (both run app.ts). What differs is where things are kept: sites,
// and every guide and step, are in Neon (src/server/db.ts), and the widget file
// is packed into the Worker when it is built.
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
  HAPTIC_MODEL?: string;
  HAPTIC_EFFORT?: string;
  HAPTIC_THINKING?: string;
  HAPTIC_CACHE?: string;
  HAPTIC_MOCK_PAUSE_MS?: string;
  /** "1" switches every site off. It takes a deploy to change, so the keys in SITES are the quicker switch. */
  HAPTIC_OFF?: string;
  /** A secret, set with `wrangler secret put`. Not needed while HAPTIC_MODEL is "mock". */
  ANTHROPIC_API_KEY?: string;
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
let store: { url: string; store: Store } | undefined;
function storeFor(env: Env): Store | undefined {
  if (!env.DATABASE_URL) return undefined;
  if (store?.url !== env.DATABASE_URL) store = { url: env.DATABASE_URL, store: new Store(env.DATABASE_URL) };
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
const switches = new Map<string, { at: number; off: boolean }>();

async function isOff(env: Env, id: string): Promise<boolean> {
  if (env.HAPTIC_OFF === "1") return true;
  const held = switches.get(id);
  if (held && Date.now() - held.at < SWITCH_KEEP_MS) return held.off;
  let off = held?.off ?? false;
  try {
    const [all, one] = await Promise.all([env.SITES.get("off:all"), env.SITES.get(`off:${id}`)]);
    off = all !== null || one !== null;
  } catch (error) {
    // The store did not answer. Whatever was last known stands, so a blip neither stops a site nor restarts one.
    console.error("Couldn't read the off switch:", error);
  }
  if (switches.size > 1000) switches.clear();
  switches.set(id, { at: Date.now(), off });
  return off;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    configure({
      HAPTIC_MODEL: env.HAPTIC_MODEL,
      HAPTIC_EFFORT: env.HAPTIC_EFFORT,
      HAPTIC_THINKING: env.HAPTIC_THINKING,
      HAPTIC_CACHE: env.HAPTIC_CACHE,
      HAPTIC_MOCK_PAUSE_MS: env.HAPTIC_MOCK_PAUSE_MS,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    });
    const db = storeFor(env);
    const later = (work: Promise<void> | undefined) => work && ctx.waitUntil(work);
    const app = createApp({
      loadSite: async (id, hurry) => (SITE_ID.test(id) ? sites(id, () => readSite(env, id), hurry ? (work) => ctx.waitUntil(work) : undefined) : undefined),
      widget: async () => widget,
      widgetMaxAge: 300,
      overLimit: async (key) => (env.TURN_LIMIT ? !(await env.TURN_LIMIT.limit({ key })).success : false),
      isOff: (site) => isOff(env, site.id),
      onSeen: (site, origin, allowed) => later(db?.seenAt(site, origin, allowed)),
      onAsk: (turn, _site, origin) => later(db?.startGuide(turn, origin)),
      onTurn: (turn, measure, _site, origin) => later(db?.recordStep(turn, measure, origin)),
      onReport: (site, guide, report) => later(db?.report(site, guide, report)),
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
