import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import type { MapReport, PageNode } from "../../src/shared/types.ts";
import { BROWSERS, launch, page, startHarness, type Harness } from "./harness.ts";

// Mapping an app from a signed-in browser: the widget goes through the app by
// itself, notes what each button, menu, tab and dialog shows and where it
// leads, and neither presses what would change something nor lets a harmless
// looking button send anything.

const PASS = "ab".repeat(24);

const APP = page(`
  <nav>
    <a href="/">Home</a> <a href="/projects">Projects</a> <a href="/logout">Sign out</a>
    <button id="account" aria-haspopup="menu" aria-expanded="false">A</button>
    <div id="menu" role="menu" hidden><a role="menuitem" href="/billing">Plan and billing</a><button role="menuitem">Sign out</button></div>
  </nav>
  <main id="app"></main>
  <dialog id="new" aria-label="New project"><h2>New project</h2><label>Project name <input></label><button id="create">Create</button><button id="cancel">Cancel</button></dialog>
  <script>
    const send = (what) => fetch("/api/" + what, { method: "POST", body: "{}" }).catch(() => {});
    const views = {
      "/": '<h1>Home</h1><button id="open-new">New project</button> <button id="reports">Go to reports</button>' +
        '<button id="wipe">Delete everything</button> <button id="quick">Quick add</button>' +
        '<form onsubmit="send(\\'saved\\'); return false"><label>Name <input></label><button>Save</button></form>' +
        '<table><tr><td>Acme Corporation</td><td><button id="edit">Edit</button></td></tr></table>',
      "/projects": '<h1>Projects</h1><div role="tablist"><button role="tab" aria-selected="true" id="t-active">Active</button><button role="tab" aria-selected="false" id="t-archived">Archived</button></div><div id="panel"><button>Rename project</button></div>',
      "/billing": '<h1>Plan and billing</h1><button>Update card</button>',
      "/reports": '<h1>Reports</h1><a href="/reports/8812">Weekly report</a>',
      "/reports/8812": '<h1>Weekly report</h1>',
      "/logout": '<h1>Signed out</h1>',
    };
    const render = () => (document.getElementById("app").innerHTML = views[location.pathname] || "<h1>Not found</h1>");
    render();
    if (location.pathname === "/logout") send("loggedout");
    addEventListener("popstate", render);
    document.addEventListener("click", (event) => {
      const id = event.target.closest("[id]")?.id;
      sessionStorage.setItem("pressed", (sessionStorage.getItem("pressed") || "") + " " + id);
      const account = document.getElementById("account");
      const menu = document.getElementById("menu");
      if (id === "account") { menu.hidden = !menu.hidden; account.setAttribute("aria-expanded", String(!menu.hidden)); }
      if (id === "open-new") document.getElementById("new").showModal();
      if (id === "cancel") document.getElementById("new").close();
      if (id === "create") send("created");
      if (id === "reports") { history.pushState({}, "", "/reports"); render(); }
      if (id === "wipe") send("wiped");
      if (id === "quick") send("added");
      if (id === "edit") send("edited");
      if (id === "t-archived") document.getElementById("panel").innerHTML = "<button>Restore project</button>";
      if (id === "t-active") document.getElementById("panel").innerHTML = "<button>Rename project</button>";
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { document.getElementById("menu").hidden = true; document.getElementById("account").setAttribute("aria-expanded", "false"); }
    });
  </script>`);

const mapped = (harness: Harness) => harness.posts.filter((post) => post.path === "/v1/map").map((post) => post.body as MapReport);
/** Everything sent about one page, put together the way the server does. */
function pageAt(harness: Harness, path: string): PageNode | undefined {
  const sent = mapped(harness).flatMap((report) => (report.page?.path === path ? [report.page] : []));
  if (!sent.length) return undefined;
  return {
    path,
    title: sent.at(-1)!.title,
    headings: sent.at(-1)!.headings,
    links: sent.flatMap((page) => page.links),
    buttons: [...new Set(sent.flatMap((page) => page.buttons))],
    fields: [...new Set(sent.flatMap((page) => page.fields))],
    opens: sent.flatMap((page) => page.opens ?? []),
  };
}

for (const name of BROWSERS) {
  describe(`mapping an app in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.fallback = APP;
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    test("nothing is pressed until Start, and the pass leaves the address", async () => {
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/#haptic-map=${PASS}`);
      await tab.locator("haptic-root .map button.main").waitFor();
      assert.equal(new URL(tab.url()).hash, "");
      await tab.waitForTimeout(1200);
      // Only the question of whether the pass is good has gone out.
      assert.deepEqual(mapped(harness).map((report) => Boolean(report.page)), [false]);
      assert.equal(await tab.locator("haptic-root .map strong").textContent(), "Map this app for Haptic");
      await tab.close();
      harness.posts.length = 0;
    });

    test("it goes through the app, notes what each control shows, and changes nothing", async () => {
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/#haptic-map=${PASS}`);
      await tab.locator("haptic-root .map button.main").click();
      await tab.waitForFunction(() => document.querySelector("haptic-root")?.shadowRoot?.querySelector(".map strong")?.textContent === "Mapping is done", null, { timeout: 90_000 });

      const home = pageAt(harness, "/");
      assert.ok(home, "the first page was sent");
      // A button that led to another page is a way there.
      assert.ok(home.links.some((link) => link.label === "Go to reports" && link.to === "/reports"), JSON.stringify(home.links));
      // The account menu, and where what is in it leads.
      const account = home.opens?.find((opening) => opening.control === "A");
      assert.deepEqual(account?.links, [{ label: "Plan and billing", to: "/billing" }]);
      // The dialog a button opens: what it asks for, and its buttons. Nothing in it is pressed.
      const dialog = home.opens?.find((opening) => opening.control === "New project");
      assert.deepEqual(dialog?.fields, ["Project name"]);
      assert.deepEqual(dialog?.buttons, ["Create", "Cancel"]);
      // A tab, and what its panel holds.
      const archived = pageAt(harness, "/projects")?.opens?.find((opening) => opening.control === "Archived");
      assert.deepEqual(archived?.buttons, ["Restore project"]);

      // Pages reached by a link, by a link inside a menu, by a button, and one level further on.
      for (const path of ["/projects", "/billing", "/reports", "/reports/:id"]) assert.ok(pageAt(harness, path), `${path} was mapped`);
      // Nothing in a table's cells is kept or pressed.
      assert.ok(!home.buttons.includes("Edit"));

      // Nothing was changed: not by what it won't press (Delete, the form's Save, the row's Edit,
      // the dialog's Create, the Sign out link), and not by the button that looked harmless.
      const pressed = ((await tab.evaluate(() => sessionStorage.getItem("pressed"))) ?? "").split(" ");
      for (const id of ["wipe", "create", "edit"]) assert.ok(!pressed.includes(id), `${id} was not pressed`);
      // "Quick add" has nothing in its name to warn of it, so it was pressed, and what it tried to send was stopped.
      assert.ok(pressed.includes("quick"));
      const writes = harness.posts.filter((post) => post.path.startsWith("/api/")).map((post) => post.path);
      assert.deepEqual(writes, []);
      await tab.close();
    });

    test("a pass the server refuses shows nothing to start", async () => {
      const tab = await browser.newPage();
      await tab.route("**/v1/map", (route) => route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"no"}' }));
      await tab.goto(`${harness.url}/#haptic-map=${PASS}`);
      await tab.waitForFunction(() => document.querySelector("haptic-root")?.shadowRoot?.querySelector(".map strong")?.textContent === "This mapping link has run out");
      assert.equal(await tab.locator("haptic-root .map button.main").textContent(), "Close");
      // The next page in this tab is an ordinary one.
      await tab.goto(`${harness.url}/projects`);
      await tab.locator("haptic-root .launcher").waitFor();
      assert.equal(await tab.locator("haptic-root .map").count(), 0);
      await tab.close();
    });
  });
}
