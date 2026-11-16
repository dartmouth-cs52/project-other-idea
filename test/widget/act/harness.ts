import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import type { Page } from "../../../eval/browser.ts";
import { sharedBrowser } from "../harness.ts";
import type { Spec, Summary } from "./driver.ts";

// Pages for the acting engine's tests: small local pages with the engine on
// them, driven step by step from the test. No widget, no server and no model:
// a test gives the step the gate would have planned, and reads back how it
// ended and what state the page is in.
//
// The engine is built here with two changes made only to this build:
// - src/widget/gate.ts is replaced by stub-gate.ts, which allows everything,
//   so that the engine is tested apart from the gate's rules (DESIGN 8.2).
// - src/widget/guide.ts exports its hearing, `waitForAction`, so that each
//   step is heard the way the guide will hear it.
//
// Some pages are built from the real libraries (React, Radix, cmdk). Those
// are not dependencies of this project; they are looked for in node_modules,
// or in the folder HAPTIC_FIXTURE_MODULES names, and the tests that need them
// are skipped when they are not there:
//   npm install --no-save react@19 react-dom@19 radix-ui@1 cmdk@1

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WIDGET = `${ROOT}src/widget/`;

const testBuild: Plugin = {
  name: "act-test",
  setup(builder) {
    builder.onResolve({ filter: /^\.\/gate\.ts$/ }, (args) => (args.importer.startsWith(WIDGET) ? { path: `${HERE}stub-gate.ts` } : undefined));
    builder.onLoad({ filter: /[\\/]src[\\/]widget[\\/]guide\.ts$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const hears = /\nfunction waitForAction\(/.test(source);
      return { contents: hears ? `${source}\nexport { waitForAction };\n` : source, loader: "ts" };
    });
  },
};

let engine: Promise<string> | undefined;
/** The engine as these tests build it, with the stub gate and the guide's hearing, as one script for a page. */
export function engineBundle(): Promise<string> {
  engine ??= build({ entryPoints: [`${HERE}driver.ts`], bundle: true, format: "iife", target: "es2020", write: false, plugins: [testBuild] }).then((result) => result.outputFiles[0]?.text ?? "");
  return engine;
}

/** Where the real libraries are, if they are anywhere. */
export const LIBRARIES = [process.env.HAPTIC_FIXTURE_MODULES, `${ROOT}node_modules`].find((dir) => dir && ["react", "react-dom", "radix-ui", "cmdk"].every((name) => existsSync(`${dir}/${name}/package.json`)));

const libraries = new Map<string, Promise<string>>();
/** A fixture page's script, built from fixtures/<name>.jsx with the real libraries. */
function libraryBundle(name: string): Promise<string> {
  let built = libraries.get(name);
  if (!built) {
    if (!LIBRARIES) throw new Error("The real libraries are not installed; see harness.ts.");
    built = build({
      entryPoints: [`${HERE}fixtures/${name}.jsx`],
      bundle: true,
      format: "iife",
      target: "es2020",
      jsx: "automatic",
      nodePaths: [LIBRARIES],
      define: { "process.env.NODE_ENV": '"production"' },
      write: false,
      logLevel: "silent",
    }).then((result) => result.outputFiles[0]?.text ?? "");
    libraries.set(name, built);
  }
  return built;
}

export interface ActPage {
  page: Page;
  origin: string;
  /** Runs one step with the engine and gives back how it ended. */
  run(spec: Spec): Promise<Summary>;
  /** Starts counting the events that reach anything the selector matches. */
  watch(selector: string): Promise<void>;
  counted(selector: string): Promise<Record<string, number>>;
  /** The text of the first element the selector matches, or "" when there is none. */
  text(selector: string): Promise<string>;
  /** What the gate stub was asked, as [function, element id or tag, key]. */
  gateCalls(): Promise<[string, string, string?][]>;
  close(): Promise<void>;
}

const wrap = (body: string, script = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test page</title><style>body{font:14px system-ui;margin:24px}</style><script src="/act.js"></script></head><body>${body}${script}</body></html>`;

/**
 * Opens a local page with the engine on it. `pages` maps a path to the HTML
 * of its body. `library` names a fixture in fixtures/ built with the real
 * libraries, whose script is added to the end of the body.
 */
export async function openPage(pages: string | Record<string, string>, { library, path = "/" }: { library?: string; path?: string } = {}): Promise<ActPage> {
  const served = typeof pages === "string" ? { "/": pages } : pages;
  const script = await engineBundle();
  const lib = library ? await libraryBundle(library) : "";
  const server: Server = createServer((request, response) => {
    const asked = (request.url ?? "/").split(/[?#]/)[0] ?? "/";
    if (asked === "/act.js") return void response.writeHead(200, { "Content-Type": "text/javascript" }).end(script);
    if (asked === "/lib.js") return void response.writeHead(200, { "Content-Type": "text/javascript" }).end(lib);
    // A form sent by the page: answered, so that a test can see whether one was sent at all.
    if (request.method !== "GET") return void response.writeHead(200, { "Content-Type": "text/html" }).end(wrap(`<h1>Sent</h1>`));
    const html = served[asked];
    if (html === undefined) return void response.writeHead(404).end("Not found");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(wrap(html, library ? `<script src="/lib.js"></script>` : ""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await (await sharedBrowser()).newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("pageerror", (error: Error) => console.warn(`[page] ${error.message}`));
  await page.goto(`${origin}${path}`);
  await page.waitForFunction("!!window.__act");
  return {
    page,
    origin,
    run: (spec) => page.evaluate((given: Spec) => (window as unknown as { __act: { run(spec: Spec): Promise<Summary> } }).__act.run(given), spec),
    watch: (selector) => page.evaluate((given: string) => (window as unknown as { __act: { watch(s: string): void } }).__act.watch(given), selector),
    counted: (selector) => page.evaluate((given: string) => (window as unknown as { __act: { counted(s: string): Record<string, number> } }).__act.counted(given), selector),
    text: (selector) => page.evaluate((given: string) => document.querySelector(given)?.textContent?.trim() ?? "", selector),
    gateCalls: () =>
      page.evaluate(() =>
        ((window as unknown as { __gate?: { calls: { fn: string; el: Element; key?: string }[] } }).__gate?.calls ?? []).map(
          (call) => [call.fn, call.el.id || call.el.tagName.toLowerCase(), ...(call.key !== undefined ? [call.key] : [])] as [string, string, string?],
        ),
      ),
    close: async () => {
      await context.close().catch(() => undefined);
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
