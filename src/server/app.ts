import { STREAM_TYPE, type PublicSiteConfig, type SiteContext, type SnapElement, type Snapshot, type TurnRequest } from "../shared/types.ts";
import { measureTurn, TurnError, type TurnMeasure } from "./model.ts";

// What the Haptic server answers: the widget file, each site's public
// settings, and the one endpoint the widget calls for every step of a guide.
// It is written against the web's own Request and Response, so the same code
// runs on Node (src/server/index.ts) and on a Cloudflare Worker (worker/index.ts).
// Each of those supplies the parts that differ: where sites are kept, where
// the widget file comes from, and how callers are slowed down.

export interface AppParts {
  loadSite(id: string): Promise<SiteContext | undefined>;
  /** The widget bundle, as the text of one script. */
  widget(): Promise<string>;
  /** How long browsers may keep the widget before asking again, in seconds. 0 for never. */
  widgetMaxAge: number;
  /** True when this caller has asked for too many steps lately. */
  overLimit(key: string): boolean | Promise<boolean>;
  /** Told about each finished step, for logging. Must not throw. */
  onTurn?(request: TurnRequest, measure: TurnMeasure): void;
}

const MAX_BODY_BYTES = 512 * 1024;

/** Returns the handler. It answers `undefined` for addresses that are not its own, so a host can serve other things. */
export function createApp(parts: AppParts) {
  return async function handle(request: Request, caller: string): Promise<Response | undefined> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? undefined;
    // Which origins may read a response is decided per site below. This only says the API speaks CORS.
    const cors: Record<string, string> = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, Accept", "Access-Control-Max-Age": "86400" },
      });
    }

    if (request.method === "GET" && url.pathname === "/widget.js") {
      const cache = parts.widgetMaxAge > 0 ? `public, max-age=${parts.widgetMaxAge}` : "no-store";
      return new Response(await parts.widget(), { headers: { ...cors, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": cache } });
    }

    const siteMatch = /^\/v1\/sites\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && siteMatch) {
      const site = await parts.loadSite(decodeURIComponent(siteMatch[1] ?? ""));
      if (!site) return json(404, { error: "No site with that id. Check the data-site attribute on the script tag." });
      if (!originAllowed(site, origin)) return json(403, { error: `${origin} isn't an allowed origin for this site.` });
      const config: PublicSiteConfig = { name: site.name, appearance: site.appearance };
      return json(200, config);
    }

    if (request.method === "POST" && url.pathname === "/v1/turn") {
      const turn = parseTurn(await readJson(request));
      if (!turn) return json(400, { error: "That isn't a valid turn request." });
      const site = await parts.loadSite(turn.site);
      if (!site) return json(404, { error: "No site with that id." });
      if (!originAllowed(site, origin)) return json(403, { error: `${origin} isn't an allowed origin for this site.` });
      if (await parts.overLimit(`${site.id} ${caller}`)) return json(429, { error: "Too many requests. Try again in a minute." });

      // A widget that asks for it gets the step as it forms: the control to point at first, then the whole reply.
      if ((request.headers.get("Accept") ?? "").includes(STREAM_TYPE)) return streamTurn(parts, site, turn, cors);

      try {
        const measure = await measureTurn(site, turn);
        parts.onTurn?.(turn, measure);
        return json(200, measure.reply);
      } catch (error) {
        if (!(error instanceof TurnError)) throw error;
        console.error(`turn ${site.id}: ${error.message}`);
        return json(error.status, { error: error.message });
      }
    }

    return undefined;
  };
}

/**
 * One JSON value per line. `{"target":"e12"}` goes out the moment the model has
 * named the control, and the full reply follows as the last line. The status
 * line is already sent by then, so a failure arrives as `{"error":…,"code":…}`.
 */
function streamTurn(parts: AppParts, site: SiteContext, turn: TurnRequest, cors: Record<string, string>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (value: unknown) => controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      try {
        const measure = await measureTurn(site, turn, undefined, (id) => line({ target: id }));
        parts.onTurn?.(turn, measure);
        line(measure.reply);
      } catch (error) {
        const known = error instanceof TurnError;
        console.error(`turn ${site.id}:`, known ? error.message : error);
        line({ error: known ? error.message : "Something went wrong.", code: known ? error.status : 500 });
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { ...cors, "Content-Type": STREAM_TYPE, "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/** The widget only works on origins the site lists. Requests with no Origin header (same-origin GETs, curl) pass. */
function originAllowed(site: SiteContext, origin: string | undefined): boolean {
  return !origin || site.allowedOrigins.includes(origin);
}

/** The body as JSON, or undefined when it is too big or isn't JSON. */
async function readJson(request: Request): Promise<unknown> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

// Customers' pages are untrusted input: everything is checked and capped before it reaches a prompt.

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const texts = (value: unknown, count: number, max: number): string[] =>
  Array.isArray(value) ? value.slice(0, count).map((item) => text(item, max)).filter(Boolean) : [];

export function parseTurn(body: unknown): TurnRequest | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  const snap = raw.snapshot as Record<string, unknown> | undefined;
  const goal = text(raw.goal, 300).trim();
  if (!goal || typeof raw.site !== "string" || !snap || !Array.isArray(snap.elements)) return undefined;

  const elements: SnapElement[] = [];
  for (const item of snap.elements.slice(0, 400) as Record<string, unknown>[]) {
    if (!item || !/^e\d{1,4}$/.test(text(item.id, 6))) continue;
    const element: SnapElement = { id: text(item.id, 6), role: text(item.role, 24), label: text(item.label, 80) };
    if (item.icon) element.icon = text(item.icon, 40);
    if (item.href) element.href = text(item.href, 200);
    if (item.context) element.context = text(item.context, 120);
    const state = texts(item.state, 6, 16);
    if (state.length) element.state = state;
    if (item.offscreen === "above" || item.offscreen === "below") element.offscreen = item.offscreen;
    elements.push(element);
  }
  const snapshot: Snapshot = {
    path: text(snap.path, 200),
    title: text(snap.title, 80),
    headings: texts(snap.headings, 12, 80),
    text: texts(snap.text, 300, 160),
    elements,
    truncated: snap.truncated === true,
  };
  if (typeof snap.dialog === "string") snapshot.dialog = text(snap.dialog, 60);

  const history = (Array.isArray(raw.history) ? raw.history.slice(-12) : [])
    .map((turn: Record<string, unknown>) => ({ role: turn?.role === "assistant" ? ("assistant" as const) : ("user" as const), text: text(turn?.text, 600) }))
    .filter((turn) => turn.text);

  const request: TurnRequest = { site: raw.site, goal, step: Math.min(Math.max(Number(raw.step) || 0, 0), 100), history, snapshot };
  if (raw.event) request.event = text(raw.event, 600);
  if (raw.change) request.change = text(raw.change, 2000);
  return request;
}
