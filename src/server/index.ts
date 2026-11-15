import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { buildWidget, WIDGET_FILE } from "../widget/build.ts";
import { createApp } from "./app.ts";
import { Store } from "./db.ts";
import { SETTINGS } from "./model.ts";
import { recordTurn } from "./record.ts";
import { loadSite } from "./sites.ts";

// The Haptic server on Node, for running on your own machine: the answers in
// app.ts, with sites kept as files, plus the demo site to try the widget on.
// The copy that customers' browsers reach is the Worker in worker/index.ts.

const PORT = Number(process.env.PORT ?? 4000);
const DEMO_DIR = fileURLToPath(new URL("../../demo/", import.meta.url));
const TURNS_PER_MINUTE = 30;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

const turnTimes = new Map<string, number[]>();

function overLimit(key: string): boolean {
  const now = Date.now();
  const recent = (turnTimes.get(key) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  turnTimes.set(key, recent);
  if (turnTimes.size > 10_000) turnTimes.clear();
  return recent.length > TURNS_PER_MINUTE;
}

// With DATABASE_URL set, sites come from Neon as they do online (falling back
// to data/sites), and guides and steps are recorded there for the dashboard.
const store = process.env.DATABASE_URL ? new Store(process.env.DATABASE_URL) : undefined;

const app = createApp({
  loadSite: async (id) => (await store?.loadSite(id)) ?? loadSite(id),
  widget: () => readFile(WIDGET_FILE, "utf8"),
  widgetMaxAge: process.env.NODE_ENV === "production" ? 300 : 0,
  overLimit,
  onTurn: (request, measure, _site, origin) => {
    void recordTurn(request, measure);
    void store?.recordStep(request, measure, origin);
  },
  onSeen: (site, origin, allowed) => void store?.seenAt(site, origin, allowed),
  onReport: (site, guide, report) => void store?.report(site, guide, report),
});

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: "Something went wrong." });
    else res.end();
  });
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value] as [string, string]])),
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
  } as RequestInit);

  const response = await app(request, req.socket.remoteAddress ?? "");
  if (response) {
    res.writeHead(response.status, Object.fromEntries(response.headers));
    // Written piece by piece, so a streamed step reaches the widget as it forms.
    if (response.body) for await (const chunk of response.body) res.write(chunk);
    return res.end();
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

console.log(`Built the widget (${((await buildWidget()) / 1024).toFixed(1)} KB)`);
server.listen(PORT, () => console.log(`Haptic is running on http://localhost:${PORT} with model ${SETTINGS.model}. Demo: http://localhost:${PORT}/demo/`));
