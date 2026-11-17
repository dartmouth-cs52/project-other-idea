import assert from "node:assert/strict";
import { test } from "node:test";
import { mappingAllowed, mappingHash, newMappingPass } from "../src/shared/mapping.ts";
import { DEFAULT_APPEARANCE, type PageNode, type SiteContext } from "../src/shared/types.ts";
import { MAX_SITE_PAGES, mergeMapped, parseMapReport } from "../src/server/mapped.ts";
import { renderSiteMap } from "../src/server/prompt.ts";

process.env.HAPTIC_MODEL = "mock";
const { createApp } = await import("../src/server/app.ts");

// Pages mapped from a signed-in browser at the company: who may send them,
// what is kept of what they send, and how it joins the site's pages.

const PASS = "0123456789abcdef".repeat(3);

test("a pass is good only for its own site, and only until it runs out", async () => {
  const pass = newMappingPass();
  assert.match(pass, /^[0-9a-f]{48}$/);
  const mapping = { hash: await mappingHash("site_one", pass), expires: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(await mappingAllowed("site_one", mapping, pass), true);
  assert.equal(await mappingAllowed("site_two", mapping, pass), false);
  assert.equal(await mappingAllowed("site_one", mapping, newMappingPass()), false);
  assert.equal(await mappingAllowed("site_one", mapping, pass, Date.now() + 61_000), false);
  assert.equal(await mappingAllowed("site_one", undefined, pass), false);
  assert.equal(await mappingAllowed("site_one", mapping, "not a pass"), false);
});

test("a mapped page is cleaned like anything else a page on a customer's site sends", () => {
  const report = parseMapReport({
    site: "site_test",
    pass: PASS,
    page: {
      path: "/orders/8812?tab=1",
      title: "Orders",
      headings: ["Orders", "Orders", 7],
      links: [{ label: "Billing", to: "/settings/billing" }, { label: "Elsewhere", to: "https://other.com/x" }, { label: "Mail ana@example.com", to: "/mail" }],
      buttons: ["New order", "Call 415-555-0132", "x".repeat(200), "New order"],
      fields: ["Search"],
      opens: [
        { control: "New order", links: [], buttons: ["Create", "Cancel"], fields: ["Customer"] },
        { control: "Empty", links: [], buttons: [] },
        { control: "A", links: [{ label: "Plan", to: "/plan" }], buttons: [] },
      ],
    },
  });
  assert.deepEqual(report?.page, {
    path: "/orders/:id",
    title: "Orders",
    headings: ["Orders"],
    links: [{ label: "Billing", to: "/settings/billing" }],
    buttons: ["New order"],
    fields: ["Search"],
    mapped: true,
    opens: [
      { control: "New order", links: [], buttons: ["Create", "Cancel"], fields: ["Customer"] },
      { control: "A", links: [{ label: "Plan", to: "/plan" }], buttons: [] },
    ],
  });
  // With no page it only asks whether the pass is good.
  assert.deepEqual(parseMapReport({ site: "site_test", pass: PASS }), { site: "site_test", pass: PASS });
  assert.equal(parseMapReport({ site: "site_test", pass: "short" }), undefined);
  assert.equal(parseMapReport({ site: "site_test", pass: PASS, page: { path: "orders" } }), undefined);
});

const page = (path: string, extra: Partial<PageNode> = {}): PageNode => ({ path, title: path, headings: [], links: [], buttons: [], fields: [], ...extra });

test("a mapped page joins the page already known at its path, and adds to it", () => {
  const known = [page("/", { links: [{ label: "Pricing", to: "/pricing" }], buttons: ["Sign in"], opens: [{ control: "A", links: [], buttons: ["Old"] }] }), page("/pricing")];
  const first = mergeMapped(known, page("/", { title: "Home", buttons: ["New project"], links: [{ label: "Pricing", to: "/pricing" }, { label: "Go to reports", to: "/reports" }], mapped: true, opens: [{ control: "A", links: [], buttons: ["Sign out"] }] }));
  assert.deepEqual(first[0], {
    path: "/",
    title: "Home",
    headings: [],
    links: [{ label: "Pricing", to: "/pricing" }, { label: "Go to reports", to: "/reports" }],
    buttons: ["Sign in", "New project"],
    fields: [],
    mapped: true,
    // What a control shows now replaces what it showed before.
    opens: [{ control: "A", links: [], buttons: ["Sign out"] }],
  });
  assert.equal(first[1], known[1]);
  // A new page goes in, in path order.
  assert.deepEqual(mergeMapped(known, page("/app", { mapped: true })).map((item) => item.path), ["/", "/app", "/pricing"]);
  // A full site takes no new pages, and says so by handing back the same list.
  const full = Array.from({ length: MAX_SITE_PAGES }, (_, index) => page(`/p${index}`));
  assert.equal(mergeMapped(full, page("/new", { mapped: true })), full);
  assert.notEqual(mergeMapped(full, page("/p3", { buttons: ["More"], mapped: true })), full);
});

test("a dialog's fields are in the site map, behind the button that opens it", () => {
  const map = renderSiteMap([page("/projects", { opens: [{ control: "New project", links: [], buttons: ["Create", "Cancel"], fields: ["Project name", "Template"] }] })]);
  assert.match(map, /behind "New project": Create; Cancel; fields: Project name, Template$/m);
});

const site: SiteContext = {
  version: 1,
  id: "site_test",
  name: "Test",
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [],
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("the server saves a mapped page only for a good pass from an allowed origin", async () => {
  const saved: PageNode[] = [];
  const parts = {
    loadSite: async (id: string) => (id === site.id ? site : undefined),
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
  };
  const mapping = { allowed: async (_site: SiteContext, pass: string) => pass === PASS, save: async (_site: SiteContext, mapped: PageNode) => void saved.push(mapped) };
  const post = (app: ReturnType<typeof createApp>, body: unknown, origin = "https://app.test") =>
    app(new Request("https://widget.test/v1/map", { method: "POST", headers: { "Content-Type": "text/plain", Origin: origin }, body: JSON.stringify(body) }), "1.1.1.1");
  const app = createApp({ ...parts, mapping });
  const body = { site: site.id, pass: PASS, page: { path: "/app", title: "App", headings: [], links: [], buttons: ["New"], fields: [] } };

  assert.equal((await post(app, { site: site.id, pass: PASS }))?.status, 200);
  assert.equal(saved.length, 0);
  assert.equal((await post(app, body))?.status, 200);
  assert.deepEqual(saved.map((item) => item.path), ["/app"]);
  assert.equal((await post(app, { ...body, pass: "f".repeat(48) }))?.status, 403);
  assert.equal((await post(app, body, "https://evil.test"))?.status, 403);
  assert.equal((await post(app, { site: "site_none", pass: PASS }))?.status, 404);
  assert.equal((await post(app, { site: site.id }))?.status, 400);
  // A host with nowhere to keep pages does not offer mapping at all.
  assert.equal((await post(createApp(parts), body))?.status, 403);
  assert.equal(saved.length, 1);
});
