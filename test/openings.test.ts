import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, type PageNode, type SiteContext, type SnapElement, type TurnRequest } from "../src/shared/types.ts";

process.env.HAPTIC_MODEL = "mock";
const { mergeLearned, MemoryLearned, openingRows, parseOutlineReport } = await import("../src/server/learned.ts");
const { buildUserMessage, knownOpenings, renderSiteMap } = await import("../src/server/prompt.ts");

// What a menu, tab or accordion shows once it is opened, learned from visits:
// what the widget may send about it, how each item is counted, and how the
// model is told what a closed control on the page opens.

const VISITOR = "1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d";
const pages: PageNode[] = [
  { path: "/", title: "Home", headings: [], links: [], buttons: ["New"], fields: [] },
  { path: "/expenses", title: "Expenses", headings: [], links: [], buttons: ["Export"], fields: [] },
  { path: "/cards/:id", title: "Card", headings: [], links: [], buttons: ["Freeze"], fields: [] },
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
  pages,
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  createdAt: "",
  updatedAt: "",
};
const help = { route: "/", control: "Help", visitors: 3, seen: 5 };

test("what a visitor saw behind a control is cleaned again on the server", () => {
  const report = parseOutlineReport({
    site: site.id,
    visitor: VISITOR,
    outline: {
      path: "/",
      title: "",
      headings: [],
      links: [],
      buttons: [],
      opens: [
        { control: "Help", links: [{ label: "Help center", to: "/help?from=menu" }], buttons: ["Keyboard shortcuts", "Help", "ana@example.com"] },
        { control: "Help", buttons: ["Twice"] },
        { control: "Account for ana@example.com", buttons: ["Sign out"] },
        { control: "Empty", buttons: [] },
      ],
    },
  });
  // The control's own label isn't something it shows, an email goes whole, and a control is reported once.
  assert.deepEqual(report?.outline.opens, [{ control: "Help", links: [{ label: "Help center", to: "/help" }], buttons: ["Keyboard shortcuts"] }]);
  assert.deepEqual(openingRows(report!.outline), [
    { route: "/", control: "Help", label: "Help center", href: "/help" },
    { route: "/", control: "Help", label: "Keyboard shortcuts", href: "" },
  ]);
});

test("each item behind a control joins the page once enough visitors saw it, in a fixed order", () => {
  const merged = mergeLearned(pages, [], 3, [
    { ...help, label: "What's new", href: "" },
    { ...help, label: "Help center", href: "/help", visitors: 9, seen: 40 },
    { ...help, label: "Theo's workspace", href: "", visitors: 1, seen: 30 },
    { route: "/nowhere", control: "Menu", label: "Item", href: "", visitors: 5, seen: 5 },
  ]);
  assert.deepEqual(merged[0]!.opens, [{ control: "Help", links: [{ label: "Help center", to: "/help" }], buttons: ["What's new"] }]);
  // A page nothing else told us about isn't made up from a menu alone.
  assert.deepEqual(merged.map((page) => page.path), ["/", "/expenses", "/cards/:id"]);
  // Counts going up don't reorder it, so the cached prompt stays the same.
  const again = mergeLearned(pages, [], 3, [
    { ...help, label: "Help center", href: "/help", visitors: 3, seen: 3 },
    { ...help, label: "What's new", href: "", visitors: 10, seen: 99 },
  ]);
  assert.deepEqual(again[0]!.opens, merged[0]!.opens);
  assert.match(renderSiteMap(merged), /behind "Help": Help center → \/help; What's new/);
});

test("what was opened is kept across a restart of a developer's server", () => {
  const memory = new MemoryLearned();
  memory.record(site.id, "v1", { path: "/", title: "Home", headings: [], links: [], buttons: ["New"], opens: [{ control: "Help", links: [], buttons: ["What's new"] }] });
  memory.record(site.id, "v2", { path: "/", title: "", headings: [], links: [], buttons: [], opens: [{ control: "Help", links: [], buttons: ["What's new"] }] });
  const restored = new MemoryLearned();
  restored.restore(JSON.parse(JSON.stringify(memory.save())));
  assert.deepEqual(restored.openings(site.id), memory.openings(site.id));
  assert.deepEqual(restored.labels(site.id), memory.labels(site.id));
  assert.equal(restored.openings(site.id)[0]!.visitors, 2);
  // A file that isn't one is ignored.
  const fresh = new MemoryLearned();
  fresh.restore({ version: 9 });
  fresh.restore("nonsense");
  assert.deepEqual(fresh.openings(site.id), []);
});

const element = (extra: Partial<SnapElement>): SnapElement => ({ id: "e1", role: "button", label: "Help", ...extra });

test("a closed control on the page is listed with what it opens", () => {
  const known: SiteContext = {
    ...site,
    pages: [
      { ...pages[0]!, opens: [{ control: "Help", links: [{ label: "Help center", to: "/help" }], buttons: ["Contact support"] }] },
      pages[1]!,
      { ...pages[2]!, opens: [{ control: "More actions", links: [], buttons: ["Replace card"] }] },
    ],
  };
  // On its own page.
  assert.equal(knownOpenings(known, "/")(element({ state: ["collapsed"] })), "Help center → /help; Contact support");
  // In the header of another page, where it opened the same thing everywhere it was seen.
  assert.equal(knownOpenings(known, "/expenses")(element({ context: "header" })), "Help center → /help; Contact support");
  // In the main part of another page, a button with the same name may open something else.
  assert.equal(knownOpenings(known, "/expenses")(element({ context: "main" })), undefined);
  assert.equal(knownOpenings(known, "/expenses")(element({ label: "More actions", context: "main › Card" })), undefined);
  // Open already, its items are on the page.
  assert.equal(knownOpenings(known, "/")(element({ state: ["expanded"] })), undefined);

  const request: TurnRequest = {
    site: site.id,
    guide: "g",
    step: 0,
    goal: "what's new",
    history: [],
    snapshot: { path: "/expenses", title: "Expenses", headings: [], text: [], truncated: false, elements: [element({ state: ["collapsed"], context: "header" })] },
  };
  assert.match(buildUserMessage(request, known), /e1 button "Help" \(collapsed\) \[header\] opens: Help center → \/help; Contact support/);
  // A site with nothing opened is asked exactly as before.
  assert.equal(buildUserMessage(request, site), buildUserMessage(request));
});
