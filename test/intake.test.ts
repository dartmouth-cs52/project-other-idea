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
import { buildSystemPrompt, buildUserMessage, renderSiteMap } from "../src/server/prompt.ts";
import { DEFAULT_APPEARANCE, normalizePath, cleanText, type PageNode, type SiteContext } from "../src/shared/types.ts";

test("paths collapse ids and drop the query string", () => {
  assert.equal(normalizePath("https://a.com/orders/8812?tab=1#x"), "/orders/:id");
  assert.equal(normalizePath("/users/3f2b8c1e-1111-4222-8333-abcdefabcdef/edit"), "/users/:id/edit");
  assert.equal(normalizePath("/settings/step-3"), "/settings/step-3");
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
