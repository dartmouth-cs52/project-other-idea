import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ask, launch, open, type Browser, type Page } from "../../eval/browser.ts";
import type { SnapElement, TurnReply, TurnRequest } from "../../src/shared/types.ts";

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
export type GuideState = "idle" | "asking" | "pointing" | "watching" | "finished";

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
  until(check: () => unknown | Promise<unknown>, what: string, ms?: number): Promise<void>;
  untilAsked(count: number, ms?: number): Promise<Asked>;
  untilState(state: GuideState, ms?: number): Promise<void>;
  ask(goal: string): Promise<void>;
  close(): Promise<void>;
}

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
export async function start(pages: string | Record<string, string>, script: Script, path = "/"): Promise<Session> {
  const served = typeof pages === "string" ? { "/": pages } : pages;
  const server: Server = createServer((request, response) => {
    const html = served[(request.url ?? "/").split(/[?#]/)[0] ?? "/"];
    if (html === undefined) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html.startsWith("<!doctype") ? html : page(html));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const requests: Asked[] = [];
  const opened = await open(await sharedBrowser(), { siteId: "site_widget_test", origin, hasTag: false, guides: [] }, path, (request) => {
    requests.push(request);
    return script(request, requests.length - 1);
  });
  const until: Session["until"] = async (check, what, ms = 8000) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
      if (await check()) return;
      await opened.page.waitForTimeout(40);
    }
    throw new Error(`Waited ${ms} ms for ${what}.`);
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
      await until(() => requests.length >= count, `question ${count} (${requests.length} asked so far)`, ms);
      return requests[count - 1]!;
    },
    untilState: async (state, ms) => {
      let seen: GuideState | undefined;
      await until(async () => (seen = await session.state()) === state, `the guide to be "${state}"`, ms).catch((error: Error) => {
        throw new Error(`${error.message} It was "${seen}".`);
      });
    },
    ask: (goal) => ask(opened.page, goal),
    close: async () => {
      await opened.close().catch(() => undefined);
      await new Promise((resolve) => server.close(resolve));
    },
  };
  return session;
}
