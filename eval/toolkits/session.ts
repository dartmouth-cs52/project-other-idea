import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type TurnReply, type TurnRequest } from "../../src/shared/types.ts";
import type { Locator, Page } from "./types.ts";

// A browser page on a toolkit's documentation site with the widget in it, the
// way eval/browser.ts puts it there: the widget's script, its settings and
// every step it asks for are answered from here, so no server and no model
// are involved. The answers are given by the checks, one step at a time.
//
// The widget comes from a checkout named on the command line, so the same
// suite can be run on another branch's widget without copying anything.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Browser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Context = any;

/** Where the widget is loaded from. Requests to it are answered here and never leave. */
const WIDGET_ORIGIN = "https://widget.joinhaptic.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Accept" };
const SITE_ID = "site_toolkits";

export const THIS_CHECKOUT = fileURLToPath(new URL("../..", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Everything put into a page, built from one checkout. */
export interface Bundles {
  checkout: string;
  commit: string;
  /** A hash of the widget as built, the same for any commit that leaves the widget alone. */
  fingerprint: string;
  widget: string;
  /** The widget's own reading of the page, exposed so each listed entry can be tied to its element. */
  probe: string;
  /** The same with its length limits lifted. Empty when the limits could not be found to lift. */
  probeAll: string;
  inpage: string;
}

/** The limits on how much of a page the widget reads, lifted for the second reading. */
const LIMITS = [/const MAX_ELEMENTS = \d+;/, /const MAX_VISITED = \d+;/];

function liftLimits(lifted: { count: number }): Plugin {
  return {
    name: "lift-limits",
    setup(builder) {
      builder.onLoad({ filter: /[\\/]src[\\/]widget[\\/]snapshot\.ts$/ }, async (args) => {
        let source = await readFile(args.path, "utf8");
        for (const limit of LIMITS) {
          if (!limit.test(source)) continue;
          source = source.replace(limit, (found) => found.replace(/\d+/, "1000000000"));
          lifted.count++;
        }
        return { contents: source, loader: "ts" };
      });
    },
  };
}

export async function bundle(checkoutGiven: string): Promise<Bundles> {
  const checkout = resolve(checkoutGiven);
  const entry = `${checkout}/src/widget/index.ts`;
  const snapshot = `${checkout}/src/widget/snapshot.ts`;
  const common = { bundle: true, format: "iife" as const, target: "es2020", legalComments: "none" as const, write: false as const };
  const probeEntry = (global: string) => ({
    contents: `import { takeSnapshot } from ${JSON.stringify(snapshot)};\nwindow.${global} = { takeSnapshot };\n`,
    resolveDir: checkout,
    loader: "ts" as const,
  });
  const lifted = { count: 0 };
  const [widget, probe, probeAll, inpage] = await Promise.all([
    build({ ...common, entryPoints: [entry], minify: true }),
    build({ ...common, stdin: probeEntry("__hapticProbe") }),
    build({ ...common, stdin: probeEntry("__hapticProbeAll"), plugins: [liftLimits(lifted)] }),
    build({ ...common, entryPoints: [`${HERE}inpage.ts`] }),
  ]);
  const text = (result: { outputFiles?: { text: string }[] }) => result.outputFiles?.[0]?.text ?? "";
  return {
    checkout,
    commit: commitOf(checkout),
    fingerprint: createHash("sha256").update(text(widget)).digest("hex").slice(0, 12),
    widget: text(widget),
    probe: text(probe),
    probeAll: lifted.count === LIMITS.length ? text(probeAll) : "",
    inpage: text(inpage),
  };
}

function commitOf(checkout: string): string {
  try {
    const head = execFileSync("git", ["-C", checkout, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const changed = execFileSync("git", ["-C", checkout, "status", "--porcelain", "--", "src/widget", "src/shared"], { encoding: "utf8" }).trim();
    return changed ? `${head} with uncommitted changes` : head;
  } catch {
    return "unknown";
  }
}

export async function launch(headed = false): Promise<Browser> {
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    throw new Error("Playwright isn't installed. Add it for this run: npm install --no-save playwright && npx playwright install chromium");
  }
  return chromium.launch({ headless: !headed });
}

/** Adds the widget's tag once the body exists, in the top window only. Built as text, as in eval/browser.ts. */
const addTag = `(() => {
  if (window.top !== window) return;
  const add = () => {
    const tag = document.createElement("script");
    tag.src = ${JSON.stringify(`${WIDGET_ORIGIN}/widget.js`)};
    tag.dataset.site = ${JSON.stringify(SITE_ID)};
    document.body.append(tag);
  };
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add);
})();`;

/** One step the widget asked for, waiting for its answer. */
export interface Turn {
  request: Omit<TurnRequest, "site">;
  at: number;
  answer: (reply: TurnReply) => void;
}

/** The steps a page has asked for, handed to the checks in order. */
class Turns {
  private waiting: Turn[] = [];
  private takers: ((turn: Turn) => void)[] = [];
  private closed = false;

  push(request: Omit<TurnRequest, "site">): Promise<TurnReply | undefined> {
    return new Promise((answered) => {
      if (this.closed) return answered(undefined);
      const turn: Turn = { request, at: Date.now(), answer: answered };
      const taker = this.takers.shift();
      if (taker) taker(turn);
      else this.waiting.push(turn);
      this.unanswered.push(answered);
    });
  }

  private unanswered: ((reply: TurnReply | undefined) => void)[] = [];

  next(timeoutMs: number): Promise<Turn | undefined> {
    const ready = this.waiting.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((done) => {
      const take = (turn: Turn) => {
        clearTimeout(timer);
        done(turn);
      };
      const timer = setTimeout(() => {
        this.takers = this.takers.filter((taker) => taker !== take);
        done(undefined);
      }, timeoutMs);
      this.takers.push(take);
    });
  }

  /** Whether a step has been asked for and not yet taken. */
  get pending(): boolean {
    return this.waiting.length > 0;
  }

  close() {
    this.closed = true;
    for (const answered of this.unanswered) answered(undefined);
  }
}

const turnsOf = new WeakMap<object, Turns>();

/** Static files kept for the length of a run, so each demo's page load does not fetch the whole site again. */
const STATIC = new Set(["script", "stylesheet", "font", "image"]);
const MAX_CACHED_BYTES = 8 * 1024 * 1024;

/**
 * A browser context for one toolkit's site. Nothing but reading leaves it:
 * every request that is not a GET is stopped, so no demo can post a form or
 * send anything, whatever is clicked.
 */
export async function newContext(browser: Browser, bundles: Bundles): Promise<Context> {
  const context = await browser.newContext({
    bypassCSP: true,
    viewport: { width: 1366, height: 800 },
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const cache = new Map<string, { status: number; headers: Record<string, string>; body: Buffer }>();
  await context.route("**/*", async (route: Page) => {
    const request = route.request();
    const method = request.method();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") return route.abort("blockedbyclient");
    if (method !== "GET" || !STATIC.has(request.resourceType())) return route.fallback();
    const kept = cache.get(request.url());
    if (kept) return route.fulfill(kept);
    try {
      const response = await route.fetch();
      const body: Buffer = await response.body();
      const headers: Record<string, string> = response.headers();
      if (response.status() === 200 && body.length < MAX_CACHED_BYTES) cache.set(request.url(), { status: 200, headers, body });
      return route.fulfill({ status: response.status(), headers, body });
    } catch {
      return route.fallback().catch(() => undefined);
    }
  });
  await context.addInitScript(addTag);
  await context.route(`${WIDGET_ORIGIN}/widget.js`, (route: Page) =>
    route.fulfill({ status: 200, contentType: "text/javascript", headers: CORS, body: bundles.widget }),
  );
  await context.route(`${WIDGET_ORIGIN}/v1/sites/**`, (route: Page) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ name: "", appearance: DEFAULT_APPEARANCE }) }),
  );
  await context.route(`${WIDGET_ORIGIN}/v1/turn`, async (route: Page) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    let turns: Turns | undefined;
    try {
      turns = turnsOf.get(route.request().frame().page());
    } catch {
      turns = undefined;
    }
    if (!turns) return route.abort();
    const { site: _site, ...request } = route.request().postDataJSON() as TurnRequest;
    const reply = await turns.push(request);
    if (!reply) return route.abort().catch(() => undefined);
    // The same lines the server streams: the control first, then the whole reply.
    const body = (reply.target ? JSON.stringify({ target: reply.target }) + "\n" : "") + JSON.stringify(reply) + "\n";
    await route.fulfill({ status: 200, contentType: STREAM_TYPE, headers: CORS, body }).catch(() => undefined);
  });
  return context;
}

/** A control the browser's accessibility tree says a visitor can use. */
export interface AxControl {
  handle: number;
  role: string;
  name: string;
  disabled: boolean;
  checked: boolean;
  expanded: boolean;
}

/** Roles that are a control a visitor uses, as Chrome's accessibility tree names them. */
const CONTROL_ROLES = new Set([
  "button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "combobox", "slider", "spinbutton",
  "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "DisclosureTriangle",
  "PopUpButton", "ToggleButton", "MenuListOption", "ColorWell", "Date", "DateTime", "InputTime",
]);
/** Roles that are a control only when the element takes the keyboard itself, like a calendar's day. */
const CONTROL_IF_FOCUSABLE = new Set(["gridcell", "columnheader"]);

/**
 * Gives an element its number. Built from text so that the function handed to
 * the browser carries none of this project's build helpers.
 */
const REGISTER = new Function("el", "return window.__hapticToolkit.reg(el);");

export class Session {
  readonly turns = new Turns();
  private cdp: Page;

  private constructor(
    readonly page: Page,
    private readonly bundles: Bundles,
  ) {}

  static async open(context: Context, bundles: Bundles, url: string): Promise<Session> {
    const page = await context.newPage();
    const session = new Session(page, bundles);
    turnsOf.set(page, session.turns);
    session.cdp = await context.newCDPSession(page);
    await session.cdp.send("Accessibility.enable");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("haptic-root", { state: "attached", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    return session;
  }

  async close() {
    this.turns.close();
    await this.page.close().catch(() => undefined);
  }

  /** Puts the readers into the page if a load has taken them away. */
  private async helpers() {
    const there = await this.page.evaluate("!!window.__hapticToolkit && !!window.__hapticProbe");
    if (there) return;
    await this.page.evaluate(this.bundles.probe);
    if (this.bundles.probeAll) await this.page.evaluate(this.bundles.probeAll);
    await this.page.evaluate(this.bundles.inpage);
  }

  /** Calls one of the in-page readers in inpage.ts. */
  async call<T>(name: string, ...args: unknown[]): Promise<T> {
    await this.helpers();
    return this.page.evaluate(`window.__hapticToolkit.${name}(...${JSON.stringify(args)})`);
  }

  async handleOf(locator: Locator): Promise<number> {
    await this.helpers();
    return locator.evaluate(REGISTER);
  }

  get liftedLimits(): boolean {
    return this.bundles.probeAll !== "";
  }

  /** Every control in the main page's accessibility tree, each tied to its element. */
  async axControls(): Promise<AxControl[]> {
    await this.helpers();
    const { nodes } = await this.cdp.send("Accessibility.getFullAXTree");
    const found: AxControl[] = [];
    for (const node of nodes) {
      if (node.ignored || node.backendDOMNodeId === undefined) continue;
      const role: string = node.role?.value ?? "";
      const property = (name: string) => node.properties?.find((p: { name: string }) => p.name === name)?.value?.value;
      if (!CONTROL_ROLES.has(role) && !(CONTROL_IF_FOCUSABLE.has(role) && property("focusable") === true)) continue;
      try {
        const { object } = await this.cdp.send("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId });
        const { result } = await this.cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: "function () { return this.nodeType === 1 ? window.__hapticToolkit.reg(this) : -1; }",
          returnByValue: true,
        });
        await this.cdp.send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => undefined);
        if (typeof result.value !== "number" || result.value < 0) continue;
        found.push({
          handle: result.value,
          role,
          name: String(node.name?.value ?? "").trim(),
          disabled: property("disabled") === true,
          checked: property("checked") === "true",
          expanded: property("expanded") === true,
        });
      } catch {
        // The node went away while it was being read.
      }
    }
    return found;
  }

  // A visitor's hands -------------------------------------------------------

  async clickAt(x: number, y: number) {
    await this.page.mouse.move(x, y, { steps: 6 });
    await this.page.waitForTimeout(120);
    await this.page.mouse.down();
    await this.page.waitForTimeout(60);
    await this.page.mouse.up();
  }

  async drag(x: number, y: number, by: [number, number]) {
    await this.page.mouse.move(x, y, { steps: 6 });
    await this.page.mouse.down();
    await this.page.mouse.move(x + by[0], y + by[1], { steps: 12 });
    await this.page.mouse.up();
  }

  async typeKeys(text: string) {
    await this.page.keyboard.type(text, { delay: 70 });
  }

  async press(key: string) {
    await this.page.keyboard.press(key);
    await this.page.waitForTimeout(150);
  }

  /**
   * Asks Haptic a question the way a visitor does: a click on its button, the
   * question typed key by key, and Enter. Says whether the keys reached its box.
   */
  async ask(question: string, afterOpening?: () => Promise<void>): Promise<{ typed: boolean; why?: string }> {
    let haptic = await this.call<HapticState>("haptic");
    if (!haptic.launcher) return { typed: false, why: "Haptic's button is not on the page" };
    const notes: string[] = [];
    if (!haptic.open) {
      await this.clickAt(haptic.launcher.x, haptic.launcher.y);
      await this.page.waitForTimeout(300);
      haptic = await this.call<HapticState>("haptic");
    }
    await afterOpening?.();
    if (!haptic.open) {
      // A visitor whose click did nothing clicks again, once Haptic's button is back where they can see it.
      if (!haptic.there) {
        notes.push("Haptic's own element left the page when its button was clicked (it had been inside what closed)");
        for (const until = Date.now() + 2000; !haptic.there && Date.now() < until; ) {
          await this.page.waitForTimeout(200);
          haptic = await this.call<HapticState>("haptic");
        }
      } else notes.push("Haptic's box did not open at the first click on its button");
      if (haptic.launcher && !haptic.open) {
        await this.clickAt(haptic.launcher.x, haptic.launcher.y);
        await this.page.waitForTimeout(300);
        haptic = await this.call<HapticState>("haptic");
      }
      if (!haptic.open) return { typed: false, why: [...notes, "it did not open at a second click either"].join("; ") };
    }
    if (!haptic.focused && haptic.input) {
      // A visitor whose cursor is not in the box clicks into it.
      notes.push("the box did not take the keyboard when it opened, so the visitor clicked into it");
      await this.clickAt(haptic.input.x, haptic.input.y);
      await this.page.waitForTimeout(200);
    }
    await this.typeKeys(question);
    haptic = await this.call<HapticState>("haptic");
    if (haptic.typed !== question) {
      notes.push(`the keys did not reach Haptic's box (it holds "${haptic.typed}", the cursor is ${haptic.focused ? "in it" : "elsewhere"})`);
      return { typed: false, why: notes.join("; ") };
    }
    await this.page.keyboard.press("Enter");
    return notes.length ? { typed: true, why: notes.join("; ") } : { typed: true };
  }
}

export interface HapticState {
  there: boolean;
  launcher?: { x: number; y: number };
  input?: { x: number; y: number };
  open: boolean;
  typed: string;
  focused: boolean;
}
