import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ask, launch, open, type Browser, type Page } from "../../eval/browser.ts";
import { DEFAULT_APPEARANCE, type PublicSiteConfig, type SnapElement, type TurnReply, type TurnRequest } from "../../src/shared/types.ts";

// What the widget's browser tests share: small pages served from this
// machine, the real widget put on them, and a model whose answers the test
// writes. No model is called and nothing leaves the machine.
//
// They need Playwright and its browser, which this project does not install:
//   npm install --no-save playwright && npx playwright install chromium
// Run them with: npm run test:widget

export type Asked = Omit<TurnRequest, "site">;
/** Gives the reply to the nth question the widget asks, counting from 0. */
export type Script = (request: Asked, index: number) => TurnReply | Promise<TurnReply>;
export type GuideState = "idle" | "asking" | "pointing" | "watching" | "acting" | "paused" | "finished";

/** The id a request's list gives the control with this label, and this role when one is named. */
export function idOf(request: Asked, label: string, role?: string): string {
  const found = request.snapshot.elements.find((element: SnapElement) => element.label === label && (!role || element.role === role));
  if (!found) throw new Error(`Nothing is listed as "${label}". Listed: ${request.snapshot.elements.map((element) => `${element.role} "${element.label}"`).join(", ")}`);
  return found.id;
}

export const point = (request: Asked, label: string, say: string, status: TurnReply["status"] = "continue"): TurnReply => ({ target: idOf(request, label), status, say });
export const words = (say: string, status: TurnReply["status"] = "done"): TurnReply => ({ target: null, status, say });

export interface Session {
  page: Page;
  /** Every question the widget has asked, in order. */
  requests: Asked[];
  origin: string;
  /** The widget's own account of where the guide is. */
  state(): Promise<GuideState | undefined>;
  /** The sentence on show, or "" when none is. */
  caption(): Promise<string>;
  /** The id attribute, or the tag, of what the pointer is on. Null when it is on nothing. */
  pointed(): Promise<string | null>;
  /** Waits until `check` holds, and fails with `what` if it never does. */
  until(check: () => unknown | Promise<unknown>, what: string | (() => string), ms?: number): Promise<void>;
  untilAsked(count: number, ms?: number): Promise<Asked>;
  untilState(state: GuideState, ms?: number): Promise<void>;
  /**
   * Asks a question as a visitor does: Enter, or with `act` the Do it button,
   * and Go when the first-use line shows, unless `go` is false.
   */
  ask(goal: string, how?: { act?: boolean; go?: boolean }): Promise<void>;
  /** The status line of the ask box, or "" when it is hidden. */
  status(): Promise<string>;
  /** The lines of "What I did" on show, as "name: value" with any aside, and its closing line. Empty when hidden. */
  did(): Promise<{ lines: string[]; closing: string }>;
  close(): Promise<void>;
}

/** What a test page's site says about acting, as the server sends it: on, with nothing else set. */
export const ACTING_ON: NonNullable<PublicSiteConfig["acting"]> = { maxActions: 25, confirmFirst: true };

let browser: Promise<Browser> | undefined;
/** One browser for every test in a file. */
export function sharedBrowser(): Promise<Browser> {
  browser ??= launch();
  return browser;
}
export async function closeBrowser(): Promise<void> {
  if (browser) await (await browser).close().catch(() => undefined);
  browser = undefined;
}

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Test page</title><style>body{font:14px system-ui;margin:24px}</style></head><body>${body}</body></html>`;

/**
 * Opens a local page with the widget on it. `pages` maps a path to the HTML
 * of its body, or to a whole document when it starts with "<!doctype".
 */
export async function start(
  pages: string | Record<string, string>,
  script: Script,
  path = "/",
  settings: { acting?: PublicSiteConfig["acting"]; appearance?: Partial<PublicSiteConfig["appearance"]>; present?: boolean; suggestions?: PublicSiteConfig["suggestions"] } = {},
): Promise<Session> {
  const served = typeof pages === "string" ? { "/": pages } : pages;
  // The tag as a page that asks for presentation mode writes it: data-present="1", there before the widget's script runs.
  const presenting = settings.present
    ? `<script>new MutationObserver((records) => { for (const record of records) for (const node of record.addedNodes) if (node.dataset && node.dataset.site) node.dataset.present = "1"; }).observe(document.body, { childList: true });</script>`
    : "";
  const server: Server = createServer((request, response) => {
    const asked = (request.url ?? "/").split(/[?#]/)[0] ?? "/";
    // "/data/<ms>" answers after that many milliseconds, for pages that fetch what they show.
    const slow = /^\/data\/(\d+)$/.exec(asked);
    if (slow) {
      setTimeout(() => response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ rows: ["Alpha", "Beta", "Gamma"] })), Number(slow[1]));
      return;
    }
    const html = served[asked];
    if (html === undefined) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html.startsWith("<!doctype") ? html : page(presenting + html));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const requests: Asked[] = [];
  const opened = await open(
    await sharedBrowser(),
    { siteId: "site_widget_test", origin, hasTag: false, guides: [] },
    path,
    (request) => {
      requests.push(request);
      return script(request, requests.length - 1);
    },
    undefined,
    {
      ...(settings.acting ? { acting: settings.acting } : {}),
      ...(settings.appearance ? { appearance: { ...DEFAULT_APPEARANCE, ...settings.appearance } } : {}),
      ...(settings.suggestions ? { suggestions: settings.suggestions } : {}),
    },
  );
  const until: Session["until"] = async (check, what, ms = 8000) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
      if (await check()) return;
      await opened.page.waitForTimeout(40);
    }
    throw new Error(`Waited ${ms} ms for ${typeof what === "function" ? what() : what}.`);
  };
  const session: Session = {
    page: opened.page,
    requests,
    origin,
    state: () => opened.page.evaluate(() => (document.querySelector("haptic-root") as (Element & { guideState?: GuideState }) | null)?.guideState),
    caption: () =>
      opened.page.evaluate(() => {
        const caption = document.querySelector("haptic-root")?.shadowRoot?.querySelector(".caption") as HTMLElement | null;
        return caption && !caption.hidden ? (caption.querySelector("span")?.textContent ?? "") : "";
      }),
    pointed: () =>
      opened.page.evaluate(() => {
        const el = (document.querySelector("haptic-root") as (Element & { pointedAt?: Element }) | null)?.pointedAt;
        return el ? el.id || el.tagName.toLowerCase() : null;
      }),
    until,
    untilAsked: async (count, ms) => {
      await until(() => requests.length >= count, () => `question ${count} (${requests.length} asked so far)`, ms);
      return requests[count - 1]!;
    },
    untilState: async (state, ms) => {
      let seen: GuideState | undefined;
      await until(async () => (seen = await session.state()) === state, `the guide to be "${state}"`, ms).catch((error: Error) => {
        throw new Error(`${error.message} It was "${seen}".`);
      });
    },
    ask: async (goal, how = {}) => {
      if (!how.act) return ask(opened.page, goal);
      const page = opened.page;
      // A guide that ended leaves the ask box open when it asks whether it helped.
      if (!(await page.locator("haptic-root .panel").isVisible())) await page.locator("haptic-root .launcher").click();
      await page.locator("haptic-root .ask textarea").fill(goal);
      await page.locator("haptic-root .panel .doit").click();
      const go = page.locator("haptic-root .panel .first .go");
      if (how.go !== false && (await go.isVisible())) await go.click();
    },
    status: () =>
      opened.page.evaluate(() => {
        const status = document.querySelector("haptic-root")?.shadowRoot?.querySelector(".status") as HTMLElement | null;
        return status && !status.hidden ? (status.querySelector("span")?.textContent ?? "") : "";
      }),
    did: () =>
      opened.page.evaluate(() => {
        const did = document.querySelector("haptic-root")?.shadowRoot?.querySelector(".did") as HTMLElement | null;
        if (!did || did.hidden) return { lines: [], closing: "" };
        const lines = Array.from(did.querySelectorAll(".line")).map((line) => {
          const [name, value, aside] = [".name", ".value", ".mine"].map((part) => line.querySelector(part)?.textContent ?? "");
          return `${name}: ${value}${aside ? ` (${aside})` : ""}`;
        });
        return { lines, closing: did.querySelector("p")?.textContent ?? "" };
      }),
    close: async () => {
      await opened.close().catch(() => undefined);
      await new Promise((resolve) => server.close(resolve));
    },
  };
  return session;
}
