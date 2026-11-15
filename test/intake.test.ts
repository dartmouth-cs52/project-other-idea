import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPage } from "../src/intake/crawl.ts";
import { buildSystemPrompt, buildUserMessage, renderSiteMap } from "../src/server/prompt.ts";
import { DEFAULT_APPEARANCE, normalizePath, cleanText, namedIn, type PageNode, type SiteContext } from "../src/shared/types.ts";

test("paths collapse ids and drop the query string", () => {
  assert.equal(normalizePath("https://a.com/orders/8812?tab=1#x"), "/orders/:id");
  assert.equal(normalizePath("/users/3f2b8c1e-1111-4222-8333-abcdefabcdef/edit"), "/users/:id/edit");
  assert.equal(normalizePath("/settings/step-3"), "/settings/step-3");
});

test("emails and long numbers are masked", () => {
  assert.equal(cleanText("Mail  sam@acme.com about order 4421987"), "Mail [email] about order [number]");
});

test("a long text is cut at a word", () => {
  assert.equal(cleanText("Status: Out of stock until further notice", 20), "Status: Out of…");
  assert.equal(cleanText("Supercalifragilisticexpialidocious", 12), "Supercalifr…");
});

test("a phone number is masked, and a date, a price or a model number is not", () => {
  assert.equal(cleanText("Call +1 (603) 646-1110 today"), "Call [number] today");
  assert.equal(cleanText("card 4111 1111 1111 1111"), "card [number]");
  assert.equal(cleanText("11-15-2026"), "11-15-2026");
  assert.equal(cleanText("2026-11-15 10:30"), "2026-11-15 10:30");
  assert.equal(cleanText("2026-11-01 - 2026-11-15"), "2026-11-01 - 2026-11-15");
  assert.equal(cleanText("15.11.2026 603 646 1110"), "15.11.2026 [number]");
  assert.equal(cleanText("Galaxy S II I9100 1.249,00 EUR"), "Galaxy S II I9100 1.249,00 EUR");
});

test("what the visitor named in their own question stays readable, and only when the whole of it matches", () => {
  const own = namedIn("move $25 out of account 12456 and into 13344, then write to Sam@Acme.com or call 603-646-1110");
  assert.deepEqual([...own].sort(), ["12456", "13344", "sam@acme.com"]);
  assert.equal(cleanText("13344", 80, own), "13344");
  assert.equal(cleanText("Account 13344, routing 987654", 80, own), "Account 13344, routing [number]");
  assert.equal(cleanText("133440 and 913344", 80, own), "[number] and [number]");
  assert.equal(cleanText("13344 12456 99999", 80, own), "13344 12456 [number]");
  assert.equal(cleanText("603 13344 10", 80, own), "[number] 13344 [number]");
  // Not by its ending, not inside a longer number, and not as one part of a number written with dashes.
  assert.equal(cleanText("23344, 1334455, 913344 and 13344-5566-77", 80, own), "[number], [number], [number] and [number]");
  assert.equal(cleanText("acct (13344) or 13344-5566", 80, own), "acct (13344) or [number]");
  assert.equal(cleanText("sam@acme.com, pat@acme.com", 80, own), "sam@acme.com, [email]");
  assert.equal(cleanText("603-646-1110", 80, own), "[number]");
  assert.equal(cleanText("13344"), "[number]");
  assert.equal(namedIn("where are my orders from 2026?").size, 0);
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

test("a link that opens a menu is outlined as a button, and its address is still read", () => {
  const html = `<a href="/help" aria-haspopup="true">Help</a><a href="/more" aria-expanded="false">More</a><a href="/docs" aria-haspopup="false">Docs</a>`;
  const { page, found } = extractPage(html, "https://app.acme.com/");
  assert.deepEqual(page.links, [{ label: "Docs", to: "/docs" }]);
  assert.deepEqual(page.buttons, ["Help", "More"]);
  assert.deepEqual(found, ["https://app.acme.com/help", "https://app.acme.com/more", "https://app.acme.com/docs"]);
});

const page = (path: string, extra: Partial<PageNode> = {}): PageNode => ({ path, title: path, headings: [], links: [{ label: "Home", to: "/" }], buttons: [], fields: [], ...extra });

test("navigation shared by most pages is listed once in the site map", () => {
  const map = renderSiteMap([page("/"), page("/a"), page("/b", { buttons: ["Export"] })]);
  assert.equal(map.split("Home → /").length - 1, 1);
  assert.match(map, /^On most pages: Home → \//);
  assert.match(map, /\/b: "\/b" \| buttons: Export/);
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
