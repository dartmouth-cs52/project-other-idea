import assert from "node:assert/strict";
import { after, test } from "node:test";
import { launch, type Browser, type Page } from "../eval/browser.ts";
import { pickWhenQuiet, use, useAsBefore, type Shown } from "../eval/visitor.ts";

// The benchmark's simulated visitor (eval/visitor.ts) on a small local page
// that has one of each control it used to get wrong. Each test shows the old
// visitor's fault beside the new one's behaviour. They need Playwright and its
// browser, which this project does not install, and are skipped without them.

const browser: Browser | undefined = await launch().catch(() => undefined);
const skip = browser ? false : "Playwright or its browser is not installed here.";
after(() => browser?.close());

const PAGE = `<!doctype html><title>Visitor test</title>
<style>
  body { font: 14px sans-serif; margin: 20px; }
  .row { margin: 0 0 14px; position: relative; }
  .list { border: 1px solid #999; width: 200px; }
  .list div { padding: 4px; }
  .tick { position: relative; display: inline-block; padding: 4px 8px 4px 28px; }
  .tick input { position: absolute; left: 4px; top: 4px; width: 16px; height: 16px; opacity: 0; margin: 0; }
  .tick span.box { position: absolute; left: 4px; top: 4px; width: 16px; height: 16px; border: 1px solid #333; }
  #covered, #half { width: 160px; height: 30px; }
  .over { position: absolute; left: 0; top: 0; width: 160px; height: 30px; background: rgba(200, 0, 0, .4); }
  .dot { position: absolute; left: 60px; top: 5px; width: 40px; height: 20px; background: rgba(0, 0, 200, .4); }
</style>
<div class="row"><input id="ro" role="combobox" readonly placeholder="Page size"></div>
<div class="row"><input id="search" role="combobox" aria-autocomplete="list" placeholder="Owner"></div>
<div id="lists"></div>
<div class="row"><label class="tick" id="tick-label"><input type="checkbox" id="tick"><span class="box"></span>Last 24 hours</label></div>
<div class="row"><input id="q" placeholder="Search or jump to..."></div>
<div class="row"><table><tr><td><b>Find by date</b></td><td><input id="when"> (MM-DD-YYYY)</td></tr></table></div>
<div class="row"><select id="sel"><option>Minutes</option><option>Hours</option><option>Days</option></select></div>
<div class="row"><button id="covered">Covered</button><div class="over"></div></div>
<div class="row"><button id="half">Half covered</button><div class="dot"></div></div>
<div class="row"><input id="keys" aria-label="Amount"></div>
<ul role="menu" id="sidebar"><li role="menuitem">Rules</li><li role="menuitem">Settings</li></ul>
<div class="row"><input id="rule-name" placeholder="Rule name"></div>
<script>
  window.log = [];
  const lists = document.getElementById("lists");
  // A list that opens when the mouse goes down on its field and acts when the mouse goes down on an entry, as many do.
  const open = (field, entries) => {
    lists.innerHTML = '<div class="list" role="listbox">' + entries.map((text) => '<div role="option">' + text + "</div>").join("") + "</div>";
    for (const option of lists.querySelectorAll("[role=option]")) {
      option.addEventListener("mousedown", () => { window.log.push("picked " + option.textContent + " for " + field.id); lists.innerHTML = ""; });
    }
  };
  ro.addEventListener("mousedown", () => open(ro, ["10 / page", "20 / page", "50 / page"]));
  search.addEventListener("mousedown", () => open(search, ["Team A", "Team B"]));
  search.addEventListener("input", () => { lists.innerHTML = '<div class="list">No data</div>'; window.log.push("searched " + search.value); });
  // Drawn over the real input, and acting on the press, not on the click.
  document.getElementById("tick-label").addEventListener("mousedown", (event) => { if (event.isTrusted) window.log.push("ticked by a real press"); });
  for (const id of ["covered", "half"]) document.getElementById(id).addEventListener("click", (event) => window.log.push(id + (event.isTrusted ? " clicked by a real press" : " clicked by script")));
  let keys = 0;
  document.getElementById("keys").addEventListener("keydown", () => keys++);
  window.keysHeard = () => keys;
</script>`;

async function fresh(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.setContent(PAGE);
  return page;
}
const shown = (label: string, say: string, scripted?: Shown["scripted"]): Shown => ({ listed: { label, role: "textbox" }, say, ...(scripted ? { scripted } : {}) });
const log = (page: Page) => page.evaluate("window.log") as Promise<string[]>;
const valueOf = (page: Page, id: string) => page.evaluate(`document.getElementById("${id}").value`) as Promise<string>;

test("a read-only box that opens a list is clicked, and the named choice is picked when the widget stays quiet", { skip }, async () => {
  const page = await fresh();
  const box = await page.$("#ro");
  const say = "Open the page size list and choose 50 / page.";
  // Before: fill() on a read-only input can only time out.
  await assert.rejects(useAsBefore(page, box, { ...shown("Page size", say) }).then(() => undefined), /Timeout|not editable|readonly/i);
  const used = await use(page, box, shown("Page size", say));
  assert.equal(used.did, "clicked it");
  assert.equal(used.opened, true);
  assert.match(await pickWhenQuiet(page, say), /picked "50 \/ page" from the list it opened, which the sentence names/);
  assert.deepEqual(await log(page), ["picked 50 / page for ro"]);
  await page.close();
});

test("a box that searches as you type is opened and picked from, not filled with a made-up word", { skip }, async () => {
  const before = await fresh();
  await useAsBefore(before, await before.$("#search"), shown("Owner", "Open the Owner filter."));
  assert.deepEqual(await log(before), ["searched Test"], "the old visitor typed Test, and the list then says No data");
  await before.close();

  const page = await fresh();
  const used = await use(page, await page.$("#search"), shown("Owner", "Open the Owner filter."));
  assert.equal(used.opened, true);
  assert.equal(await valueOf(page, "search"), "");
  // Nothing in the sentence names a choice, so the visitor picks what the script picks next.
  assert.equal(await pickWhenQuiet(page, "Open the Owner filter.", '[role="option"]:has-text("Team B")'), "picked from the list it opened what the script picks next");
  assert.deepEqual(await log(page), ["picked Team B for search"]);
  await page.close();
});

test("a tick box under its own drawing is pressed with the real mouse and is not counted as covered", { skip }, async () => {
  const page = await fresh();
  const used = await use(page, await page.$("#tick"), { listed: { label: "Last 24 hours", role: "checkbox" }, say: "Tick Last 24 hours." });
  assert.equal(used.did, "clicked it");
  assert.equal(used.covered, undefined);
  assert.deepEqual(await log(page), ["ticked by a real press"]);
  await page.close();
});

test("the visitor types what the script or the sentence says before anything of its own", { skip }, async () => {
  const page = await fresh();
  const before = await useAsBefore(page, await page.$("#q"), shown("Search or jump to...", 'Type "Time series graphs" in the search box.'));
  assert.equal(before.did, 'typed "Test"');

  const quoted = await use(page, await page.$("#q"), shown("Search or jump to...", 'Type "Time series graphs" in the search box.'));
  assert.equal(quoted.did, 'clicked it and typed "Time series graphs", which the sentence asks for');
  assert.equal(await valueOf(page, "q"), "Time series graphs", "what was there is typed over, as a person would");

  await use(page, await page.$("#q"), shown("Search or jump to...", 'Type "Time series graphs" in the search box.', { fill: "from the script" }));
  assert.equal(await valueOf(page, "q"), "from the script");

  // The field's own name in quotes is not something to type.
  const named = await use(page, await page.$("#q"), shown("Search or jump to...", 'Click the "Search or jump to..." box.'));
  assert.equal(named.did, 'clicked it and typed "Test", for want of anything better');
  await page.close();
});

test("a field that shows the form of its date gets a date in that form", { skip }, async () => {
  const page = await fresh();
  const old = await useAsBefore(page, await page.$("#when"), shown("", "Type the date."));
  assert.equal(old.did, 'typed "Test"');
  const used = await use(page, await page.$("#when"), shown("", "Type the date."));
  assert.equal(used.did, 'clicked it and typed "12-01-2026", which suits the field');
  assert.equal(await valueOf(page, "when"), "12-01-2026");
  await page.close();
});

test("a dropdown gets the choice the script names, then the one the sentence names, then any other", { skip }, async () => {
  const page = await fresh();
  const list = { listed: { label: "Time measurement", role: "select" } };
  assert.equal((await useAsBefore(page, await page.$("#sel"), { ...list, say: "Change minutes to days." })).did, 'picked "Hours"', "the old visitor took the second entry whatever the sentence said");
  assert.equal((await use(page, await page.$("#sel"), { ...list, say: "Change minutes to days." })).did, 'picked "Days", which the sentence names');
  assert.equal((await use(page, await page.$("#sel"), { ...list, say: "Change minutes to days.", scripted: { select: "Hours" } })).did, 'picked "Hours"');
  assert.equal((await use(page, await page.$("#sel"), { ...list, say: "Pick the unit." })).did, 'picked "Minutes", for want of a named choice');
  await page.close();
});

test("a control under something unrelated is never clicked by script", { skip }, async () => {
  const page = await fresh();
  const old = await useAsBefore(page, await page.$("#covered"), { listed: { label: "Covered", role: "button" }, say: "Click Covered." });
  assert.equal(old.covered, true);
  assert.deepEqual(await log(page), ["covered clicked by script"], "the old visitor clicked through what a person cannot");

  const used = await use(page, await page.$("#covered"), { listed: { label: "Covered", role: "button" }, say: "Click Covered." });
  assert.equal(used.covered, true);
  assert.match(used.failed ?? "", /no part of it can be pressed: <div> is on top of it/);
  assert.deepEqual(await log(page), ["covered clicked by script"], "and the new one presses nothing");

  // With only its middle covered, a person presses the part they can see.
  const half = await use(page, await page.$("#half"), { listed: { label: "Half covered", role: "button" }, say: "Click Half covered." });
  assert.equal(half.covered, true);
  assert.equal(half.failed, undefined);
  assert.deepEqual((await log(page)).slice(1), ["half clicked by a real press"]);
  await page.close();
});

test("typing is done key by key, so a page that listens for keys hears them", { skip }, async () => {
  const page = await fresh();
  await useAsBefore(page, await page.$("#keys"), shown("Amount", "Type the amount."));
  assert.equal(await page.evaluate("window.keysHeard()"), 0, "fill() presses no key");
  const used = await use(page, await page.$("#keys"), shown("Amount", "Type the amount."));
  assert.equal(used.did, 'clicked it and typed "2", which suits the field');
  assert.ok(((await page.evaluate("window.keysHeard()")) as number) >= 1);
  await page.close();
});

test("a menu that was on show all along is not taken for a list the field opened", { skip }, async () => {
  const page = await fresh();
  const used = await use(page, await page.$("#rule-name"), shown("Rule name", "Enter a name for the rule."));
  assert.equal(used.opened, undefined, "the sidebar's entries were there before the field was pressed");
  assert.equal(used.did, 'clicked it and typed "Sam Okafor", which suits the field');
  assert.equal(await pickWhenQuiet(page, "Enter a name for the rule."), "", "and nothing in the sidebar is picked");
  await page.close();
});
