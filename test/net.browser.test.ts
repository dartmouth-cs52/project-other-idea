import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { launch, open, type Browser } from "../eval/browser.ts";
import type { GuideSet } from "../eval/guide.ts";

// The net that keeps a benchmark run from writing to a site other people use
// (eval/net.ts), tried in a real browser against a small local site that
// keeps a list of everything it is sent. These tests need Playwright and its
// browser, which this project does not install, and are skipped without them.

const browser: Browser | undefined = await launch().catch(() => undefined);
const skip = browser ? false : "Playwright or its browser is not installed here.";

const PAGE = `<!doctype html><title>Net test</title>
<main>
  <h1>Net test</h1>
  <button id="save">Save</button>
  <button id="search">Search</button>
  <form method="post" action="/form"><button id="send">Send form</button></form>
</main>
<script>
  const post = (path, body, method) => fetch(path, { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  // What the page does by itself as it loads.
  post("/graphql", { query: "query Rows { rows { id } }" });
  post("/stats/hit", { page: location.pathname });
  navigator.sendBeacon("/beacon", "x");
  document.getElementById("save").addEventListener("click", () => {
    post("/api/save", { name: "x" });
    post("/api/thing/7", {}, "DELETE");
    post("/graphql", { query: "mutation Rename { rename(id: 7) { id } }" });
  });
  document.getElementById("search").addEventListener("click", () => post("/api/search", { text: "x" }));
</script>`;

/** Every request the local site received that was not a plain read. */
const received: string[] = [];
const server: Server = createServer((request, response) => {
  if (request.method !== "GET") received.push(`${request.method} ${request.url}`);
  response.writeHead(200, { "Content-Type": request.url === "/" ? "text/html" : "application/json" });
  response.end(request.url === "/" ? PAGE : "{}");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await browser?.close();
  server.close();
});

const set = (extra: Partial<GuideSet> = {}): GuideSet => ({ siteId: "site_net_test", origin, hasTag: false, guides: [], ...extra });
const silent = () => ({ target: null, status: "done" as const, say: "" });

test("on a site other people use, only known reads leave the browser", { skip }, async () => {
  received.length = 0;
  const { page, close, net } = await open(browser, set({ reads: "^POST [^/]+/api/search$", chatter: "^POST [^/]+/stats/" }), "/", silent);
  try {
    assert.ok(net, "a set that is not a sandbox has a net");
    // The page's own requests as it loaded: the query went through, the usage count and the beacon did not.
    assert.deepEqual(received, ["POST /graphql"]);
    assert.equal(net.spoiled(), undefined, "what the set calls chatter, and a beacon, are not held against a run");

    net.acting("clicked Search");
    await page.click("#search");
    await page.waitForTimeout(300);
    assert.deepEqual(received, ["POST /graphql", "POST /api/search"]);
    assert.equal(net.spoiled(), undefined);

    net.acting("clicked Save");
    await page.click("#save");
    await page.waitForTimeout(300);
    assert.deepEqual(received, ["POST /graphql", "POST /api/search"], "a save, a delete and a mutation never reach the site");
    const spoiled = net.spoiled();
    assert.ok(spoiled?.byAStep);
    assert.match(spoiled.why, /after the visitor clicked Save, the page tried to send (POST|DELETE) /);

    // A form that posts would load a new page. Stopped, it leaves the visitor where they were.
    await page.click("#send");
    await page.waitForTimeout(300);
    assert.equal(new URL(page.url()).pathname, "/");
    assert.ok(!received.some((line) => line.includes("/form")));

    const stopped = net.log.stopped.map((sent) => `${sent.method} ${new URL(`http://${sent.to}`).pathname}`).sort();
    assert.deepEqual(stopped, ["DELETE /api/thing/7", "POST /api/save", "POST /beacon", "POST /form", "POST /graphql", "POST /stats/hit"]);
    assert.deepEqual(net.log.let.map((sent) => sent.why).sort(), ["a GraphQL query", "the guide set says it only reads"]);
  } finally {
    await close();
  }
});

test("a request nobody has vouched for spoils the run even before the visitor acts", { skip }, async () => {
  received.length = 0;
  const { close, net } = await open(browser, set(), "/", silent);
  try {
    assert.deepEqual(received, ["POST /graphql"]);
    const spoiled = net?.spoiled();
    assert.ok(spoiled && !spoiled.byAStep);
    assert.match(spoiled.why, /POST 127\.0\.0\.1:\d+\/stats\/hit before the visitor did anything/);
  } finally {
    await close();
  }
});

test("what the set's own sign-in sends goes through, and a sandbox has no net", { skip }, async () => {
  received.length = 0;
  const signIn = await open(browser, set({ before: { path: "/", acts: [{ click: "#save" }] }, chatter: "/stats/" }), "/", silent);
  await signIn.close();
  assert.ok(received.includes("POST /api/save"), "the sign-in's own request was let through");
  assert.ok(signIn.net?.log.let.some((sent) => sent.why === "part of the set's own sign-in"));

  received.length = 0;
  const sandbox = await open(browser, set({ sandbox: true }), "/", silent);
  await sandbox.page.click("#save");
  await sandbox.page.waitForTimeout(300);
  await sandbox.close();
  assert.equal(sandbox.net, undefined);
  assert.ok(received.includes("POST /api/save") && received.includes("DELETE /api/thing/7"));
});
