import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, type PageNode, type SiteContext } from "../src/shared/types.ts";

process.env.HAPTIC_MODEL = "mock";
const { createApp } = await import("../src/server/app.ts");
const { Store } = await import("../src/server/db.ts");
const { labelThreshold, mergeLearned, MemoryLearned, outlineRows, parseOutlineReport, visitorHash, withLearned } = await import("../src/server/learned.ts");
const { renderSiteMap, buildSystemPrompt } = await import("../src/server/prompt.ts");

// Learning the site from real visits: what the widget may send, how each
// label is counted by distinct visitor, and how what was learned joins the
// crawl's pages in the prompt.

const crawled: PageNode[] = [
  { path: "/", title: "Home", headings: ["Your sets"], links: [{ label: "Settings", to: "/settings" }], buttons: ["New set"], fields: [] },
  { path: "/settings", title: "Settings", headings: ["Account"], links: [{ label: "Home", to: "/" }], buttons: ["Save"], fields: ["Name"] },
];
const site: SiteContext = {
  version: 1,
  id: "site_test",
  name: "Test",
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: crawled,
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const VISITOR = "1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d";

test("an outline is cleaned again on the server: masked labels go whole, long ones and empty ones too", () => {
  const report = parseOutlineReport({
    site: site.id,
    visitor: VISITOR,
    outline: {
      path: "/set/8812/edit?tab=cards",
      title: "Biology 101",
      headings: ["Cards", "Shared with ana@example.com", "123", "Cards"],
      links: [{ label: "Study", to: "/set/8812/study" }, { label: "Docs", to: "https://elsewhere.test/docs" }, { label: "Call 555 123 4567", to: "/call" }],
      buttons: ["icon:share-2", "x".repeat(61), "Delete", 42],
    },
  });
  assert.ok(report);
  assert.equal(report.outline.path, "/set/:id/edit");
  assert.deepEqual(report.outline.headings, ["Cards"]);
  assert.deepEqual(report.outline.links, [{ label: "Study", to: "/set/:id/study" }]);
  assert.deepEqual(report.outline.buttons, ["icon:share-2", "Delete"]);
  assert.equal(report.visitor, VISITOR);
  assert.equal(parseOutlineReport({ site: site.id, outline: { path: "no-slash" } }), undefined);
  assert.equal(parseOutlineReport({ site: site.id, visitor: "not-an-id", outline: { path: "/" } })?.visitor, undefined);
});

test("a visitor is a hash made with the site's id, never the id the widget sent", async () => {
  const here = await visitorHash("site_a", VISITOR);
  assert.match(here, /^[0-9a-f]{24}$/);
  assert.ok(!here.includes(VISITOR.slice(0, 8)));
  assert.notEqual(here, await visitorHash("site_b", VISITOR), "the same visitor is someone else on another site");
});

test("a label counts each visitor once, keeps at most ten, and reaches the prompt only past the threshold", () => {
  const learned = new MemoryLearned();
  const outline = { path: "/set/:id", title: "", headings: [], links: [], buttons: ["Share"] };
  // One person opening their own set in three tabs is one visitor.
  for (let i = 0; i < 3; i++) learned.record(site.id, "visitor-a", { ...outline, buttons: ["Share", "Biology 101"] });
  assert.deepEqual(mergeLearned(crawled, learned.labels(site.id), 3), crawled, "one visitor is never enough");
  learned.record(site.id, "visitor-b", outline);
  learned.record(site.id, "visitor-c", outline);
  const merged = mergeLearned(crawled, learned.labels(site.id), 3);
  assert.deepEqual(merged.find((page) => page.path === "/set/:id")?.buttons, ["Share"], "the shared button is learned, the one person's set name is not");
  for (let i = 0; i < 20; i++) learned.record(site.id, `visitor-${i}`, outline);
  assert.equal(learned.labels(site.id).find((row) => row.label === "Share")?.visitors, 10);
});

test("the threshold is three online and one on a developer's machine, unless set", () => {
  assert.equal(labelThreshold({}), 1);
  assert.equal(labelThreshold({ NODE_ENV: "production" }), 3);
  assert.equal(labelThreshold({ HAPTIC_PRODUCTION: "1" }), 3);
  assert.equal(labelThreshold({ HAPTIC_LABEL_THRESHOLD: "5", NODE_ENV: "production" }), 5);
  assert.equal(labelThreshold({ HAPTIC_LABEL_THRESHOLD: "zero" }), 1);
});

test("what was learned fills in the crawl: new pages after its own, and a way through a dialog", () => {
  const rows = [
    ...outlineRows({ path: "/", title: "", headings: [], links: [{ label: "View, in a dialog", to: "/set/:id" }], buttons: ["New set", "Import"] }),
    ...outlineRows({ path: "/set/:id", title: "Set", headings: ["Cards"], links: [], buttons: ["icon:share-2", "Study"] }),
  ].map((row) => ({ ...row, visitors: 3, seen: 9 }));
  const merged = mergeLearned(crawled, rows, 3);
  assert.deepEqual(merged.map((page) => page.path), ["/", "/settings", "/set/:id"], "the crawl's pages keep their order");
  const home = merged[0]!;
  assert.deepEqual(home.buttons, ["New set", "Import"], "a label the crawl already had isn't repeated");
  assert.deepEqual(home.links.at(-1), { label: "View, in a dialog", to: "/set/:id" });
  assert.equal(crawled[0]!.buttons.length, 1, "the crawl's own pages aren't changed in place");
  const map = renderSiteMap(merged);
  assert.match(map, /^\/: "Home" \| headings: Your sets \| links: Settings → \/settings; View, in a dialog → \/set\/:id \| buttons: New set, Import$/m);
  assert.match(map, /^\/set\/:id: "Set" \| headings: Cards \| buttons: icon:share-2, Study$/m);
});

test("the merged map stays the same when only the counts change, so the cached prompt does too", () => {
  const rows = (seen: (label: string) => number) =>
    ["Zoom", "Archive", "Share", "Duplicate"].map((label) => ({ route: "/set/:id", kind: "button" as const, label, href: "", visitors: 3 + (label.length % 3), seen: seen(label) }));
  const before = renderSiteMap(mergeLearned(crawled, rows(() => 1), 3));
  const after = renderSiteMap(mergeLearned(crawled, rows((label) => label.charCodeAt(0) * 7), 3));
  assert.equal(after, before);
  assert.match(before, /^\/set\/:id: buttons: Archive, Duplicate, Share, Zoom$/m);
});

test("a page lists at most 24 buttons, and navigation on most pages is listed once", () => {
  const nav = [{ label: "Home", to: "/" }, { label: "Reports", to: "/reports" }];
  const pages: PageNode[] = ["/a", "/b", "/c", "/d"].map((path) => ({ path, title: path, headings: [], links: nav, buttons: path === "/a" ? Array.from({ length: 30 }, (_, i) => `Row ${i}`) : [], fields: [] }));
  const map = renderSiteMap(pages);
  assert.match(map, /^On most pages: Home → \/; Reports → \/reports$/m);
  assert.equal((/^\/a: .*buttons: (.*)$/m.exec(map)?.[1] ?? "").split(", ").length, 24);
});

test("a site with nothing learned gets the prompt it had", () => {
  assert.equal(withLearned(site, [], 3), site);
  assert.equal(buildSystemPrompt(withLearned(site, [{ route: "/x", kind: "button", label: "Hidden", href: "", visitors: 2, seen: 5 }], 3)), buildSystemPrompt(site));
});

function standIn(rows: (text: string) => unknown[] = () => []) {
  const sent: { text: string; values: unknown[] }[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    sent.push({ text, values });
    return Promise.resolve(rows(text));
  };
  return { sql: sql as unknown as ConstructorParameters<typeof Store>[0], sent };
}

test("the store counts an outline in one statement, with the visitor added only once and at most ten", async () => {
  const { sql, sent } = standIn((text) => (text.startsWith("select count") ? [{ count: 12 }] : []));
  await new Store(sql).recordOutline(site, "abc123", { path: "/", title: "Home", headings: [], links: [{ label: "Reports", to: "/reports" }], buttons: ["Share"] });
  const insert = sent.find((query) => query.text.startsWith("insert into outline_labels"))!;
  assert.match(insert.text, /on conflict \(site_id, route, kind, label, href\) do update/);
  assert.match(insert.text, /= any\(outline_labels.visitors\) or cardinality\(outline_labels.visitors\) >= \?/);
  const rows = JSON.parse(insert.values.find((value) => typeof value === "string" && value.startsWith("[")) as string);
  assert.deepEqual(rows, [
    { route: "/", kind: "title", label: "Home", href: "" },
    { route: "/", kind: "link", label: "Reports", href: "/reports" },
    { route: "/", kind: "button", label: "Share", href: "" },
  ]);
});

test("a site at its limit still takes new labels, and makes room by dropping what the prompt doesn't read", async () => {
  const { sql, sent } = standIn((text) => (text.startsWith("select count") ? [{ count: 5000 }] : []));
  await new Store(sql).recordOutline(site, "abc123", { path: "/", title: "", headings: [], links: [], buttons: ["Share"] }, "0a1b");
  const insert = sent.find((query) => query.text.startsWith("insert into outline_labels"));
  assert.ok(insert, "a full site is not closed to new labels");
  assert.ok(insert.values.includes("0a1b"), "the caller's network is counted with the label");
  const prune = sent.find((query) => query.text.startsWith("delete from outline_labels"));
  assert.ok(prune, "room is made after the insert");
  assert.match(prune.text, /order by read desc, last_seen_at desc/);
  assert.ok(prune.values.includes(5000) && prune.values.includes(1500));

  const roomy = standIn((text) => (text.startsWith("select count") ? [{ count: 12 }] : []));
  await new Store(roomy.sql).recordOutline(site, "abc123", { path: "/", title: "", headings: [], links: [], buttons: ["Share"] });
  assert.ok(!roomy.sent.some((query) => query.text.startsWith("delete")), "nothing is dropped while there is room");
});

test("a site is read with its learned labels merged in, and still read when the table is missing", async () => {
  const row = { id: site.id, name: site.name, origin: site.origin, allowed_origins: site.allowedOrigins, context: site };
  const learned = [{ route: "/billing", kind: "button", label: "Update card", href: "", visitors: 4, networks: 3, seen: 10 }];
  const { sql, sent } = standIn((text) => (text.includes("from sites") ? [row] : text.includes("outline_openings") ? [] : learned));
  const loaded = await new Store(sql, 3).loadSite(site.id);
  assert.deepEqual(loaded?.pages.at(-1), { path: "/billing", title: "", headings: [], links: [], buttons: ["Update card"], fields: [] });
  assert.ok(sent.some((query) => query.text.includes("visitor_count >= ? and network_count >= ?") && query.values.filter((value) => value === 3).length === 2));

  const missing = ((strings: TemplateStringsArray) =>
    strings.join("").includes("outline_labels") ? Promise.reject(new Error('relation "outline_labels" does not exist')) : Promise.resolve([row])) as unknown as ConstructorParameters<typeof Store>[0];
  assert.deepEqual((await new Store(missing).loadSite(site.id))?.pages, crawled);
});

test("POST /v1/outline: origin checked, visitor hashed, a site that opted out learns nothing", async () => {
  const heard: { visitor: string; path: string }[] = [];
  const make = (served: SiteContext) =>
    createApp({
      loadSite: async () => served,
      widget: async () => "",
      widgetMaxAge: 0,
      overLimit: () => false,
      onOutline: (_site, visitor, outline) => void heard.push({ visitor, path: outline.path }),
    });
  const post = (app: ReturnType<typeof make>, origin: string, body: unknown) =>
    app(new Request("https://widget.test/v1/outline", { method: "POST", headers: { "Content-Type": "text/plain", Origin: origin }, body: JSON.stringify(body) }), "1.1.1.1");
  const body = { site: site.id, visitor: VISITOR, outline: { path: "/reports/7", title: "Reports", headings: [], links: [], buttons: ["Export"] } };

  assert.equal((await post(make(site), "https://elsewhere.test", body))?.status, 403);
  assert.equal((await post(make(site), "https://app.test", { site: site.id }))?.status, 400);
  assert.equal((await post(make(site), "https://app.test", body))?.status, 200);
  assert.deepEqual(heard, [{ visitor: await visitorHash(site.id, VISITOR), path: "/reports/:id" }]);
  const { visitor: _left, ...anonymous } = body;
  assert.deepEqual(await (await post(make(site), "https://app.test", anonymous))?.json(), { ok: false }, "without a browser id there's no counting a visitor once");
  assert.equal(heard.length, 1);
  assert.deepEqual(await (await post(make({ ...site, learn: false }), "https://app.test", body))?.json(), { ok: false });
  assert.equal(heard.length, 1);

  const config = await make({ ...site, learn: false })(new Request(`https://widget.test/v1/sites/${site.id}`, { headers: { Origin: "https://app.test" } }), "1.1.1.1");
  assert.equal((await config?.json()).learn, false, "the widget is told not to send outlines");
});
