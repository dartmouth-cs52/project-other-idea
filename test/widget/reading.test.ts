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
