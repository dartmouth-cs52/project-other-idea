import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// What the widget hears, and what it tells the model happened. Each page is
// the smallest one that behaves like the real app the fault was seen on.

/** Asks, waits for the pointer, and gives back the session. The first reply points at `label`. */
async function pointing(page: string, label: string, later: Parameters<typeof start>[1] = () => words("Done.")): Promise<Session> {
  const session = await start(page, (request, index) => (index === 0 ? point(request, label, `Use ${label}.`) : later(request, index)));
  await session.ask("help me");
  await session.untilState("pointing");
  return session;
}

test("a press that acts when the mouse comes up, and takes the control away, is heard however long it was held", async () => {
  const page = `<h1>Menu</h1><div id="opt" role="option" tabindex="0" style="padding:8px;border:1px solid #999;width:200px">Recent changes</div><p id="out"></p><button type="button">Back</button>
    <script>document.getElementById('opt').addEventListener('mouseup', (event) => { event.currentTarget.remove(); document.getElementById('out').textContent = 'Showing recent changes for this page.'; })</script>`;
  for (const held of [100, 650]) {
    const session = await pointing(page, "Recent changes");
    try {
      const box = await session.page.locator("#opt").boundingBox();
      await session.page.mouse.move(box.x + 20, box.y + 10);
      await session.page.mouse.down();
      await session.page.waitForTimeout(held);
      await session.page.mouse.up();
      const second = await session.untilAsked(2, 5000).catch(() => undefined);
      assert.ok(second, `a press held ${held} ms was not heard`);
      assert.match(second.event ?? "", /^The user clicked option "Recent changes"\. It is no longer on the page\./);
    } finally {
      await session.close();
    }
  }
});

test("a pressed option that is moved out from under the mouse, not removed, is heard", async () => {
  // The list acts as the mouse goes down: it clips the option and moves it away, and no click on it follows.
  const page = `<h1>Tools</h1><div id="list" style="position:relative;height:40px"><div id="opt" role="option" tabindex="0" style="position:absolute;left:0;top:0;padding:8px;width:200px;border:1px solid #999">What links here</div></div><p id="out"></p>
    <script>document.getElementById('opt').addEventListener('mousedown', (event) => { const el = event.currentTarget; el.style.left = '-5000px'; el.style.clip = 'rect(0,0,0,0)'; document.getElementById('out').textContent = 'Pages that link to this one are listed here.'; })</script>`;
  const session = await pointing(page, "What links here");
  try {
    const box = await session.page.locator("#opt").boundingBox();
    await session.page.mouse.move(box.x + 20, box.y + 10);
    await session.page.mouse.down();
    await session.page.waitForTimeout(550);
    await session.page.mouse.up();
    const second = await session.untilAsked(2, 5000);
    assert.match(second.event ?? "", /^The user clicked option "What links here"\./);
  } finally {
    await session.close();
  }
});

test("a click into a frame inside the pointed control is heard", async () => {
  const page = `<h1>Dashboard</h1><div id="panel" role="button" tabindex="0" aria-label="Sales panel" style="width:400px;height:260px;border:1px solid #999;padding:4px">
      <iframe id="frame" srcdoc="<p>Chart</p>" style="width:100%;height:230px;border:0"></iframe></div>`;
  const session = await pointing(page, "Sales panel");
  try {
    const box = await session.page.locator("#frame").boundingBox();
    await session.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const second = await session.untilAsked(2, 5000);
    assert.match(second.event ?? "", /^The user clicked button "Sales panel"\./);
  } finally {
    await session.close();
  }
});

test("a press on something that is no control, followed by a dialog, is a step and not a wrong click", async () => {
  const page = `<h1>Board</h1><button id="add" type="button">Add card</button><div id="tile" style="padding:20px;border:1px solid #999;width:200px">Quarterly plan</div>
    <div id="dialog" role="dialog" aria-modal="true" aria-label="Quarterly plan" hidden style="position:fixed;inset:20% 30%;background:#fff;border:1px solid #333;padding:16px"><button type="button">Close</button></div>
    <script>document.getElementById('tile').addEventListener('click', () => document.getElementById('dialog').hidden = false)</script>`;
  const session = await pointing(page, "Add card");
  try {
    // Away from the caption's close button, which is the one part of the caption that takes clicks.
    await session.page.locator("#tile").click({ position: { x: 10, y: 10 } });
    const second = await session.untilAsked(2, 5000);
    assert.equal(second.event, "The page changed after something the user did that could not be identified.");
    assert.match(second.change ?? "", /Dialog "Quarterly plan" opened/);
  } finally {
    await session.close();
  }
});

test("typing in a search box that writes the search into the address is not leaving", async () => {
  const page = `<h1>Dashboards</h1><input id="q" aria-label="Search dashboards"><button type="button">New</button>
    <script>document.getElementById('q').addEventListener('input', (event) => history.replaceState(null, '', '?query=' + event.target.value.length))</script>`;
  const session = await pointing(page, "Search dashboards");
  try {
    await session.page.locator("#q").pressSequentially("sales", { delay: 150 });
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user filled in textbox "Search dashboards"\. You can't see what they entered\./);
  } finally {
    await session.close();
  }
});

test("a field that shows what comes next only when it is left is asked about again once it is left", async () => {
  const page = `<h1>Step 3</h1><label>Card holder <input id="name"></label><button id="help" type="button">Help</button><span id="next"></span>
    <script>document.getElementById('name').addEventListener('blur', () => document.getElementById('next').innerHTML = '<button type="button">Step 4</button>')</script>`;
  const session = await pointing(page, "Card holder", (request, index) => (index === 1 ? point(request, "Help", "Click Help if you are unsure.") : words("Go on to step 4.")));
  try {
    await session.page.locator("#name").pressSequentially("Sam");
    await session.untilAsked(2);
    await session.until(async () => (await session.pointed()) === "help", "the pointer to move on");
    await session.page.locator("#name").press("Tab");
    const third = await session.untilAsked(3, 5000);
    assert.equal(third.event, 'The user left textbox "Card holder".');
    assert.match(third.change ?? "", /New: button "Step 4"/);
  } finally {
    await session.close();
  }
});

test("a click that only jumps within the page says where it landed", async () => {
  const page = `<h1>Article</h1><a id="toc" href="#disclaimers">Disclaimers</a><div style="height:1500px"></div><h2 id="disclaimers">Disclaimers</h2><p>This article is provided as is, with no warranty of any kind.</p><div style="height:900px"></div>`;
  const session = await pointing(page, "Disclaimers");
  try {
    await session.page.locator("#toc").click();
    const second = await session.untilAsked(2, 5000);
    assert.match(second.event ?? "", /^The user clicked link "Disclaimers"\..* The page jumped to "Disclaimers"\./);
  } finally {
    await session.close();
  }
});

test("an event names a control with its row, and says what became of it", async () => {
  const rows = ["Laptops", "Phones", "Tablets"].map((name) => `<tr><th>${name}</th><td><input type="radio" name="pick" aria-label="Item Selection"></td></tr>`).join("");
  const session = await start(`<h1>Categories</h1><table>${rows}</table>`, (request, index) =>
    index === 0 ? { target: request.snapshot.elements.filter((element) => element.label === "Item Selection")[1]!.id, status: "continue", say: "Select Phones." } : words("Phones is selected."),
  );
  try {
    await session.ask("pick phones");
    await session.untilState("pointing");
    await session.page.locator("input[type=radio]").nth(1).check();
    const second = await session.untilAsked(2, 5000);
    assert.equal(second.event, 'The user clicked radio "Item Selection" [row: Phones]. It is e2 in the list now, and is now checked.');
  } finally {
    await session.close();
  }
});

const COMBO = `<h1>Table</h1>
  <div id="wrap" style="position:relative;width:200px"><input id="size" role="combobox" readonly aria-label="Page size" aria-expanded="false" aria-controls="size-list" style="width:180px">
    <div id="drop" hidden style="position:absolute;top:28px;left:0;width:190px;background:#fff;border:1px solid #999">
      <div id="size-list" role="listbox" style="height:0;overflow:hidden"></div>
      <div class="row" style="cursor:pointer;padding:6px">10 / page</div><div class="row" style="cursor:pointer;padding:6px">50 / page</div>
    </div></div><p id="out"></p>
  <script>
    const input = document.getElementById('size'), drop = document.getElementById('drop');
    input.addEventListener('click', () => { drop.hidden = false; input.setAttribute('aria-expanded', 'true'); });
    for (const row of document.querySelectorAll('.row')) row.addEventListener('click', () => { drop.hidden = true; input.setAttribute('aria-expanded', 'false'); document.getElementById('out').textContent = 'Now showing ' + row.textContent; });
  </script>`;

test("a click on a plain row in the list a combobox opened is the pick, not a wrong click and not nothing", async () => {
  const session = await pointing(COMBO, "Page size", (request, index) => (index === 1 ? point(request, "Page size", "Choose 50 / page from the list.") : words("The table shows 50 rows.")));
  try {
    await session.page.locator("#size").click();
    await session.untilAsked(2);
    await session.until(async () => (await session.caption()) === "Choose 50 / page from the list.", "the second sentence to be on show");
    await session.page.locator(".row").nth(1).click();
    const third = await session.untilAsked(3, 6000);
    assert.match(third.event ?? "", /^The user chose .* from the list that combobox "Page size" opened\./);
    assert.doesNotMatch(third.event ?? "", /instead of/);
  } finally {
    await session.close();
  }
});

test("a range picked in a calendar is one step, heard when the calendar closes", async () => {
  const days = Array.from({ length: 28 }, (_, day) => `<td style="cursor:pointer;padding:4px" aria-label="${day + 1} March">${day + 1}</td>`).join("");
  const page = `<h1>Report</h1><input id="dates" aria-label="Dates"><div id="cal" hidden style="position:absolute;top:120px;left:24px;background:#fff;border:1px solid #999"><table><tr>${days}</tr></table></div><button type="button">Run</button>
    <script>
      const cal = document.getElementById('cal'); let picked = 0;
      document.getElementById('dates').addEventListener('focus', () => cal.hidden = false);
      for (const cell of cal.querySelectorAll('td')) cell.addEventListener('click', () => { if (++picked === 2) cal.hidden = true; });
    </script>`;
  const session = await pointing(page, "Dates");
  try {
    await session.page.locator("#dates").click();
    await session.page.locator("#cal td").nth(11).click();
    await session.page.waitForTimeout(900);
    assert.equal(session.requests.length, 1, "the pick was reported before the range had its second date");
    await session.page.locator("#cal td").nth(18).click();
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user chose "12 March" and "19 March" from the list that textbox "Dates" opened\./);
    await session.page.waitForTimeout(600);
    assert.equal(session.requests.length, 2);
  } finally {
    await session.close();
  }
});

test("a field whose list of choices opens, with a visitor who then stops, is asked about so the pointer can move to the choice", async () => {
  const page = `<h1>New component</h1><input id="owner" role="combobox" aria-label="Owner" aria-expanded="false" aria-controls="owners"><ul id="owners" role="listbox" hidden><li role="option" tabindex="-1">team-a</li><li role="option" tabindex="-1">team-b</li></ul>
    <script>const owner = document.getElementById('owner'); owner.addEventListener('click', () => { document.getElementById('owners').hidden = false; owner.setAttribute('aria-expanded', 'true'); })</script>`;
  const session = await pointing(page, "Owner");
  try {
    await session.page.locator("#owner").click();
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user clicked into combobox "Owner", and a list of choices opened\./);
    assert.match(second.change ?? "", /New: option "team-a", option "team-b"/);
  } finally {
    await session.close();
  }
});

test("a form the browser would not send says so, naming the first field and nothing typed", async () => {
  const page = `<h1>Sign up</h1><form onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'Thanks for signing up.'">
      <label>Email <input id="email" type="email" required></label><label>City <input required></label><button id="go">Create account</button></form><p id="out"></p>`;
  const session = await pointing(page, "Create account");
  try {
    await session.page.locator("#email").fill("sam-at-example");
    await session.page.locator("#go").click();
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user clicked button "Create account"\. It is e\d+ in the list now, and looks unchanged\. The browser would not send the form: textbox "Email" is not filled in the way the form needs\.$/);
    assert.ok(!JSON.stringify(session.requests).includes("sam-at-example"));
  } finally {
    await session.close();
  }
});

test("a click the page makes by script while the visitor presses the pointed field is not the visitor's, and not a wrong click", async () => {
  // Jira's Created filter: pressing the "Within the last" box makes the page click the row's radio button through its label.
  const page = `<h1>Search</h1>
    <div style="padding:8px">
      <label for="withinRadio" style="position:absolute;left:-9999px">Within the last Timespan Time measurement</label><input type="radio" id="withinRadio">Within the last
      <label for="withinValue" style="position:absolute;left:-9999px">Timespan</label><input id="withinValue" type="text" maxlength="15">
      <label><span style="position:absolute;left:-9999px">Time measurement</span><select><option>minutes</option><option>days</option></select></label>
    </div><button type="button">Update</button>
    <script>
      document.getElementById('withinValue').addEventListener('mousedown', () => document.querySelector('label[for="withinRadio"]').click());
    </script>`;
  const session = await pointing(page, "Timespan", (request, index) => (index === 1 ? words("Now click Update.", "continue") : words("Done.")));
  try {
    const box = (await session.page.locator("#withinValue").boundingBox())!;
    await session.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await session.page.keyboard.type("7");
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user filled in textbox "Timespan"/);
  } finally {
    await session.close();
  }
});

test("a calendar that writes each picked day into the field by script is still a pick of days, not the visitor typing", async () => {
  // Carbon's date range picker (flatpickr): each click on a day puts the dates in the field and fires its input and change events.
  const days = Array.from({ length: 28 }, (_, day) => `<span class="day" tabindex="-1" aria-label="November ${day + 1}, 2026" style="display:inline-block;cursor:pointer;padding:4px">${day + 1}</span>`).join("");
  const page = `<h1>Report</h1><label for="start">Start date</label> <input id="start"><div id="cal" hidden style="position:absolute;top:120px;left:24px;width:280px;background:#fff;border:1px solid #999">${days}</div><button type="button">Run</button>
    <script>
      const cal = document.getElementById('cal'), start = document.getElementById('start'); const picked = [];
      start.addEventListener('focus', () => cal.hidden = false);
      for (const day of cal.querySelectorAll('.day')) day.addEventListener('click', () => {
        picked.push(day.textContent);
        start.value = '11/' + picked.join(' to 11/') + '/2026';
        start.dispatchEvent(new Event('input', { bubbles: true }));
        start.dispatchEvent(new Event('change', { bubbles: true }));
        if (picked.length === 2) cal.hidden = true;
      });
    </script>`;
  const session = await pointing(page, "Start date");
  try {
    await session.page.locator("#start").click();
    await session.page.locator("#cal .day").nth(9).click();
    await session.page.waitForTimeout(1600);
    assert.equal(session.requests.length, 1, "the first day was reported before the range had its second date");
    await session.page.locator("#cal .day").nth(13).click();
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user chose "November 10, 2026" and "November 14, 2026" from the list that textbox "Start date" opened\./);
  } finally {
    await session.close();
  }
});
