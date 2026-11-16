import { createApp, turnCounts } from "../src/server/app.ts";
import { configure } from "../src/server/model.ts";
import type { SiteContext } from "../src/shared/types.ts";
import widget from "../dist/widget.txt";

// The Haptic server as customers' browsers reach it: a Cloudflare Worker at
// widget.joinhaptic.com. It gives the same answers as the Node server in
// src/server (both run app.ts). What differs is where things are kept: each
// site's context is in a KV store, written by `npm run site:publish`, and the
// widget file is packed into the Worker when it is built.

export interface Env {
  /** Each site's context, under its id. */
  SITES: { get(key: string, type: "json"): Promise<unknown> };
  /** Slows down anyone asking for steps too fast. */
  TURN_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  HAPTIC_MODEL?: string;
  HAPTIC_EFFORT?: string;
  HAPTIC_THINKING?: string;
  /** "log", "ask" or "off": what is done with a reply that tells the visitor to use a control and points at nothing. See src/server/check.ts. */
  HAPTIC_RECHECK?: string;
  HAPTIC_MOCK_PAUSE_MS?: string;
  /** A secret, set with `wrangler secret put`. Not needed while HAPTIC_MODEL is "mock". */
  ANTHROPIC_API_KEY?: string;
}

const SITE_ID = /^site_[a-z0-9_]{3,40}$/;
/** A site is kept in memory this long, so a step does not wait on the store. A republished site shows up within it. */
const KEEP_MS = 60_000;
const kept = new Map<string, { at: number; site: SiteContext | undefined }>();

async function loadSite(env: Env, id: string): Promise<SiteContext | undefined> {
  if (!SITE_ID.test(id)) return undefined;
  const held = kept.get(id);
  if (held && Date.now() - held.at < KEEP_MS) return held.site;
  const site = ((await env.SITES.get(id, "json")) as SiteContext | null) ?? undefined;
  if (kept.size > 1000) kept.clear();
  kept.set(id, { at: Date.now(), site });
  return site;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    configure({
      HAPTIC_MODEL: env.HAPTIC_MODEL,
      HAPTIC_EFFORT: env.HAPTIC_EFFORT,
      HAPTIC_THINKING: env.HAPTIC_THINKING,
      HAPTIC_RECHECK: env.HAPTIC_RECHECK,
      HAPTIC_MOCK_PAUSE_MS: env.HAPTIC_MOCK_PAUSE_MS,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    });
    const app = createApp({
      loadSite: (id) => loadSite(env, id),
      widget: async () => widget,
      widgetMaxAge: 300,
      overLimit: async (key) => (env.TURN_LIMIT ? !(await env.TURN_LIMIT.limit({ key })).success : false),
      // One line of counts per step, with nothing from the visitor or their page, so that how guides and acting go on a site can be seen.
      onTurn: (turn, measure) => {
        try {
          console.log(JSON.stringify(turnCounts(turn, measure)));
        } catch {
          // A line that cannot be written must not cost the visitor their step.
        }
      },
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
