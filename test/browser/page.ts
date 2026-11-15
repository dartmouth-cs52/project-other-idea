import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type Snapshot, type TurnReply, type TurnRequest } from "../../src/shared/types.ts";
import { bundleWidget } from "../../src/widget/build.ts";

// What the browser tests share: a real browser, and a way to read a small page
// the way the widget reads it. The page is given as HTML and served to the
// browser from here, so nothing leaves this machine.
//
// These tests need Playwright and its browser, which this project does not
// install. Where either is missing every test is skipped, so the command never
// fails for want of a browser: npm install --no-save playwright && npx playwright install chromium

// Playwright is loaded by name at run time so that the project neither depends on it nor type-checks against it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/** The address the test pages are served at. It is never looked up: every request to it is answered here. */
export const ORIGIN = "http://haptic.test";

const SNAPSHOT_SOURCE = fileURLToPath(new URL("../../src/widget/snapshot.ts", import.meta.url));

export interface Browser {
  /** The page as the widget would list it. */
  read: (html: string, options?: ReadOptions) => Promise<Snapshot>;
  /** The page with the whole widget on it, as a customer's page would have it, and every step it asks for answered by `answer`. */
  widget: (html: string, answer: (request: TurnRequest, index: number) => TurnReply) => Promise<WidgetPage>;
  close: () => Promise<void>;
}

export interface WidgetPage {
  page: Loose;
  /** Every request for a step the widget has sent so far, exactly as it was sent. */
  sent: string[];
  /** Types a question into the widget and waits for it to be sent. */
  ask: (question: string) => Promise<void>;
  /** Waits until the widget has sent this many requests. */
  waitFor: (count: number) => Promise<void>;
  close: () => Promise<void>;
}

export interface ReadOptions {
  /** The visitor's question. */
  goal?: string;
  /** The path the page is served at. */
  path?: string;
  /** Something to do on the page before it is read, like opening a list. */
  before?: (page: Loose) => Promise<void>;
  /** Stylesheets the page links to: by path when on the page's own site, by whole address when on another. */
  styles?: Record<string, string>;
}

/** A browser to read pages in, or the reason there is none. */
export async function startBrowser(): Promise<Browser | string> {
  let browser: Loose;
  try {
    browser = await createRequire(import.meta.url)("playwright").chromium.launch();
  } catch (error) {
    return `No browser to test in: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`;
  }
  // The same code the widget ships, with the function that reads a page left where a test can call it.
  const bundle = await build({ entryPoints: [SNAPSHOT_SOURCE], bundle: true, format: "iife", globalName: "HapticSnapshot", target: "es2020", write: false });
  const script = bundle.outputFiles[0]?.text ?? "";

  return {
    read: async (html, options = {}) => {
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      try {
        await context.route("**/*", (route: Loose) => {
          const url = new URL(route.request().url());
          // A stylesheet is given by its path on this site, or by its whole address when it is on another.
          const style = options.styles?.[url.origin === ORIGIN ? url.pathname : url.href];
          if (style !== undefined) return route.fulfill({ status: 200, contentType: "text/css", body: style });
          if (url.origin !== ORIGIN) return route.fulfill({ status: 404, body: "" });
          return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>Test page</title>${html}` });
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(ORIGIN + (options.path ?? "/page"));
        await page.addScriptTag({ content: script });
        await options.before?.(page);
        const snapshot = (await page.evaluate((goal: string) => {
          // Haptic's own element, when the page has one, is what the widget would pass in.
          const host = document.querySelector("haptic-root") ?? document.createElement("haptic-root");
          return (globalThis as Loose).HapticSnapshot.takeSnapshot(host, goal).snapshot;
        }, options.goal ?? "")) as Snapshot;
        if (errors.length) throw new Error(`The page reported an error: ${errors.join("; ")}`);
        return snapshot;
      } finally {
        await context.close();
      }
    },
    widget: async (html, answer) => {
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Accept" };
      const sent: string[] = [];
      widgetScript ??= bundleWidget();
      const source = await widgetScript;
      await context.route(`${ORIGIN}/**`, (route: Loose) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        if (path === "/widget.js") return route.fulfill({ status: 200, contentType: "text/javascript", headers: cors, body: source });
        if (path.startsWith("/v1/sites/")) return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ name: "", appearance: DEFAULT_APPEARANCE }) });
        if (path === "/v1/turn") {
          const body = request.postData() ?? "";
          sent.push(body);
          const reply = answer(JSON.parse(body) as TurnRequest, sent.length - 1);
          return route.fulfill({ status: 200, contentType: STREAM_TYPE, headers: cors, body: JSON.stringify(reply) + "\n" });
        }
        return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>Test page</title>${html}<script src="${ORIGIN}/widget.js" data-site="site_test"></script>` });
      });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/page`);
      await page.waitForSelector("haptic-root", { state: "attached" });
      const waitFor = async (count: number) => {
        for (const until = Date.now() + 10_000; sent.length < count; ) {
          if (Date.now() > until) throw new Error(`The widget sent ${sent.length} requests, and ${count} were expected.`);
          await page.waitForTimeout(50);
        }
      };
      return {
        page,
        sent,
        waitFor,
        ask: async (question) => {
          const before = sent.length;
          await page.locator("haptic-root .launcher").click();
          await page.locator("haptic-root .panel input").fill(question);
          await page.locator("haptic-root .panel input").press("Enter");
          await waitFor(before + 1);
        },
        close: () => context.close(),
      };
    },
    close: () => browser.close(),
  };
}

let widgetScript: Promise<string> | undefined;

/** One listed control written the way the server writes it for the model, without its id. */
export function line(element: Snapshot["elements"][number]): string {
  let text = element.role;
  if (element.label) text += ` "${element.label}"`;
  if (element.icon) text += ` icon:${element.icon}`;
  if (element.state?.length) text += ` (${element.state.join(", ")})`;
  if (element.context) text += ` [${element.context}]`;
  if (element.options?.length) text += ` choices: ${element.options.join(" | ")}`;
  if (element.href) text += ` → ${element.href}`;
  if (element.offscreen) text += ` ${element.offscreen} the visible area`;
  return text;
}

/** Every listed control, one line each. */
export const lines = (snapshot: Snapshot): string[] => snapshot.elements.map(line);
