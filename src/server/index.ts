import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { buildWidget, WIDGET_FILE } from "../widget/build.ts";
import { createApp } from "./app.ts";
import { describeAlert, MemoryBudget } from "./budget.ts";
import { Store } from "./db.ts";
import { labelThreshold, MemoryLearned, withLearned } from "./learned.ts";
import { SETTINGS } from "./model.ts";
import { recordTurn } from "./record.ts";
import { loadSite } from "./sites.ts";
import { newTeachToken } from "../shared/teach.ts";
import { MemoryTeachStore, NeonTeachStore } from "./teach.ts";

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
// What traffic has taught Haptic is kept in Neon when there is one, and in memory when there isn't.
// On a developer's machine one visitor is enough for a label to reach the prompt (HAPTIC_LABEL_THRESHOLD).
const threshold = labelThreshold(process.env);
const store = process.env.DATABASE_URL ? new Store(process.env.DATABASE_URL, threshold) : undefined;
const learned = new MemoryLearned();
// Teach sessions are in Neon when there is one, where the dashboard makes them. Otherwise in memory, for trying teach
// mode on this machine without the dashboard: GET /dev/teach?site=…&question=… makes one and answers with its token,
// and GET /dev/teach/steps?token=… shows what the tab sent. Only when NODE_ENV is not production.
const teach = process.env.DATABASE_URL ? new NeonTeachStore(process.env.DATABASE_URL) : new MemoryTeachStore();

const app = createApp({
  loadSite: async (id) => {
    const fromStore = await store?.loadSite(id);
    if (fromStore) return fromStore;
    const site = await loadSite(id);
    return site && withLearned(site, learned.labels(id), threshold);
  },
  widget: () => readFile(WIDGET_FILE, "utf8"),
  widgetMaxAge: process.env.NODE_ENV === "production" ? 300 : 0,
  overLimit,
  teach,
  isOff: () => process.env.HAPTIC_OFF === "1",
  localWebhooks: process.env.NODE_ENV !== "production",
  budget: new MemoryBudget(process.env),
  onAlert: (site, alert) => console.warn(describeAlert(site, alert)),
  onTurn: (request, measure, _site, origin) => {
    void recordTurn(request, measure);
    void store?.recordStep(request, measure, origin);
  },
  onCancel: (request) => void store?.cancelStep(request),
  onOutline: (site, visitor, outline) => (store ? void store.recordOutline(site, visitor, outline) : learned.record(site.id, visitor, outline)),
  onSeen: (site, origin, allowed) => void store?.seenAt(site, origin, allowed),
  onAsk: (request, _site, origin) => void store?.startGuide(request, origin),
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
    if (!response.body) return res.end();
    // Written piece by piece, so a streamed step reaches the widget as it forms.
    // If the widget hangs up first, the response is cancelled, which stops the model call.
    const reader = response.body.getReader();
    res.on("close", () => {
      if (!res.writableFinished) void reader.cancel().catch(() => {});
    });
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) break;
      res.write(value);
    }
    return res.end();
  }

  // Teach sessions made by hand, when there is no dashboard and no database (see `teach` above).
  if (req.method === "GET" && url.pathname.startsWith("/dev/teach") && teach instanceof MemoryTeachStore && process.env.NODE_ENV !== "production") {
    if (url.pathname === "/dev/teach/steps") return json(res, 200, { steps: (await teach.stepsOf(url.searchParams.get("token") ?? "")) ?? null });
    const site = url.searchParams.get("site") ?? "";
    const question = (url.searchParams.get("question") ?? "").trim().slice(0, 300);
    if (!site || !question) return json(res, 400, { error: "Give a site and a question." });
    const token = await teach.create(site, question, newTeachToken());
    return json(res, 200, { token, fragment: `#haptic-teach=${token}` });
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
