import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { launch, type Browser } from "../eval/browser.ts";
import { drive } from "../eval/drive.ts";
import { DONE, type Guide, type GuideSet } from "../eval/guide.ts";
import type { SiteContext, TurnReply, TurnRequest } from "../src/shared/types.ts";

// Whole-guide runs (eval/drive.ts) on a small local site, with the model's
// answers scripted, so that how the runner follows the widget across page
// loads is tested with no model. These tests need Playwright and its browser,
// which this project does not install, and are skipped without them.

const browser: Browser | undefined = await launch().catch(() => undefined);
const skip = browser ? false : "Playwright or its browser is not installed here.";

/** The pages of the site, by path, and how long each takes to arrive. */
const PAGES: Record<string, { html: string; delay?: number }> = {
  "/article": { html: `<h1>Article</h1><p>Some words about the subject.</p><footer><a href="/disclaimers">Disclaimers</a></footer>` },
  // A page that takes a moment to arrive, like a large article.
  "/disclaimers": { html: `<h1>Disclaimers</h1><p>The disclaimers of this site.</p><ul><li><a href="/medical">Medical disclaimer</a></li></ul>`, delay: 900 },
  "/medical": { html: `<h1>Medical disclaimer</h1><p>Nothing here is medical advice.</p>` },
};

const server: Server = createServer((request, response) => {
  const page = PAGES[new URL(request.url ?? "/", "http://x").pathname];
  setTimeout(() => {
    response.writeHead(page ? 200 : 404, { "Content-Type": "text/html" });
    response.end(page ? `<!doctype html><title>Drive test</title><main>${page.html}</main>` : "");
  }, page?.delay ?? 0);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await browser?.close();
  server.close();
});

const site: SiteContext = { id: "site_drive_test", name: "Drive test", pages: [] } as unknown as SiteContext;
const set = (guides: Guide[]): GuideSet => ({ siteId: site.id, origin, hasTag: false, sandbox: true, guides });

/** Answers each step from `script`, by the path of the page the widget asked from. */
const scripted = (script: (request: Omit<TurnRequest, "site">) => TurnReply) => async (_site: SiteContext, request: Omit<TurnRequest, "site">) => ({
  reply: script(request),
  ms: 1,
  msToTarget: 1,
  servedBy: "the test",
});
const idOf = (request: Omit<TurnRequest, "site">, label: string) => request.snapshot.elements.find((element) => element.label === label)?.id ?? null;

test("a guide whose 'done' pointer loads a new page is followed onto it, not scored before the widget there has looked", { skip }, async () => {
  const guide: Guide = {
    id: "medical-disclaimer",
    start: "/article",
    goal: "Is there a disclaimer about medical advice?",
    steps: [
      { expect: [{ label: "Disclaimers", role: "link" }], act: { click: "a[href='/disclaimers']" } },
      { expect: [{ label: "Medical disclaimer", role: "link" }], act: { click: "a[href='/medical']" } },
      DONE,
    ],
    reached: { url: "/medical$" },
  };
  const asker = scripted((request) => {
    const path = request.snapshot.path;
    // The model calls the first link the last step: the disclaimers are there.
    if (path === "/article") return { target: idOf(request, "Disclaimers"), status: "done", say: "The disclaimers are under Disclaimers at the foot of the page." };
    if (path === "/disclaimers") return { target: idOf(request, "Medical disclaimer"), status: "continue", say: "Click Medical disclaimer." };
    return { target: null, status: "done", say: "This is the medical disclaimer." };
  });
  const { run } = await drive(browser, set([guide]), guide, site, asker, { visitor: "new", trace: false });
  assert.equal(run.end, "reached", `${run.end}: ${run.why}`);
  // The widget on the page the first link loaded was waited for, and asked once more from there.
  assert.deepEqual(
    run.trail.slice(0, 2).map((step) => `${step.path} ${step.pointed} ${step.status}`),
    ['/article link "Disclaimers" done', '/disclaimers link "Medical disclaimer" continue'],
  );
});
