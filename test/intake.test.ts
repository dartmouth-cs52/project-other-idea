import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compact, pageNode, tidy } from "../src/intake/browse.ts";
import { extractPage } from "../src/intake/crawl.ts";
import { loadDocs } from "../src/intake/docs.ts";
import { pageKey, parentKey, reasonNotToFollow } from "../src/intake/paths.ts";
import type { PageReading, ReadControl } from "../src/intake/reader.ts";
import { day, fromHtml, fromText } from "../src/intake/docs.ts";
import { toPageNode } from "../web/worker/page-node.ts";
import { buildSystemPrompt, buildUserMessage, renderSiteMap } from "../src/server/prompt.ts";
import { DEFAULT_APPEARANCE, normalizePath, cleanText, namedIn, questionKey, type PageNode, type SiteContext } from "../src/shared/types.ts";

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

test("a path parameter such as a session id is dropped, so one page has one address", () => {
  // ParaBank adds the session to every link. A long one made the whole segment look like an id, a short one stayed.
  assert.equal(normalizePath("/parabank/overview.htm;jsessionid=8E1F0C2B6A4D9E7F3B5C1A0D2E4F6B8C"), "/parabank/overview.htm");
  assert.equal(normalizePath("/parabank/activity.htm;jsessionid=ABCDEFabcdefAB?id=12345"), "/parabank/activity.htm");
  assert.equal(normalizePath("/shop;jsessionid=1A2B3C/cart"), "/shop/cart");
  assert.equal(normalizePath("/catalog;color=red;size=10/items/8812"), "/catalog/items/:id");
  // A semicolon that is not a parameter is part of the name.
  assert.equal(normalizePath("/notes/a;b"), "/notes/a;b");
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

test("the intake names pages the way the widget names the visitor's path", () => {
  assert.equal(pageKey("https://a.com/parabank/about.htm;jsessionid=8F2C9D11AB34"), "/parabank/about.htm");
  assert.equal(pageKey("https://a.com/app/index.html#/category/KB/product/HT-1064"), "/app/index.html#/category/KB/product/HT-1064");
  assert.equal(pageKey("https://a.com/wiki/Cat#History"), "/wiki/Cat");
  assert.equal(pageKey("https://a.com/w/index.php?title=Cat&action=history"), "/w/index.php?title=Cat&action=history");
  assert.equal(pageKey("https://a.com/overview.htm?id=13344"), "/overview.htm");
  assert.equal(pageKey("https://a.com/projects/KAFKA?selectedItem=com.atlassian.jira.jira-projects-plugin:report-page"), "/projects/KAFKA?selectedItem=com.atlassian.jira.jira-projects-plugin:report-page");
  assert.equal(parentKey("/catalog/default/component/artist-lookup"), "/catalog/default/component");
  assert.equal(parentKey("/app/index.html#/category/KB"), "/app/index.html#/category");
  assert.equal(parentKey("/contact"), "/");
});

test("links that sign out, act, send a form or carry a token are never loaded", () => {
  const not = (address: string, label = "") => reasonNotToFollow(address, label);
  for (const [address, label] of [
    ["https://a.com/auth/logout", ""],
    ["https://a.com/account", "Sign out"],
    ["https://a.com/web/index.php/auth/login", "Log in"],
    ["https://a.com/jira/login.jsp?os_destination=x", "Report a problem"],
    ["https://a.com/items/5/delete", "Open"],
    ["https://a.com/shop?add-to-cart=12", "Pliers"],
    ["https://a.com/cart/add/12", "Pliers"],
    ["https://a.com/save?name=x", "Keep"],
    ["https://a.com/transfer.htm?amount=5&to=12345", "Again"],
    ["https://a.com/browse/KAFKA-1?atl_token=abc", "KAFKA-1"],
    ["https://a.com/d/abc/graphs?shareView=link", "Graphs"],
    ["https://a.com/secure/VoteOrWatchIssue.jspa", "Votes"],
    ["https://a.com/app/index.html#/settings/reset", "Settings"],
    ["https://a.com/report.pdf", "Report"],
    ["mailto:sam@example.com", "Mail us"],
  ]) {
    assert.notEqual(not(address!, label), "", `${address} (${label}) should not be loaded`);
  }
  for (const address of [
    "https://a.com/web/index.php/pim/addEmployee",
    "https://a.com/category/hand-tools",
    "https://a.com/issues/closed-this-week",
    "https://a.com/settings",
    "https://a.com/dashboard/new",
    "https://a.com/parabank/transfer.htm",
    "https://a.com/web/index.php/claim/viewClaimModule",
    "https://a.com/app/index.html#/category/KB",
    "https://a.com/w/index.php?title=Cat&action=history",
  ]) {
    assert.equal(not(address), "", `${address} should be loaded`);
  }
  assert.match(reasonNotToFollow("https://a.com/parabank/admin.htm", "Admin Page", [/admin/i]), /matches/);
});

const reading = (controls: Partial<ReadControl>[], extra: Partial<PageReading> = {}): PageReading => ({
  address: "https://a.com/people",
  title: "People",
  description: "Everyone at Acme.",
  headings: ["People"],
  controls: controls.map((control) => ({ role: "link", label: "", nav: false, record: false, opensMenu: false, ...control })),
  links: [],
  signIn: false,
  ...extra,
});

test("a page in the map keeps what a visitor can use there and leaves out the page's data", () => {
  const node = pageNode(
    reading([
      { label: "Home", address: "https://a.com/", nav: true },
      { label: "Help", address: "https://a.com/help", nav: true, opensMenu: true },
      { label: "Sam Example", address: "https://a.com/people/12345", record: true },
      { role: "button", label: "Remove", record: true },
      { label: "Pliers", address: "https://a.com/product/01J9ZK3Q8X" },
      { label: "Hammer", address: "https://a.com/product/01J9ZK3Q9Y" },
      { label: "Saw", address: "https://a.com/product/01J9ZK3QAZ" },
      { label: "Elsewhere", address: "https://other.com/" },
      { label: "Back to top", address: "https://a.com/people#top" },
      { role: "button", label: "", icon: "settings" },
      { role: "clickable", label: "Card of Sam" },
      { role: "clickable", label: "Reports", nav: true },
      { role: "textbox", label: "Search people" },
      { role: "clickable", label: "Robin Reader", nav: true },
    ]),
    "/people",
    "https://a.com",
    ["robin reader"],
  );
  assert.deepEqual(node.links, [
    { label: "Home", to: "/" },
    { label: "Pliers", to: "/product/:id" },
    { label: "Hammer", to: "/product/:id" },
  ]);
  // A link that goes nowhere else is a button to a visitor: the app, or the page itself, handles the click.
  assert.deepEqual(node.buttons, ["Help", "Back to top", "settings icon", "Reports"]);
  assert.deepEqual(node.fields, ["Search people"]);
  assert.equal(node.description, "Everyone at Acme.");
});

test("a title every page shares gives way to each page's first heading, and a record's page keeps none of the record", () => {
  const pages = [
    page("/a", { title: "Acme", headings: ["Leave", "My leave"], description: "Acme HR" }),
    page("/b", { title: "Acme", headings: ["Admin"], description: "Acme HR" }),
    page("/people/:id", { title: "Sam Example - Acme", headings: ["Sam Example"], description: "Sam's page" }),
    page("/orders/:id", { title: "Acme", headings: ["Order 12"] }),
  ];
  tidy(pages);
  assert.deepEqual(pages.map((item) => [item.title, item.headings, item.description]), [
    ["Leave", ["My leave"], undefined],
    ["Admin", [], undefined],
    ["", [], undefined],
    ["Acme", [], undefined],
  ]);
});

test("a group of links that some pages repeat is kept on the first of them, and what most pages share stays on all", () => {
  const tabs = [{ label: "Contact", to: "/people/:id/contact" }, { label: "Job", to: "/people/:id/job" }];
  const nav = { label: "Home", to: "/" };
  const pages = [
    ...["/", "/a", "/b", "/c", "/d"].map((path) => page(path, { links: [nav] })),
    page("/people/:id", { links: [nav, ...tabs], buttons: ["Save"] }),
    page("/people/:id/contact", { links: [nav, ...tabs], buttons: ["Save"] }),
    page("/people/:id/job", { links: [nav, ...tabs], buttons: ["Save"] }),
  ];
  const map = compact(pages);
  assert.deepEqual(map.map((item) => item.links.length), [1, 1, 1, 1, 1, 3, 1, 1]);
  assert.deepEqual(map.map((item) => item.buttons.length), [0, 0, 0, 0, 0, 1, 0, 0]);
  assert.equal(renderSiteMap(map).split("Contact → ").length - 1, 1);
  assert.equal(pages[6]!.links.length, 3, "the pages given are left as they were");
});

test("a help page is read from its largest main block and named by its page title", async () => {
  const dir = await mkdtemp(join(tmpdir(), "haptic-docs-"));
  const file = join(dir, "page.html");
  await writeFile(
    file,
    `<title>Basic searching | Jira Software | Atlassian</title><header><h1>Jira Software Support</h1></header>
     <article>Try the assistant</article>
     <main><h1>Define a period</h1><p>Open Issues, then Search for issues.</p><p>Pick a project and a status, then press Search.</p></main>`,
  );
  const [doc] = await loadDocs([file]);
  assert.equal(doc?.title, "Basic searching");
  assert.match(doc?.text ?? "", /Pick a project/);
  assert.doesNotMatch(doc?.text ?? "", /Try the assistant/);
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
