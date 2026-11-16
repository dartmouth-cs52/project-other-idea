import { build } from "esbuild";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from "playwright";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type PublicSiteConfig, type SnapElement, type TurnReply, type TurnRequest } from "../../src/shared/types.ts";

// Runs the real widget in real browsers, against a small server that serves
// the test's own pages and answers each step from a script the test writes.
// The answers come back the way the real server sends them, a line at a time,
// so a test can hold the rest of a reply back while something happens on the page.
//
//   npm run test:browser                       Chromium, Firefox and WebKit
//   BROWSERS=chromium npm run test:browser     one of them
//
// The browsers come from Playwright: npx playwright install chromium firefox webkit

const root = fileURLToPath(new URL("../..", import.meta.url));
const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };

/** The engines this run covers. */
export const BROWSERS = (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",").map((name) => name.trim()).filter((name) => name in ENGINES);

let bundle: Promise<string> | undefined;
/** The widget as the script tag loads it, built once per run. Not minified, so a failure points at a readable line. */
export function widgetBundle(): Promise<string> {
  bundle ??= build({ entryPoints: [`${root}src/widget/index.ts`], bundle: true, format: "iife", target: "es2020", write: false }).then(
    (result) => result.outputFiles[0]!.text,
  );
  return bundle;
}

let snapshotCode: Promise<string> | undefined;
/** takeSnapshot on its own, as window.hapticSnapshot(ignore), for testing what a page turns into. */
export function snapshotBundle(): Promise<string> {
  snapshotCode ??= build({
    stdin: { contents: `import { takeSnapshot } from "./src/widget/snapshot.ts"; window.hapticSnapshot = (ignore) => takeSnapshot(ignore).snapshot;`, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "iife",
    target: "es2020",
    write: false,
  }).then((result) => result.outputFiles[0]!.text);
  return snapshotCode;
}

/** Shows this markup in a fresh page and returns the labels of the controls the snapshot lists. `before` runs in the page first, like a scroll. */
export async function labelsOf(tab: Page, body: string, before?: string): Promise<string[]> {
  await tab.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body>${body}</body></html>`);
  await tab.addScriptTag({ content: await snapshotBundle() });
  if (before) await tab.evaluate(before);
  return tab.evaluate(() => {
    const ours = document.getElementById("ours") ?? document.createElement("div");
    return (window as unknown as { hapticSnapshot(ignore: Element): import("../../src/shared/types.ts").Snapshot }).hapticSnapshot(ours).elements.map((element) => element.label);
  });
}

/** How the scripted server answers one step. */
export interface Answer {
  reply: TurnReply;
  /** Waits this long after naming the target, before sending the rest of the reply. */
  holdMs?: number;
}

export type Script = (request: TurnRequest, index: number) => Answer | Promise<Answer>;

export interface Harness {
  /** The server's address, like http://localhost:51234. */
  url: string;
  /** Pages by path. A path that is not here gets `fallback`, the way a single-page app's server answers. */
  pages: Map<string, string>;
  fallback?: string;
  /** Every step the widget asked for, in order. */
  turns: TurnRequest[];
  /** Steps the widget hung up on before the reply was complete. */
  hungUp: number;
  /** Everything posted to an address this server does not know, by path. */
  posts: { path: string; body: unknown }[];
  config: PublicSiteConfig;
  script: Script;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const widget = await widgetBundle();
  const harness: Harness = {
    url: "",
    pages: new Map(),
    turns: [],
    hungUp: 0,
    posts: [],
    config: { name: "Test", appearance: DEFAULT_APPEARANCE },
    script: () => ({ reply: { target: null, status: "done", say: "No script for this step." } }),
    close: async () => {},
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/widget.js") return res.writeHead(200, { "Content-Type": "text/javascript" }).end(widget);
    if (url.pathname.startsWith("/v1/sites/")) return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(harness.config));
    if (req.method === "POST" && url.pathname === "/v1/turn") {
      const request = JSON.parse(await readBody(req)) as TurnRequest;
      const index = harness.turns.push(request) - 1;
      let gone = false;
      res.on("close", () => {
        if (!res.writableFinished) {
          gone = true;
          harness.hungUp++;
        }
      });
      const answer = await harness.script(request, index);
      if (gone) return;
      res.writeHead(200, { "Content-Type": STREAM_TYPE, "Cache-Control": "no-store" });
      if (answer.reply.target) res.write(JSON.stringify({ target: answer.reply.target }) + "\n");
      if (answer.holdMs) await new Promise((resolve) => setTimeout(resolve, answer.holdMs));
      if (gone) return;
      return res.end(JSON.stringify(answer.reply) + "\n");
    }
    if (req.method === "POST") {
      const text = await readBody(req);
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Kept as text.
      }
      harness.posts.push({ path: url.pathname, body });
      return res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    }
    const page = harness.pages.get(url.pathname) ?? harness.fallback;
    if (page === undefined) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  harness.url = `http://localhost:${(server.address() as AddressInfo).port}`;
  harness.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return harness;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

/** A page with the widget's script tag at the end of its body. */
export function page(body: string, head = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>${head}</head><body>${body}<script src="/widget.js" data-site="site_test" async></script></body></html>`;
}

/** CHROMIUM_PATH runs Chromium from a browser already on the machine, where Playwright's own download isn't there. */
export async function launch(name: string): Promise<Browser> {
  const executablePath = name === "chromium" ? process.env.CHROMIUM_PATH : undefined;
  return ENGINES[name]!.launch(executablePath ? { executablePath } : {});
}

/** Opens the panel, types the question and sends it. */
export async function ask(tab: Page, question: string): Promise<void> {
  await tab.locator("haptic-root .launcher").click();
  await tab.locator("haptic-root .ask input").fill(question);
  await tab.locator("haptic-root .ask input").press("Enter");
}

/** Waits until the widget has asked for at least `count` steps. */
export async function turns(harness: Harness, count: number, timeoutMs = 8000): Promise<TurnRequest[]> {
  const started = Date.now();
  while (harness.turns.length < count) {
    if (Date.now() - started > timeoutMs) throw new Error(`Waited for step ${count}, but the widget asked for ${harness.turns.length}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return harness.turns;
}

/** The id of the element listed with this label, in a step the widget sent. Throws if it isn't listed. */
export function idOf(request: TurnRequest, label: string): string {
  const found = request.snapshot.elements.find((element: SnapElement) => element.label === label);
  if (!found) throw new Error(`"${label}" isn't in the snapshot: ${request.snapshot.elements.map((element) => element.label).join(", ")}`);
  return found.id;
}

export const point = (id: string, say = "Click it.", status: TurnReply["status"] = "continue"): Answer => ({ reply: { target: id, status, say } });
export const done = (say = "That's it."): Answer => ({ reply: { target: null, status: "done", say } });

/** How far the mark stands off the control it is drawn around. */
const MARK_GAP = 5;

/** True once the mark is drawn around the element the selector picks. It lands when the pointer does, a little after the step arrives. */
export async function markAround(tab: Page, selector: string, timeoutMs = 3000): Promise<boolean> {
  try {
    await tab.waitForFunction(
      ([selector, gap]) => {
        const host = document.querySelector("haptic-root");
        const mark = host?.shadowRoot?.querySelector<HTMLElement>(".mark");
        const target = document.querySelector(selector);
        if (!mark || mark.hidden || !target) return false;
        // Its size is read from its style, since it scales a little as it lands.
        const [left, top, width] = [mark.style.left, mark.style.top, mark.style.width].map(parseFloat) as [number, number, number];
        const b = target.getBoundingClientRect();
        return Math.abs(left + gap - b.left) < 2 && Math.abs(top + gap - b.top) < 2 && Math.abs(width - gap * 2 - b.width) < 2;
      },
      [selector, MARK_GAP] as const,
      { timeout: timeoutMs, polling: 20 },
    );
    return true;
  } catch {
    return false;
  }
}

/** What the line under the bubbles in the chat says, or "" when it is not showing. */
export function stateOf(tab: Page): Promise<string> {
  return tab.evaluate(() => {
    const state = document.querySelector("haptic-root")?.shadowRoot?.querySelector<HTMLElement>(".state");
    return !state || state.hidden ? "" : `${state.className.replace("state ", "")}: ${state.textContent?.trim()}`;
  });
}

/** True when a click at the middle of the widget part this selector picks would reach it, and not land on the page or a dialog's backdrop. */
export async function reachable(tab: Page, selector: string): Promise<boolean> {
  return tab.evaluate((selector) => {
    const host = document.querySelector("haptic-root");
    const part = host?.shadowRoot?.querySelector(selector);
    if (!host || !part) return false;
    const box = part.getBoundingClientRect();
    const hit = host.shadowRoot!.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && part.contains(hit) && !host.closest("[inert]");
  }, selector);
}
