import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPage } from "../src/intake/crawl.ts";
import { toPageNode } from "../web/worker/page-node.ts";
import { buildSystemPrompt, buildUserMessage, renderSiteMap } from "../src/server/prompt.ts";
import { DEFAULT_APPEARANCE, normalizePath, cleanText, questionKey, type PageNode, type SiteContext } from "../src/shared/types.ts";

test("paths collapse ids and drop the query string", () => {
  assert.equal(normalizePath("https://a.com/orders/8812?tab=1#x"), "/orders/:id");
  assert.equal(normalizePath("/users/3f2b8c1e-1111-4222-8333-abcdefabcdef/edit"), "/users/:id/edit");
  assert.equal(normalizePath("/settings/step-3"), "/settings/step-3");
  // A phone number or a long number in a path is masked, as it is in the page's text.
  assert.equal(normalizePath("/contacts/415-555-0132/edit"), "/contacts/:id/edit");
  assert.equal(normalizePath("/call/%2B14155550132"), "/call/:id");
  assert.equal(normalizePath("/invoices/2024-001234"), "/invoices/:id");
  assert.equal(normalizePath("/v2/oauth2/settings"), "/v2/oauth2/settings");
});

test("emails and long numbers are masked", () => {
  assert.equal(cleanText("Mail  sam@acme.com about order 4421987"), "Mail [email] about order [number]");
});

test("a page's outline has its links, buttons and field labels", () => {
  const html = `<title>Billing</title><h1>Billing</h1>
    <a href="/settings">Settings</a><a href="https://other.com/x">Elsewhere</a><a href="#top">Top</a>
    <button aria-label="Close"><svg></svg></button><button>Update card</button>
    <label for="n">Name on card</label><input id="n"><input type="hidden" name="csrf">
    <script>var secret = 1</script>`;
  const { page, found, controls } = extractPage(html, "https://app.acme.com/billing/77");
  assert.equal(page.path, "/billing/:id");
  assert.deepEqual(page.links, [{ label: "Settings", to: "/settings" }]);
  assert.deepEqual(page.buttons, ["Close", "Update card"]);
  assert.deepEqual(page.fields, ["Name on card"]);
  assert.deepEqual(found, ["https://app.acme.com/settings"]);
  assert.equal(controls, 4);
});

const page = (path: string, extra: Partial<PageNode> = {}): PageNode => ({ path, title: path, headings: [], links: [{ label: "Home", to: "/" }], buttons: [], fields: [], ...extra });

test("navigation shared by most pages is listed once in the site map", () => {
  const map = renderSiteMap([page("/"), page("/a"), page("/b", { buttons: ["Export"] })]);
  assert.equal(map.split("Home → /").length - 1, 1);
  assert.match(map, /^On most pages: Home → \//);
  assert.match(map, /\/b: "\/b" \| buttons: Export/);
});

test("what a menu shows once opened is listed behind the control that opens it", () => {
  const account = { control: 'The "A" menu', links: [{ label: "Plan and billing", to: "/billing" }], buttons: ["Sign out"] };
  const pages = [page("/", { opens: [account] }), page("/a", { opens: [account] }), page("/b", { opens: [account, { control: "Filters", links: [], buttons: ["Status", "Owner"] }] })];
  const map = renderSiteMap(pages);
  // The account menu is the same on every page, so it gets one line of its own. Its label's quotes can't close the label early.
  assert.equal(map.split("Plan and billing → /billing").length - 1, 1);
  assert.match(map, /^On most pages, behind "The 'A' menu": Plan and billing → \/billing; Sign out$/m);
  assert.match(map, /\/b: "\/b" \| behind "Filters": Status; Owner$/m);
  // A site read without a browser has no openings, and its map is what it always was.
  assert.doesNotMatch(renderSiteMap([page("/"), page("/a"), page("/b")]), /behind/);
});

test("the reader keeps each opening's links on this site, masked, and queues the pages they lead to", () => {
  const raw = {
    title: "Home", description: "", headings: [], fields: [], opened: 2, buttons: ["A"],
    links: [{ label: "Projects", href: "https://app.acme.com/projects" }],
    reveals: [
      { control: "A", links: [{ label: "Plan and billing", href: "https://app.acme.com/settings/billing#card" }, { label: "Status page", href: "https://status.acme.io/" }], buttons: ["Sign out", "sam@acme.com"] },
      { control: "Help", links: [{ label: "Docs", href: "https://docs.acme.io/" }], buttons: [] },
    ],
  };
  const { page: read, found, controls } = toPageNode("https://app.acme.com/", raw);
  assert.deepEqual(read.opens, [{ control: "A", links: [{ label: "Plan and billing", to: "/settings/billing" }], buttons: ["Sign out", "[email]"] }]);
  assert.deepEqual(found, ["https://app.acme.com/projects", "https://app.acme.com/settings/billing"]);
  assert.equal(controls, 5);
  // An outline from plain HTML has no openings, and its page has no `opens` at all.
  assert.equal("opens" in toPageNode("https://app.acme.com/", { ...raw, reveals: [] }).page, false);
});

test("the system prompt is the same for every turn, and a doc over budget is left out whole", () => {
  const site: SiteContext = {
    version: 1, id: "site_test", name: "Acme", origin: "https://a.com", allowedOrigins: ["https://a.com"], appearance: DEFAULT_APPEARANCE,
    notes: "Billing is under the A menu.", pages: [page("/")],
    docs: [{ title: "Small", source: "s.md", text: "short doc" }, { title: "Huge", source: "h.md", text: "x".repeat(70_000) }],
    source: { url: "https://a.com", maxPages: 5, docs: [] }, createdAt: "", updatedAt: "",
  };
  const system = buildSystemPrompt(site);
  assert.equal(system, buildSystemPrompt(site));
  assert.match(system, /guide built into Acme/);
  assert.match(system, /Billing is under the A menu/);
  assert.match(system, /## Small/);
  assert.doesNotMatch(system, /## Huge/);
});

test("the first turn carries the question, later turns carry what happened", () => {
  const snapshot = { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "button", label: 'Say "hi"', state: ["collapsed"] }] };
  const first = buildUserMessage({ site: "s", goal: "change my card", step: 0, history: [], snapshot });
  assert.match(first, /e1 button "Say 'hi'" \(collapsed\)/);
  assert.match(first, /The visitor asks: change my card/);
  const later = buildUserMessage({ site: "s", goal: "change my card", step: 2, history: [], snapshot, event: 'The user clicked button "A".', change: "Nothing visible on the page changed." });
  assert.match(later, /What the visitor did: The user clicked button "A"\./);
  assert.match(later, /Nothing visible on the page changed/);
});

test("the same question asked two ways groups together, with emails and numbers masked first", () => {
  assert.equal(questionKey("How do I change my billing info?"), questionKey("how do i change my  billing info"));
  assert.equal(questionKey("Email sam@acme.com my invoice 4421987!"), "email [email] my invoice [number]");
});
