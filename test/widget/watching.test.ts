import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words } from "./harness.ts";

after(closeBrowser);

// Steps with nothing to point at, steps at a control already used, and
// controls the page draws again: none of them may end a guide.

const SEARCH = `
  <h1>Orders</h1>
  <input id="q" aria-label="Search orders">
  <button id="help" type="button">Help</button>
  <ul id="found"></ul>
  <script>
    document.getElementById('q').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') document.getElementById('found').innerHTML = '<li><button type="button">Order 7 for Priya</button></li>';
    });
  </script>`;

test("a reply that asks for a key press, with nothing to point at, waits for the key and asks again", async () => {
  const session = await start(SEARCH, (request, index) => {
    if (index === 0) return point(request, "Search orders", "Type the customer's name in the search box.");
    if (index === 1) return words("Press Enter to search.", "continue");
    return words("The order is listed below the search box.");
  });
  try {
    await session.ask("find Priya's order");
    await session.untilState("pointing");
    await session.page.locator("#q").pressSequentially("Priya");
    await session.untilAsked(2);
    await session.untilState("watching");
    assert.equal(await session.caption(), "Press Enter to search.");
    assert.equal(await session.pointed(), null);
    await session.page.locator("#q").press("Enter");
    const third = await session.untilAsked(3);
    assert.match(third.event ?? "", /^The user pressed Enter\./);
    // The page repeats the name the visitor typed in the search box: what they typed is not sent, wherever the page shows it.
    assert.match(third.change ?? "", /New: button "Order 7 for \[typed\]"/);
    await session.untilState("finished");
  } finally {
    await session.close();
  }
});

test("a second pointer at the same field, asking for a key press there, is a new step", async () => {
  const session = await start(SEARCH, (request, index) => {
    if (index === 0) return point(request, "Search orders", "Type the customer's name in the search box.");
    if (index === 1) return point(request, "Search orders", "Press Enter to search.");
    return words("The order is listed below the search box.");
  });
  try {
    await session.ask("find Priya's order");
    await session.untilState("pointing");
    await session.page.locator("#q").pressSequentially("Priya");
    await session.untilAsked(2);
    await session.until(async () => (await session.caption()) === "Press Enter to search.", "the second sentence to be on show");
    assert.equal(await session.state(), "pointing");
    assert.equal(await session.pointed(), "q");
    await session.page.locator("#q").press("Enter");
    const third = await session.untilAsked(3);
    assert.match(third.event ?? "", /^The user pressed Enter in textbox "Search orders"\./);
    assert.equal(session.requests.length, 3);
  } finally {
    await session.close();
  }
});

test("with a sentence up and no pointer, a page that changes by itself is not a step, and what the visitor does is", async () => {
  const page = `
    <h1>Report</h1>
    <button id="region" type="button" onclick="document.getElementById('menu').hidden = false">Region</button>
    <div id="menu" hidden><label><input type="checkbox" checked> East</label></div>
    <p id="clock">Updated 0 seconds ago, and counting</p>
    <script>let n = 0; setInterval(() => document.getElementById('clock').textContent = 'Updated ' + (++n) + ' seconds ago, and counting', 1000)</script>`;
  const session = await start(page, (request) => (/clicked/.test(request.event ?? "") ? words("East is in the menu.") : words("Open the Region menu and untick East.", "continue")));
  try {
    await session.ask("leave out the east region");
    await session.untilState("watching");
    // A clock that ticks is not the page moving on, so nothing is asked again, and while the sentence waits the clock is not heard.
    await session.page.waitForTimeout(6000);
    const before = session.requests.length;
    assert.equal(before, 1, `${before} questions were asked of a page that only ticked`);
    assert.equal(await session.state(), "watching");
    assert.equal(await session.caption(), "Open the Region menu and untick East.");
    await session.page.locator("#region").click();
    const next = await session.untilAsked(before + 1);
    assert.match(next.event ?? "", /^The user clicked button "Region"\./);
    await session.untilState("finished");
  } finally {
    await session.close();
  }
});

test("a last step that is a field is used by typing in it, not by clicking into it", async () => {
  const session = await start(`<h1>Contact details</h1><label>Mobile <input id="mobile"></label><button type="button">Save</button>`, (request, index) =>
    index === 0 ? point(request, "Mobile", "Enter your new number in the Mobile field, then click Save.", "done") : point(request, "Save", "Click Save."),
  );
  try {
    await session.ask("change my mobile number");
    await session.untilState("pointing");
    await session.page.locator("#mobile").click();
    await session.page.waitForTimeout(700);
    assert.equal(await session.state(), "pointing");
    assert.equal(await session.caption(), "Enter your new number in the Mobile field, then click Save.");
    assert.equal(session.requests.length, 1);
    await session.page.locator("#mobile").pressSequentially("5550100");
    const second = await session.untilAsked(2);
    assert.equal(second.closing, true);
    assert.match(second.event ?? "", /^The user filled in textbox "Mobile"\. You can't see what they entered\./);
    assert.ok(!JSON.stringify(session.requests).includes("5550100"));
  } finally {
    await session.close();
  }
});

test("pointing twice at a control that changes nothing earns a hint, and the guide goes on", async () => {
  const session = await start(`<h1>Form</h1><button id="apply" type="button">Apply</button><button type="button">Other</button>`, (request, index) => point(request, "Apply", `Click Apply. ${index}`));
  try {
    await session.ask("apply it");
    for (let asked = 1; asked <= 3; asked++) {
      await session.untilAsked(asked);
      await session.until(async () => (await session.caption()) === `Click Apply. ${asked - 1}`, `answer ${asked} to be on show`);
      await session.page.locator("#apply").click();
    }
    await session.untilAsked(4);
    assert.doesNotMatch(session.requests[1]!.event ?? "", /twice/);
    assert.match(session.requests[1]!.event ?? "", /^The user clicked button "Apply"\. It is e1 in the list now, and looks unchanged\.$/);
    assert.match(session.requests[2]!.event ?? "", /You have pointed at button "Apply" twice from this page and nothing changed\. Choose something not yet tried, or say what is blocking\.$/);
    await session.untilState("pointing");
    // What is kept as history never carries an id, which would be stale by the next question.
    assert.ok(!JSON.stringify(session.requests[3]!.history).includes("in the list now"));
  } finally {
    await session.close();
  }
});

const REDRAWN = `
  <h1>Settings</h1>
  <div id="app"></div>
  <p id="out"></p>
  <script>
    window.draw = () => {
      document.getElementById('app').innerHTML = '<button type="button">Cancel</button><button type="button" class="save">Save</button>';
      document.querySelector('.save').onclick = () => document.getElementById('out').textContent = 'Saved by the new button.';
    };
    window.draw();
  </script>`;

test("a control the page drew again while the model was answering is found and pointed at, with no more questions", async () => {
  const session = await start(REDRAWN, async (request, index) => {
    if (index > 0) return words("Saved.");
    await session.page.evaluate(() => (window as unknown as { draw: () => void }).draw());
    return point(request, "Save", "Click Save.");
  });
  try {
    await session.ask("save my settings");
    await session.untilState("pointing");
    assert.equal(session.requests.length, 1);
    assert.equal(await session.page.evaluate(() => (document.querySelector("haptic-root") as unknown as { pointedAt: Element }).pointedAt === document.querySelector(".save")), true);
    await session.page.locator(".save").click();
    const second = await session.untilAsked(2);
    assert.match(second.event ?? "", /^The user clicked button "Save"\./);
  } finally {
    await session.close();
  }
});

test("a control the page draws again while the pointer is on it keeps its pointer", async () => {
  const session = await start(REDRAWN, (request, index) => (index === 0 ? point(request, "Save", "Click Save.") : words("Saved.")));
  try {
    await session.ask("save my settings");
    await session.untilState("pointing");
    await session.page.evaluate(() => (window as unknown as { draw: () => void }).draw());
    await session.until(() => session.page.evaluate(() => (document.querySelector("haptic-root") as unknown as { pointedAt: Element }).pointedAt === document.querySelector(".save")), "the pointer to be on the new button");
    assert.equal(await session.state(), "pointing");
    assert.equal(session.requests.length, 1);
    await session.page.locator(".save").click();
    await session.untilAsked(2);
    assert.match(session.requests[1]!.event ?? "", /^The user clicked button "Save"\./);
  } finally {
    await session.close();
  }
});
