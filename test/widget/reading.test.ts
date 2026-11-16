import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Asked } from "./harness.ts";

after(closeBrowser);

// When the page is read. A page that fetches what it shows has not drawn it
// the moment a click is done, and an answer about the page from before is a
// step wasted, or a visitor told to do again what already worked.

/** The labels of the products as the request listed them, in order. */
const products = (request: Asked) => request.snapshot.elements.filter((element) => element.label.startsWith("Open ")).map((element) => element.label.slice(5));

/**
 * A shop whose every request takes `pace` ms and shows no sign that one is on
 * its way. "Sort by price" fetches, then puts the list in the other order.
 */
const shop = (pace: number) => `<h1>Products</h1><button id="sort" type="button">Sort by price</button><ul id="list"></ul>
  <script>
    let names = ['Hammer', 'Pliers', 'Saw', 'Wrench'];
    const draw = () => document.getElementById('list').innerHTML = names.map((name) => '<li><button type="button">Open ' + name + '</button></li>').join('');
    fetch('/data/${pace}').then(draw);
    document.getElementById('sort').addEventListener('click', () => fetch('/data/${pace}').then(() => { names = names.slice().reverse(); draw(); }));
  </script>`;

test("on a site whose requests take over a second, the page is read once what the click fetched has been drawn", async () => {
  const session = await start(shop(1300), (request, index) => (index === 0 ? point(request, "Sort by price", "Click Sort by price.") : words("The cheapest is first.")));
  try {
    await session.page.waitForTimeout(1600);
    await session.ask("show the cheapest first");
    await session.untilState("pointing");
    await session.page.locator("#sort").click();
    const clicked = Date.now();
    const second = await session.untilAsked(2, 8000);
    const waited = Date.now() - clicked;
    assert.deepEqual(products(second), ["Wrench", "Saw", "Pliers", "Hammer"], `the page was read ${waited} ms after the click, before the sorted list came`);
    assert.ok(waited < 3500, `the question waited ${waited} ms`);
    await session.untilState("finished");
    assert.equal(session.requests.length, 2);
  } finally {
    await session.close();
  }
});

test("a list put in a new order while the model was answering is asked about again", async () => {
  const page = `<h1>Products</h1><button id="sort" type="button">Sort by price</button><ul id="list"></ul>
    <script>
      let names = ['Hammer', 'Pliers', 'Saw', 'Wrench'];
      const draw = () => document.getElementById('list').innerHTML = names.map((name) => '<li><button type="button">Open ' + name + '</button></li>').join('');
      draw();
      document.getElementById('sort').addEventListener('click', () => setTimeout(() => { names = names.slice().reverse(); draw(); }, 1200));
    </script>`;
  const session = await start(page, async (request, index) => {
    if (index === 0) return point(request, "Sort by price", "Click Sort by price.");
    if (index === 1) {
      // The model takes its time, and the sorted list lands meanwhile.
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return point(request, "Sort by price", "The list is not sorted yet. Click Sort by price again.");
    }
    return words("The cheapest is first.");
  });
  try {
    await session.ask("show the cheapest first");
    await session.untilState("pointing");
    await session.page.locator("#sort").click();
    const third = await session.untilAsked(3, 8000);
    assert.equal(third.step, 1, "the answer about the unsorted list was shown as a step");
    assert.deepEqual(products(third), ["Wrench", "Saw", "Pliers", "Hammer"]);
  } finally {
    await session.close();
  }
});

test("a few results arriving in the main part of the page while the model answered are asked about again", async () => {
  const page = `<header><a href="#a">Home</a> <a href="#b">Help</a></header><main><h1>Search</h1>
      <input id="q" aria-label="Search tools"><button id="go" type="button">Search</button>
      ${Array.from({ length: 16 }, (_, n) => `<button type="button">Category ${n + 1}</button>`).join("")}
      <div id="found"></div></main>
    <script>
      document.getElementById('go').addEventListener('click', () => setTimeout(() => {
        document.getElementById('found').innerHTML = ['Saw', 'Drill', 'Sander'].map((name) => '<article><button type="button">Open ' + name + '</button></article>').join('');
      }, 1200));
    </script>`;
  const session = await start(page, async (request, index) => {
    if (index === 0) return point(request, "Search", "Click Search.");
    if (index === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return point(request, "Category 3", "No saws were found. Try the Power tools category.");
    }
    return point(request, "Open Saw", "Open the saw.");
  });
  try {
    await session.ask("find a saw");
    await session.untilState("pointing");
    await session.page.locator("#go").click();
    const third = await session.untilAsked(3, 8000);
    assert.equal(third.step, 1);
    assert.ok(products(third).includes("Saw"));
  } finally {
    await session.close();
  }
});

test("a clock that ticks while the model answers does not get a question asked again", async () => {
  const page = `<h1>Status</h1><p id="clock">Updated 0 seconds ago by the server</p><button type="button">Refresh</button>
    <script>let n = 0; setInterval(() => document.getElementById('clock').textContent = 'Updated ' + (++n) + ' seconds ago by the server', 300)</script>`;
  const session = await start(page, async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return words("The status is shown at the top of the page.");
  });
  try {
    await session.ask("where is the status");
    await session.untilState("finished", 8000);
    await session.page.waitForTimeout(500);
    assert.equal(session.requests.length, 1);
  } finally {
    await session.close();
  }
});

test("the first reading waits while the page shows its spinner, though its frame already has controls", async () => {
  // OrangeHRM's dashboard: the menu is drawn at once, the rest only after its spinner goes.
  const page = `<nav><a href="#a">Admin</a> <a href="#b">Leave</a></nav><main id="main"><div class="oxd-loading-spinner" style="width:40px;height:40px;border:4px solid #ccc"></div></main>
    <script>setTimeout(() => document.getElementById('main').innerHTML = '<h1>Dashboard</h1>' + ['Assign Leave', 'Leave List', 'Timesheets', 'Apply Leave', 'My Leave'].map((name) => '<button type="button">' + name + '</button>').join(''), 4500)</script>`;
  const session = await start(page, () => words("Use Apply Leave on the dashboard."));
  try {
    await session.ask("how do I ask for leave");
    const first = await session.untilAsked(1, 10_000);
    assert.ok(first.snapshot.elements.some((element) => element.label === "Apply Leave"), `the page was read while its spinner was up: ${first.snapshot.elements.map((element) => element.label).join(", ")}`);
  } finally {
    await session.close();
  }
});

/**
 * A page far longer than the 300 controls the widget lists, like a Wikipedia
 * article: forty parts, each with a heading, a paragraph and a dozen links.
 * The list keeps what is on screen first, so scrolling alone changes what is
 * listed while nothing on the page changes.
 */
const LONG = `<header><button type="button">Settings</button></header><main>${Array.from(
  { length: 40 },
  (_, part) =>
    `<h2>Part ${part + 1}</h2><p>These are the words of part ${part + 1}, long enough to be read as a sentence of their own.</p><p>${Array.from(
      { length: 12 },
      (_, link) => `<a href="/part/${part + 1}/page/${link + 1}">Page ${link + 1} of part ${part + 1}</a> `,
    ).join("")}</p>`,
).join("")}</main>`;

test("scrolling a long page while the model answers is not a change: the answer is shown and nothing is asked again", async () => {
  const session = await start(LONG, async (request) => {
    // The visitor scrolls to the foot of the page while the model is answering.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return point(request, "Settings", "Click Settings at the top of the page.");
  });
  try {
    await session.ask("where are the settings");
    await session.untilAsked(1);
    await session.page.waitForTimeout(300);
    await session.page.mouse.wheel(0, 40_000);
    await session.untilState("pointing", 8000);
    await session.page.waitForTimeout(2500);
    assert.equal(session.requests.length, 1, `asked again: ${session.requests[1]?.event ?? ""}`);
  } finally {
    await session.close();
  }
});

test("a key that only scrolls a long page, pressed while a sentence is up, is not taken for the step", async () => {
  const session = await start(LONG, (request, index) => (index === 0 ? words("Press Enter to open the settings.", "continue") : words("The settings are open.")));
  try {
    await session.ask("where are the settings");
    await session.untilState("watching");
    // Space scrolls the page a screen at a time. Nothing on the page changes.
    for (let press = 0; press < 6; press++) await session.page.keyboard.press("Space");
    await session.page.waitForTimeout(3000);
    assert.equal(session.requests.length, 1, `asked again: ${session.requests[1]?.event ?? ""}`);
    assert.equal(await session.state(), "watching");
  } finally {
    await session.close();
  }
});

test("a dialog that fades out after Close is not read while it fades: the page is read once it is gone", async () => {
  // Ant Design's drawer and Material UI's pickers: the class that starts the fade is the last change to the page until the box is taken away.
  const page = `<h1>Settings</h1><button type="button">Edit profile</button>
    <style>#drawer { transition: opacity 600ms linear } #drawer.leaving { opacity: 0 }</style>
    <div id="drawer" role="dialog" aria-modal="true" aria-label="Basic Drawer" style="position:fixed;right:0;top:0;bottom:0;width:320px;background:#fff;border-left:1px solid #999;padding:16px">
      <button id="close" type="button">Close drawer</button><button type="button">Apply changes</button>
    </div>
    <script>
      const drawer = document.getElementById('drawer');
      document.getElementById('close').addEventListener('click', () => {
        drawer.classList.add('leaving');
        drawer.addEventListener('transitionend', () => drawer.remove(), { once: true });
      });
    </script>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Close drawer", "Click Close drawer.") : words("Done.")));
  try {
    await session.ask("close this");
    await session.untilState("pointing");
    await session.page.locator("#close").click();
    const second = await session.untilAsked(2, 8000);
    const labels = second.snapshot.elements.map((element) => element.label);
    assert.ok(!labels.includes("Apply changes"), `the closing drawer was read: ${labels.join(", ")}`);
    assert.ok(labels.includes("Edit profile"));
  } finally {
    await session.close();
  }
});

test("a page that shows several spinners for good is waited for once, not once for each spinner", async () => {
  // Material UI's page of buttons: its "loading" buttons spin for as long as the page is open.
  const page = `<h1>Buttons</h1><button type="button">Contained</button>
    ${[1, 2, 3].map((n) => `<button type="button" disabled>Saving ${n} <span role="progressbar" style="display:inline-block;width:12px;height:12px;border:2px solid #999"></span></button>`).join("")}`;
  const session = await start(page, () => words("Click Contained."));
  try {
    const began = Date.now();
    await session.ask("which button");
    await session.untilAsked(1, 20_000);
    const waited = Date.now() - began;
    assert.ok(waited < 14_000, `the first question waited ${waited} ms`);
  } finally {
    await session.close();
  }
});
