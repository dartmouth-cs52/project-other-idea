import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPage } from "../src/intake/crawl.ts";
import { day, fromHtml, fromText } from "../src/intake/docs.ts";
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

test("a help doc can say where it lives and when it last changed", () => {
  const doc = fromText('---\ntitle: Inviting teammates\nurl: https://help.acme.test/inviting\nupdated: "2026-10-02"\nowner: support\n---\n# Invite people\n\nGo to Team.\n', "help/inviting.md", "inviting");
  assert.deepEqual(doc, { title: "Inviting teammates", source: "help/inviting.md", text: "# Invite people\n\nGo to Team.", url: "https://help.acme.test/inviting", updated: "2026-10-02" });
  // Without those lines it is read as it always was, and a line of dashes further down is left alone.
  assert.deepEqual(fromText("# Plain\n\nText.\n---\nMore.", "plain.md", "plain"), { title: "Plain", source: "plain.md", text: "# Plain\n\nText.\n---\nMore." });
  // An address that is not a web address, and a date that is not a date, are dropped.
  assert.deepEqual(fromText("---\nurl: javascript:alert(1)\nupdated: soon\n---\nText.", "x.md", "x"), { title: "x", source: "x.md", text: "Text." });

  const html = fromHtml('<html><head><title>T</title><link rel="canonical" href="https://help.acme.test/api-keys"><meta property="article:modified_time" content="2026-09-01T10:00:00Z"></head><body><main><h1>API keys</h1><p>Create one.</p></main></body></html>', "api-keys.html");
  assert.equal(html.url, "https://help.acme.test/api-keys");
  assert.equal(html.updated, "2026-09-01");
  assert.equal(day("Tue, 03 Nov 2026 08:00:00 GMT"), "2026-11-03");
  assert.equal(day(""), undefined);
});
