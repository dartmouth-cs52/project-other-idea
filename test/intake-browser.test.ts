import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { browseSite, canBrowse } from "../src/intake/browse.ts";

// The intake's browser reader against a small site served here. It needs
// Playwright and its browser, which the project does not install, so without
// them these tests are skipped: npm install --no-save playwright && npx playwright install chromium

const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

const PAGES: Record<string, string> = {
  "/": page(
    "Acme",
    `<nav><a href="/reports">Reports</a> <a href="/help" aria-haspopup="true">Help</a> <a href="/logout">Sign out</a></nav>
     <main>
       <h1>Home</h1>
       <a href="/items/1/delete">Clear the list</a>
       <a href="https://elsewhere.invalid/">Elsewhere</a>
       <a href="/#/settings">Settings</a>
       <table><tr><td><a href="/people/12345">Sam Example</a></td><td><button>Remove</button></td></tr></table>
       <button id="press" onclick="fetch('/pressed')">Do it</button>
       <form action="/submitted"><label>Name <input name="who" oninput="fetch('/typed')"></label><button>Send</button></form>
       <div id="later"></div>
       <script>setTimeout(() => { document.getElementById("later").innerHTML = '<a href="/drawn">Drawn late</a>'; }, 600);</script>
     </main>`,
  ),
  "/reports": page("Reports", `<h1>Reports</h1><a href="/reports/yearly">This year</a><select aria-label="Period"><option>Week</option></select>`),
  "/reports/yearly": page("Reports by year", `<h1>By year</h1><a href="/reports/yearly/deep">Deeper</a>`),
  "/reports/yearly/deep": page("Deep", `<h1>Deep</h1>`),
  "/drawn": page("Drawn", `<h1>Drawn by script</h1><button>Export</button>`),
  "/help": page("Help", `<h1>Help</h1>`),
  "/people/12345": page("Sam Example", `<h1>Sam Example</h1>`),
};

/** Addresses asked for, in order. The ones that act must never appear. */
const asked: string[] = [];
let server: Server;
let origin = "";

before(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    asked.push(`${request.method} ${path}`);
    const body = PAGES[path];
    response.writeHead(body ? 200 : 404, { "Content-Type": body ? "text/html" : "text/plain" });
    response.end(body ?? "not here");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const options = { maxPages: 20, maxDepth: 3, paceMs: 0, skip: [], within: [], also: [] };
const skip = canBrowse() ? false : "Playwright is not installed";

test("the browser reader loads pages and follows links, and never presses, types or sends", { skip, timeout: 120_000 }, async () => {
  const result = await browseSite(`${origin}/`, options);
  const paths = result.pages.map((item) => item.path);

  // Nothing that acts was ever asked for: no sign-out, no delete, no button's request, no form, no typing.
  for (const never of ["/logout", "/items/1/delete", "/pressed", "/submitted", "/typed"]) {
    assert.ok(!asked.some((line) => line.endsWith(` ${never}`)), `${never} was asked for: ${asked.join(", ")}`);
  }
  assert.ok(asked.every((line) => line.startsWith("GET ")), asked.join(", "));
  assert.ok(result.skipped.some((item) => item.url.endsWith("/logout")));
  assert.ok(result.skipped.some((item) => item.url.endsWith("/items/1/delete")));

  // A link drawn by script after the page loaded is found, and a page behind a "#/" route is a page of its own.
  assert.ok(paths.includes("/drawn"), paths.join(", "));
  assert.ok(paths.includes("/#/settings"), paths.join(", "));
  assert.ok(paths.includes("/reports/yearly/deep"), paths.join(", "));

  const home = result.pages.find((item) => item.path === "/")!;
  assert.deepEqual(home.links.find((link) => link.label === "Reports"), { label: "Reports", to: "/reports" });
  // A menu button is not a link to the page it names, and a name in a table is the page's data, not its map.
  assert.ok(home.buttons.includes("Help") && !home.links.some((link) => link.label === "Help"));
  assert.ok(!JSON.stringify(result.pages).includes("Sam Example"));
  assert.ok(!home.buttons.includes("Remove"));
  assert.ok(home.fields.includes("Name"));
  assert.ok(!home.links.some((link) => link.label === "Elsewhere"));
});

test("the browser reader goes no deeper than it is told", { skip, timeout: 120_000 }, async () => {
  const result = await browseSite(`${origin}/`, { ...options, maxDepth: 1 });
  const paths = result.pages.map((item) => item.path);
  assert.ok(paths.includes("/reports"));
  assert.ok(!paths.includes("/reports/yearly"), paths.join(", "));
});
