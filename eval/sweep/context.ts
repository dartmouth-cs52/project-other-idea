import { DEFAULT_APPEARANCE, STREAM_TYPE, type TurnRequest } from "../../src/shared/types.ts";
import { Session, type Browser, type Bundles, type Context } from "../toolkits/session.ts";
import type { Page } from "../toolkits/types.ts";
import type { LoadRecord } from "./types.ts";

// A browser context for one site, and the pages opened in it.
//
// Nothing but reading leaves the browser: every request that is not GET, HEAD
// or OPTIONS is stopped before it is sent, and counted, as eval/net.ts and the
// toolkit suite do. Service workers are not allowed to start, so none can send
// what the net does not see. Messages on a WebSocket already open are counted,
// not stopped, as in the benchmark.
//
// Haptic is put into a page the way eval/browser.ts does it: its tag is added
// once the page's HTML has been read, and the script, the site's settings and
// every step it asks for are answered here. Nothing is sent to Haptic's server.
// All loads of one site share one context, so the site sees one visitor, with
// one set of cookies, from the first load to the last.

export const WIDGET_ORIGIN = "https://widget.joinhaptic.com";
const SITE_ID = "site_sweep";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Accept" };

/** Adds the tag once the body exists, in the top window only. As in eval/browser.ts, with the tag's fate kept for the CSP check. */
const ADD_TAG = `(() => {
  if (window.top !== window) return;
  const add = () => {
    const tag = document.createElement("script");
    tag.src = ${JSON.stringify(`${WIDGET_ORIGIN}/widget.js`)};
    tag.dataset.site = ${JSON.stringify(SITE_ID)};
    tag.async = true;
    tag.addEventListener("load", () => { window.__sweepTag = "loaded"; });
    tag.addEventListener("error", () => { window.__sweepTag = "failed"; });
    window.__sweepTag = "added";
    document.body.append(tag);
  };
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add);
})();`;

/**
 * Runs before the page's own scripts on every page: counts the keys that reach
 * the window, and keeps what the browser says its Content Security Policy
 * blocked. It only listens, and never stops or changes an event.
 */
const OBSERVE = `(() => {
  if (window.top !== window) return;
  window.__sweepKeys = 0;
  window.__sweepCsp = [];
  window.addEventListener("keydown", () => { window.__sweepKeys++; });
  document.addEventListener("securitypolicyviolation", (event) => {
    if (window.__sweepCsp.length < 50) window.__sweepCsp.push({ directive: event.effectiveDirective || event.violatedDirective, blocked: String(event.blockedURI).slice(0, 120) });
  }, true);
})();`;

/** One step the widget asked for, for a page with no session: answered at once, as a guide that is over. */
const DONE = JSON.stringify({ target: null, status: "done", say: "That is all." }) + "\n";

export interface Traffic {
  stopped: Record<string, number>;
  sockets: number;
  framesSent: number;
  /** Steps the widget asked for. */
  turns: number;
}

export interface SweepContext {
  context: Context;
  bundles: Bundles;
  /** What each page sent. */
  traffic: WeakMap<Page, Traffic>;
  /** The session that answers a page's steps, for pages opened with Haptic. */
  sessions: WeakMap<Page, Session>;
}

export async function openContext(browser: Browser, bundles: Bundles, { bypassCSP }: { bypassCSP: boolean }): Promise<SweepContext> {
  const context = await browser.newContext({
    bypassCSP,
    viewport: { width: 1366, height: 800 },
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const traffic = new WeakMap<Page, Traffic>();
  const sessions = new WeakMap<Page, Session>();
  const of = (page: Page): Traffic => {
    let t = traffic.get(page);
    if (!t) traffic.set(page, (t = { stopped: {}, sockets: 0, framesSent: 0, turns: 0 }));
    return t;
  };
  const pageOf = (route: Page): Page | undefined => {
    try {
      return route.request().frame().page();
    } catch {
      return undefined;
    }
  };

  // The net first, so that the routes added after it, the widget's own, are asked before it.
  await context.route("**/*", async (route: Page) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.fallback().catch(() => undefined);
    try {
      const url = new URL(request.url());
      const page = pageOf(route);
      if (page) {
        const key = `${method} ${url.host}${url.pathname}`.slice(0, 120);
        of(page).stopped[key] = (of(page).stopped[key] ?? 0) + 1;
      }
    } catch {
      // An address that cannot be read is stopped all the same.
    }
    return route.abort("blockedbyclient").catch(() => undefined);
  });
  // Whatever else is asked of Haptic's server is answered here and never leaves.
  await context.route(`${WIDGET_ORIGIN}/**`, (route: Page) => route.fulfill({ status: 204, headers: CORS }).catch(() => undefined));
  await context.route(`${WIDGET_ORIGIN}/widget.js`, (route: Page) =>
    route.fulfill({ status: 200, contentType: "text/javascript", headers: CORS, body: bundles.widget }).catch(() => undefined),
  );
  await context.route(`${WIDGET_ORIGIN}/v1/sites/**`, (route: Page) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ name: "", appearance: DEFAULT_APPEARANCE }) }).catch(() => undefined),
  );
  await context.route(`${WIDGET_ORIGIN}/v1/turn`, async (route: Page) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS }).catch(() => undefined);
    const page = pageOf(route);
    if (page) of(page).turns++;
    const session = page && sessions.get(page);
    if (!session) return route.fulfill({ status: 200, contentType: STREAM_TYPE, headers: CORS, body: DONE }).catch(() => undefined);
    let request: Omit<TurnRequest, "site">;
    try {
      const { site: _site, ...rest } = route.request().postDataJSON() as TurnRequest;
      request = rest;
    } catch {
      return route.fulfill({ status: 200, contentType: STREAM_TYPE, headers: CORS, body: DONE }).catch(() => undefined);
    }
    const reply = await session.turns.push(request);
    if (!reply) return route.abort().catch(() => undefined);
    // The same lines the server streams: the control first, then the whole reply.
    const body = (reply.target ? JSON.stringify({ target: reply.target }) + "\n" : "") + JSON.stringify(reply) + "\n";
    await route.fulfill({ status: 200, contentType: STREAM_TYPE, headers: CORS, body }).catch(() => undefined);
  });
  await context.addInitScript(OBSERVE);
  context.on("page", (page: Page) => {
    // A page the site opens by itself, like a pop-up, is closed: only the page under test is looked at.
    page.on("popup", (popup: Page) => void popup.close().catch(() => undefined));
    page.on("websocket", (socket: Page) => {
      of(page).sockets++;
      socket.on("framesent", () => of(page).framesSent++);
    });
  });
  return { context, bundles, traffic, sessions };
}

/** Words of an error that stay the same from load to load: no numbers, no query strings. */
export function wording(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)'"]+/g, (url) => url.replace(/[?#].*$/, "").replace(/\/[0-9a-f]{8,}[^/]*/gi, "/…"))
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

/** A page being loaded, with what it says to the console kept from before its first byte. */
export interface Opened {
  page: Page;
  session?: Session;
  record: LoadRecord;
  /** The page's main response headers, lower case. */
  headers: Record<string, string>;
  /** The load did not reach the site at all: a name that does not resolve, a refused connection. */
  unreachable?: boolean;
}

function listen(page: Page, record: LoadRecord, headers: Record<string, string>) {
  const add = (list: string[], text: string) => {
    const worded = wording(text);
    if (!list.includes(worded) && list.length < 200) list.push(worded);
  };
  page.on("console", (message: Page) => {
    const type = message.type();
    const text: string = message.text();
    if (type === "warning" && text.startsWith("[Haptic]")) add(record.hapticWarnings, text);
    else if (type === "error") {
      if (text.startsWith("[Haptic]")) add(record.hapticWarnings, text);
      else add(record.errors, text);
    }
  });
  page.on("pageerror", (error: Error) => {
    const stack = error.stack ?? "";
    if (stack.includes(`${WIDGET_ORIGIN}/widget.js`)) add(record.hapticThrows, `${error.message} ${stack.split("\n").slice(1, 3).join(" ")}`);
    else add(record.errors, `uncaught: ${error.message}`);
  });
  page.on("response", async (response: Page) => {
    try {
      if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return;
      record.status = response.status();
      Object.assign(headers, await response.allHeaders());
    } catch {
      // The page went away first.
    }
  });
}

/** Errors that mean the site was not reached from here, as against reached and refusing. */
const UNREACHABLE = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_TIMED_OUT|ERR_SSL|ERR_CERT|ERR_EMPTY_RESPONSE|ERR_HTTP2/;

function emptyRecord(label: LoadRecord["label"], haptic: boolean): LoadRecord {
  return { label, haptic, status: 0, url: "", title: "", ms: 0, errors: [], hapticThrows: [], hapticWarnings: [], stopped: {}, sockets: 0, framesSent: 0 };
}

/** How long a page is given to finish its requests after its HTML is in, and then to settle. The same as the toolkit suite's session gives a page with Haptic in it, so every load waits alike. */
const NETWORK_IDLE_MS = 15_000;
const SETTLE_MS = 1500;

/**
 * Opens the site's page. With `haptic`, the tag is in it and a session from the
 * toolkit suite answers its steps; `inject` adds the tag without waiting for
 * the widget, for the CSP check, where it may never come.
 */
export async function openPage(ctx: SweepContext, url: string, label: LoadRecord["label"], mode: "plain" | "haptic" | "inject"): Promise<Opened> {
  const record = emptyRecord(label, mode !== "plain");
  const headers: Record<string, string> = {};
  const started = Date.now();
  const prepare = async (page: Page) => {
    listen(page, record, headers);
    if (mode !== "plain") await page.addInitScript(ADD_TAG);
  };
  let page: Page | undefined;
  let session: Session | undefined;
  try {
    if (mode === "haptic") {
      // The toolkit suite's session opens its own page and loads the address at once. Its page is
      // made ready here first, by standing in for the context's newPage while it opens.
      const original = ctx.context.newPage.bind(ctx.context);
      ctx.context.newPage = async () => {
        page = await original();
        await prepare(page);
        return page;
      };
      try {
        session = await Session.open(ctx.context, ctx.bundles, url);
      } finally {
        ctx.context.newPage = original;
      }
      ctx.sessions.set(session.page, session);
    } else {
      page = await ctx.context.newPage();
      await prepare(page);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
    }
    await page!.waitForTimeout(SETTLE_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    record.error = message;
    record.ms = Date.now() - started;
    if (page) {
      record.url = page.url();
      record.title = await page.title().catch(() => "");
    }
    return { page, session, record, headers, unreachable: UNREACHABLE.test(message) && !record.status };
  }
  record.ms = Date.now() - started;
  record.url = page!.url();
  record.title = (await page!.title().catch(() => "")).slice(0, 120);
  return { page: page!, session, record, headers };
}

/** Copies what the net counted for a page into its record. */
export function countTraffic(ctx: SweepContext, opened: Opened) {
  const t = ctx.traffic.get(opened.page);
  if (!t) return;
  opened.record.stopped = { ...t.stopped };
  opened.record.sockets = t.sockets;
  opened.record.framesSent = t.framesSent;
}
