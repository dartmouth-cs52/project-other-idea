import { createApp } from "../src/server/app.ts";
import { Store } from "../src/server/db.ts";
import { configure } from "../src/server/model.ts";
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

export interface Env {
  /** Sites from before Neon, under their ids. Read only when a site is not in Neon. */
  SITES: { get(key: string, type: "json"): Promise<unknown> };
  /** Neon's connection string. A secret: npx wrangler secret put DATABASE_URL */
  DATABASE_URL?: string;
  /** Slows down anyone asking for steps too fast. */
  TURN_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  HAPTIC_MODEL?: string;
  HAPTIC_EFFORT?: string;
  HAPTIC_THINKING?: string;
  HAPTIC_MOCK_PAUSE_MS?: string;
  /** A secret, set with `wrangler secret put`. Not needed while HAPTIC_MODEL is "mock". */
  ANTHROPIC_API_KEY?: string;
}

const SITE_ID = /^site_[a-z0-9_]{3,40}$/;
/** A site is kept in memory this long, so a step does not wait on the store. A republished site shows up within it. */
const KEEP_MS = 60_000;
const kept = new Map<string, { at: number; site: SiteContext | undefined }>();

/** One per isolate, so its note of which origins were seen lately is shared by every request. */
let store: { url: string; store: Store } | undefined;
function storeFor(env: Env): Store | undefined {
  if (!env.DATABASE_URL) return undefined;
  if (store?.url !== env.DATABASE_URL) store = { url: env.DATABASE_URL, store: new Store(env.DATABASE_URL) };
  return store.store;
}

async function loadSite(env: Env, id: string): Promise<SiteContext | undefined> {
  if (!SITE_ID.test(id)) return undefined;
  const held = kept.get(id);
  if (held && Date.now() - held.at < KEEP_MS) return held.site;
  let site: SiteContext | undefined;
  try {
    site = await storeFor(env)?.loadSite(id);
  } catch (error) {
    // Neon unreachable. A site held from before is better than none.
    console.error(`Couldn't read ${id} from Neon:`, error instanceof Error ? error.message : error);
    if (held) return held.site;
  }
  site ??= ((await env.SITES.get(id, "json")) as SiteContext | null) ?? undefined;
  if (kept.size > 1000) kept.clear();
  kept.set(id, { at: Date.now(), site });
  return site;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    configure({
      HAPTIC_MODEL: env.HAPTIC_MODEL,
      HAPTIC_EFFORT: env.HAPTIC_EFFORT,
      HAPTIC_THINKING: env.HAPTIC_THINKING,
      HAPTIC_MOCK_PAUSE_MS: env.HAPTIC_MOCK_PAUSE_MS,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    });
    const db = storeFor(env);
    const later = (work: Promise<void> | undefined) => work && ctx.waitUntil(work);
    const app = createApp({
      loadSite: (id) => loadSite(env, id),
      widget: async () => widget,
      widgetMaxAge: 300,
      overLimit: async (key) => (env.TURN_LIMIT ? !(await env.TURN_LIMIT.limit({ key })).success : false),
      onSeen: (site, origin, allowed) => later(db?.seenAt(site, origin, allowed)),
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
