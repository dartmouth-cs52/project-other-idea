import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

// The site's real setup screens (web/components/app/setup/setup-flow.tsx) in a
// real browser, against a stand-in for the site's Worker that keeps state, so a
// test can go forward and back, reload, and see exactly what was sent. Next's
// router and the sign-in client are swapped for small stand-ins: the router
// moves with the History API, and everyone is signed in.
//
//   CHROMIUM_PATH=/path/to/chrome npm run test:browser   when Playwright's own build isn't installed

const root = fileURLToPath(new URL("../..", import.meta.url));
const web = `${root}web`;
export const SITE = "site_a1b2c3d4e5f6";
export const ORIGIN = "https://app.example.com";

/** False when web/'s packages aren't installed, so the suites that need them skip. */
export const HAS_WEB = existsSync(`${web}/node_modules/react`);

const STAND_INS: Record<string, string> = {
  "next/navigation": `
    import { useSyncExternalStore } from "react";
    const listen = (fn) => { window.addEventListener("popstate", fn); window.addEventListener("stand-in-navigate", fn); return () => { window.removeEventListener("popstate", fn); window.removeEventListener("stand-in-navigate", fn); }; };
    const go = (how) => (url) => { window.__navigations.push(how + " " + url); history[how === "push" ? "pushState" : "replaceState"](null, "", url); window.dispatchEvent(new Event("stand-in-navigate")); };
    const router = { push: go("push"), replace: go("replace"), back: () => history.back(), refresh: () => {}, prefetch: () => {} };
    export function useRouter() { return router; }
    export function useSearchParams() { const search = useSyncExternalStore(listen, () => location.search, () => ""); return new URLSearchParams(search); }
    export function usePathname() { return useSyncExternalStore(listen, () => location.pathname, () => "/"); }`,
  "next/link": `
    import { createElement } from "react";
    export default function Link({ href, prefetch, ...props }) { return createElement("a", { href, ...props }); }`,
  "@/lib/auth-client": `
    export function auth() { return { getSession: async () => ({ data: null }), signOut: async () => {} }; }
    export function dashboardUrl() { return location.origin + "/dashboard/"; }`,
};

const standIns: Plugin = {
  name: "stand-ins",
  setup(build) {
    build.onResolve({ filter: /^(next\/navigation|next\/link|@\/lib\/auth-client)$/ }, (args) => ({ path: args.path, namespace: "stand-in" }));
    build.onLoad({ filter: /.*/, namespace: "stand-in" }, (args) => ({ contents: STAND_INS[args.path], loader: "jsx", resolveDir: web }));
  },
};

let bundled: Promise<string> | undefined;
function bundle(): Promise<string> {
  bundled ??= build({
    stdin: {
      contents: `import { createElement } from "react";
        import { createRoot } from "react-dom/client";
        import { SetupFlow } from "@/components/app/setup/setup-flow";
        window.__navigations = [];
        createRoot(document.getElementById("root")).render(createElement(SetupFlow));`,
      resolveDir: web,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    target: "es2020",
    write: false,
    jsx: "automatic",
    alias: { "@": web },
    nodePaths: [`${web}/node_modules`],
    plugins: [standIns],
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: 'var process = { env: { NODE_ENV: "production" } };' },
    logLevel: "error",
  }).then((result) => result.outputFiles[0]!.text);
  return bundled;
}

export interface Control {
  role?: string;
  label: string;
}

/** What the stand-in Worker holds and answers with. Tests change it, and read what was sent. */
export interface State {
  site: Record<string, unknown> & { blocked: Control[]; setup: Record<string, unknown> | null; origin: string; allowedOrigins: string[]; origins: unknown[] };
  /** Every request to /api/app, in order. */
  calls: { method: string; path: string; body: unknown }[];
  /** Answers to force, by "METHOD /path": a status, with the body's error. */
  fail: Record<string, number>;
}

const risky = [
  { role: "button", label: "Delete project", path: "/docs" },
  { role: "link", label: "Billing", path: "/pricing" },
  { role: "button", label: "Cancel subscription", path: "/pricing" },
];
const pages = ["/", "/pricing", "/docs", "/features", "/blog"].map((path) => ({ path, title: path === "/" ? "Home" : path.slice(1), controls: 20 }));

export function siteState(over: Partial<State["site"]> = {}): State {
  return {
    site: {
      id: SITE,
      name: "Example Co",
      origin: ORIGIN,
      allowedOrigins: [ORIGIN],
      scriptUrl: "https://widget.joinhaptic.com/widget.js",
      appearance: { accent: "#1E6EF4", position: "bottom-right", launcherLabel: "Ask" },
      notes: "",
      docs: { budget: 60000, used: 0, list: [] },
      connected: false,
      origins: [],
      reading: { read: 5, max: 30, done: true, failed: 0, thin: 0, via: "browser", pages, controls: 100, signIn: 0, risky },
      corrections: [],
      blocked: [],
      setup: { step: "learned", later: false },
      ...over,
    },
    calls: [],
    fail: {},
  };
}

const me = { user: { email: "dana@example.com", name: "Dana Reyes" }, approved: true, organization: { id: "org", name: "Example Co", role: "owner" }, sites: [{ id: SITE, name: "Example Co", origin: ORIGIN, connected: false }] };

function answer(state: State, method: string, path: string, body: Record<string, unknown>): [number, unknown] {
  const forced = state.fail[`${method} ${path}`];
  if (forced) return [forced, { error: "The server failed on purpose." }];
  const site = state.site;
  if (path === "/me") return [200, me];
  if (path === `/sites/${SITE}` && method === "GET") return [200, site];
  if (path === `/sites/${SITE}` && method === "PATCH") {
    site.allowedOrigins = body.allowedOrigins as string[];
    return [200, site];
  }
  if (path === `/sites/${SITE}` && method === "DELETE") return [200, { deleted: SITE }];
  if (path === `/sites/${SITE}/read`) return [200, site.reading];
  if (path === `/sites/${SITE}/setup`) {
    site.setup = { ...(site.setup ?? {}), ...body };
    return [200, { setup: site.setup }];
  }
  if (path === `/sites/${SITE}/blocked`) {
    site.blocked = body.controls as Control[];
    return [200, { blocked: site.blocked }];
  }
  if (path === `/sites/${SITE}/address`) {
    const origin = new URL(String(body.url).includes("://") ? String(body.url) : `https://${body.url}`).origin;
    site.allowedOrigins = site.allowedOrigins.map((item) => (item === site.origin ? origin : item));
    site.origin = origin;
    site.reading = { read: 0, max: 30, done: false, failed: 0, thin: 0, via: null, pages: [], controls: 0, signIn: 0, risky: [] };
    return [200, site];
  }
  if (path === "/sites" && method === "POST") return [201, { id: "site_new000000001", name: "Example Co", origin: "https://other.example.com" }];
  return [404, { error: "Not found." }];
}

export interface Flow {
  browser: Browser;
  url: string;
  close(): Promise<void>;
}

export async function startFlow(state: () => State): Promise<Flow> {
  const code = await bundle();
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/setup.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      return response.end(code);
    }
    if (url.pathname.startsWith("/api/app/")) {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        const path = url.pathname.slice("/api/app".length).replace(/\/$/, "");
        state().calls.push({ method: request.method ?? "GET", path, body });
        const [status, out] = answer(state(), request.method ?? "GET", path, body);
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(out));
      });
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/setup.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  return {
    browser,
    url,
    async close() {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Opens the setup screens for the site and waits for the screen to show. */
export async function openSetup(flow: Flow, path = `/dashboard/setup/?site=${SITE}`): Promise<Page> {
  const page = await flow.browser.newPage();
  await page.goto(flow.url + path);
  await page.locator("h1").first().waitFor();
  return page;
}

/** The "Never touch" chips as the screen shows them: "[x] Pay" or "[ ] Pay". */
export function chips(page: Page): Promise<string[]> {
  return page.$$eval('ul[aria-label="Controls to never point at"] button', (buttons) =>
    buttons.map((button) => `${button.getAttribute("aria-pressed") === "true" ? "[x]" : "[ ]"} ${(button.textContent ?? "").replace(/\/\S*$/, "").trim()}`),
  );
}

/** Presses a chip by its name. */
export async function toggle(page: Page, label: string): Promise<void> {
  await page.locator('ul[aria-label="Controls to never point at"] button').filter({ hasText: new RegExp(`^${label}(/|$)`) }).click();
}

export const labels = (controls: Control[]) => controls.map((control) => control.label).sort();
