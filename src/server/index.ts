import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { PublicSiteConfig, SiteContext, SnapElement, Snapshot, TurnRequest } from "../shared/types.ts";
import { buildWidget, WIDGET_FILE } from "../widget/build.ts";
import { MODEL, runTurn, TurnError } from "./model.ts";
import { loadSite } from "./sites.ts";

// The Haptic server: serves the widget file, each site's public settings, and
// the one endpoint the widget calls for every step of a guide.

const PORT = Number(process.env.PORT ?? 4000);
const DEMO_DIR = fileURLToPath(new URL("../../demo/", import.meta.url));
const MAX_BODY_BYTES = 512 * 1024;
const TURNS_PER_MINUTE = 30;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: "Something went wrong." });
    else res.end();
  });
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const origin = req.headers.origin;

  // Which origins may read a response is decided per site below. The preflight only says the API speaks CORS.
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/widget.js") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": process.env.NODE_ENV === "production" ? "public, max-age=300" : "no-store" });
    return res.end(await readFile(WIDGET_FILE));
  }

  const siteMatch = /^\/v1\/sites\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && siteMatch) {
    const site = await loadSite(decodeURIComponent(siteMatch[1] ?? ""));
    if (!site) return json(res, 404, { error: "No site with that id. Check the data-site attribute on the script tag." });
    if (!originAllowed(site, origin)) return json(res, 403, { error: `${origin} isn't an allowed origin for this site.` });
    const config: PublicSiteConfig = { name: site.name, appearance: site.appearance };
    return json(res, 200, config);
  }

  if (req.method === "POST" && url.pathname === "/v1/turn") {
    const request = parseTurn(await readBody(req));
    if (!request) return json(res, 400, { error: "That isn't a valid turn request." });
    const site = await loadSite(request.site);
    if (!site) return json(res, 404, { error: "No site with that id." });
    if (!originAllowed(site, origin)) return json(res, 403, { error: `${origin} isn't an allowed origin for this site.` });
    if (overLimit(`${site.id} ${req.socket.remoteAddress}`)) return json(res, 429, { error: "Too many requests. Try again in a minute." });
    try {
      return json(res, 200, await runTurn(site, request));
    } catch (error) {
      if (!(error instanceof TurnError)) throw error;
      console.error(`turn ${site.id}: ${error.message}`);
      return json(res, error.status, { error: error.message });
    }
  }

  // The demo site, for trying the widget locally.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/demo"))) {
    if (url.pathname === "/" || url.pathname === "/demo") return res.writeHead(302, { Location: "/demo/" }).end();
    const relative = normalize(url.pathname.slice("/demo/".length) || "index.html");
    if (relative.startsWith("..")) return json(res, 404, { error: "Not found." });
    const file = extname(relative) ? relative : `${relative.replace(/\/$/, "")}.html`;
    try {
      const body = await readFile(DEMO_DIR + file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      return res.end(body);
    } catch {
      return json(res, 404, { error: "Not found." });
    }
  }

  json(res, 404, { error: "Not found." });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** The widget only works on origins the site lists. Requests with no Origin header (same-origin GETs, curl) pass. */
function originAllowed(site: SiteContext, origin: string | undefined): boolean {
  return !origin || site.allowedOrigins.includes(origin);
}

const turnTimes = new Map<string, number[]>();

function overLimit(key: string): boolean {
  const now = Date.now();
  const recent = (turnTimes.get(key) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  turnTimes.set(key, recent);
  if (turnTimes.size > 10_000) turnTimes.clear();
  return recent.length > TURNS_PER_MINUTE;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

// Customers' pages are untrusted input: everything is checked and capped before it reaches a prompt.

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const texts = (value: unknown, count: number, max: number): string[] =>
  Array.isArray(value) ? value.slice(0, count).map((item) => text(item, max)).filter(Boolean) : [];

function parseTurn(body: unknown): TurnRequest | undefined {
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

console.log(`Built the widget (${((await buildWidget()) / 1024).toFixed(1)} KB)`);
server.listen(PORT, () => console.log(`Haptic is running on http://localhost:${PORT} with model ${MODEL}. Demo: http://localhost:${PORT}/demo/`));
