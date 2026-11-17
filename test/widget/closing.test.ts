import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words } from "./harness.ts";

after(closeBrowser);

// A "done" reply with a pointer is the model calling something the last step
// before it has seen what the step does. The widget keeps listening, and when
// the visitor has used the control it reads the page and asks once more.

const EXPORT = `
  <h1>Orders</h1>
  <button id="export" type="button" onclick="document.getElementById('menu').hidden = false">Export</button>
  <div id="menu" hidden>
    <button id="csv" type="button" onclick="document.getElementById('out').textContent = 'Exported as CSV.'">CSV</button>
    <button id="excel" type="button">Excel</button>
  </div>
  <button id="other" type="button">Refresh</button>
  <p id="out"></p>
  <button id="count" type="button" onclick="this.textContent = 'Clicked ' + (++window.n)">Clicked 0</button>
  <button id="still" type="button">Still</button>
  <script>window.n = 0</script>`;

test("a guide does not end on a pointer: after the last step is used the page is read and the model asked again", async () => {
  const session = await start(EXPORT, (request, index) => {
    if (index === 0) return point(request, "Export", "Click Export to download your orders.", "done");
    if (index === 1) return point(request, "CSV", "Choose CSV.");
    return words("Your orders were exported as CSV.");
  });
  try {
    // Noted by the page as the widget sets each one. #csv is clicked as soon as its pointer shows, so that pointer can
    // last less time than a look at the state every so often takes, and one that missed it would see the questions on
    // either side of it as one.
    const states = await session.recordStates();
    assert.equal(await session.state(), "idle");
    await session.ask("how do I export my orders");
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "export");
    assert.equal(await session.caption(), "Click Export to download your orders.");
    await session.page.locator("#export").click();

    const second = await session.untilAsked(2);
    assert.equal(second.closing, true);
    assert.match(second.event ?? "", /^The user clicked button "Export"\./);
    assert.match(second.change ?? "", /New: button "CSV", button "Excel"/);
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "csv");
    await session.page.locator("#csv").click();

    const third = await session.untilAsked(3);
    assert.equal(third.closing, undefined);
    await session.untilState("finished");
    assert.equal(await session.caption(), "Your orders were exported as CSV.");
    assert.equal(await session.pointed(), null);
    // Nothing comes after "finished".
    await session.page.waitForTimeout(150);
    assert.deepEqual(await states(), ["idle", "asking", "pointing", "asking", "pointing", "asking", "finished"]);
  } finally {
    await session.close();
  }
});

test("the last step is put away, with no question, when the visitor does something else", async () => {
  for (const elsewhere of ["#other", "h1"]) {
    const session = await start(EXPORT, (request) => point(request, "Export", "Click Export.", "done"));
    try {
      await session.ask("how do I export my orders");
      await session.untilState("pointing");
      await session.page.locator(elsewhere).click();
      await session.untilState("finished");
      await session.page.waitForTimeout(900);
      assert.equal(session.requests.length, 1);
      assert.equal(await session.caption(), "");
      assert.equal(await session.pointed(), null);
    } finally {
      await session.close();
    }
  }
});

test("a guide looks again three times at most, then shows its pointer and is over", async () => {
  const session = await start(EXPORT, (request) => ({ target: request.snapshot.elements.find((element) => element.label.startsWith("Clicked"))!.id, status: "done", say: `Click it. ${request.step}` }));
  try {
    await session.ask("count for me");
    for (let asked = 1; asked <= 3; asked++) {
      await session.untilAsked(asked);
      await session.until(async () => (await session.caption()) === `Click it. ${asked - 1}`, `answer ${asked} to be on show`);
      assert.equal(await session.state(), "pointing");
      await session.page.locator("#count").click();
    }
    const fourth = await session.untilAsked(4);
    assert.deepEqual(session.requests.map((request) => request.closing), [undefined, true, true, true]);
    assert.equal(fourth.step, 3);
    await session.untilState("finished");
    assert.equal(await session.pointed(), "count");
    assert.equal(await session.caption(), "Click it. 3");
    // It is only on show now. A click anywhere puts it away and nothing more is asked.
    await session.page.locator("#count").click();
    await session.until(async () => (await session.caption()) === "", "the last pointer to be put away");
    await session.page.waitForTimeout(900);
    assert.equal(session.requests.length, 4);
    assert.equal(await session.state(), "finished");
  } finally {
    await session.close();
  }
});

test("a pointer that came back from a closing question earns another look only if using it changed the page", async () => {
  const session = await start(EXPORT, (request, index) => (index === 0 ? point(request, "Export", "Click Export.", "done") : point(request, "Still", "Your orders are listed here.", "done")));
  try {
    await session.ask("where are my orders");
    await session.untilState("pointing");
    await session.page.locator("#export").click();
    await session.untilAsked(2);
    await session.until(async () => (await session.pointed()) === "still", "the pointer to be on Still");
    assert.equal(await session.state(), "pointing");
    await session.page.locator("#still").click();
    await session.untilState("finished");
    await session.page.waitForTimeout(600);
    assert.equal(session.requests.length, 2);
    assert.equal(await session.caption(), "");
  } finally {
    await session.close();
  }
});

test("the closing question survives a page load", async () => {
  const pages = {
    "/": `<h1>Home</h1><a id="go" href="/reports">Reports</a>`,
    "/reports": `<h1>Reports</h1><p>Three reports are ready.</p><button type="button">New report</button>`,
  };
  const session = await start(pages, (request, index) => (index === 0 ? point(request, "Reports", "Click Reports.", "done") : words("This is the Reports page.")));
  try {
    await session.ask("where are the reports");
    await session.untilState("pointing");
    await session.page.locator("#go").click();
    const second = await session.untilAsked(2);
    assert.equal(second.closing, true);
    assert.equal(second.snapshot.path, "/reports");
    assert.match(second.event ?? "", /The user clicked link "Reports"\. A new page loaded: the user went from \/ to \/reports\./);
    await session.untilState("finished");
    assert.equal(await session.caption(), "This is the Reports page.");
    // The guide is over, so the next page starts with nothing running.
    await session.page.goto(`${session.origin}/`);
    await session.page.waitForSelector("haptic-root", { state: "attached" });
    await session.page.waitForTimeout(600);
    assert.equal(await session.state(), "idle");
    assert.equal(session.requests.length, 2);
  } finally {
    await session.close();
  }
});

test("a connection that drops before the answer is asked once more and the guide goes on; one that drops again ends it", async () => {
  // As a proxy closed the connection to the server mid-guide on Northpine: "Something went wrong" ended a guide that was going well.
  const session = await start(EXPORT, (request) => point(request, "Export", "Click Export."));
  try {
    let tries = 0;
    await session.page.context().route("**/v1/turn", (route: { abort(code: string): Promise<void>; fallback(): Promise<void> }) => (tries++ === 0 ? route.abort("connectionclosed") : route.fallback()));
    await session.ask("export to PDF");
    await session.untilState("pointing");
    assert.equal(tries, 2);
    assert.equal(await session.caption(), "Click Export.");
  } finally {
    await session.close();
  }

  const dropping = await start(EXPORT, (request) => point(request, "Export", "Click Export."));
  try {
    let tries = 0;
    await dropping.page.context().route("**/v1/turn", (route: { abort(code: string): Promise<void> }) => (tries++, route.abort("connectionclosed")));
    await dropping.ask("export to PDF");
    await dropping.untilState("finished");
    assert.equal(tries, 2);
    assert.equal(await dropping.caption(), "Something went wrong on our side. Try asking again.");
  } finally {
    await dropping.close();
  }
});

test("the guide is finished after a failure, after a reply with no pointer, and after the visitor stops it", async () => {
  const failing = await start(EXPORT, () => {
    throw new Error("The model is down.");
  });
  try {
    await failing.ask("anything");
    await failing.untilState("finished");
    assert.equal(await failing.caption(), "Something went wrong on our side. Try asking again.");
  } finally {
    await failing.close();
  }

  const session = await start(EXPORT, (request, index) => (index === 0 ? words("There is nothing to export here.") : point(request, "Export", "Click Export.")));
  try {
    await session.ask("export to PDF");
    await session.untilState("finished");
    assert.equal(await session.caption(), "There is nothing to export here.");
    // Asking again starts a new guide, and stopping it with the caption's own button ends it.
    await session.ask("export my orders");
    await session.untilState("pointing");
    await session.page.locator("haptic-root .caption .close").click();
    await session.untilState("finished");
    assert.equal(await session.caption(), "");
    assert.equal(await session.pointed(), null);
  } finally {
    await session.close();
  }
});

test("a reply that lands while the page seemed to be leaving is asked for again when the page stays", async () => {
  const session = await start(EXPORT, async (request, index) => {
    if (index === 0) return point(request, "Export", "Click Export.");
    if (index === 1) {
      // The click began a download: the browser says the page is leaving, and it never does.
      await session.page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
      return point(request, "CSV", "Choose CSV.");
    }
    return point(request, "CSV", "Choose CSV.");
  });
  try {
    await session.ask("how do I export my orders");
    await session.untilState("pointing");
    await session.page.locator("#export").click();
    await session.untilAsked(2);
    await session.untilAsked(3, 12_000);
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "csv");
  } finally {
    await session.close();
  }
});
