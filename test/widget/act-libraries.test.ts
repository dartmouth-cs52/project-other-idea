import assert from "node:assert/strict";
import { after, test } from "node:test";
import { LIBRARIES, openPage, type ActPage } from "./act/harness.ts";
import { closeBrowser } from "./harness.ts";

after(closeBrowser);

// The acting engine on a card form built from the real React 19, Radix and
// cmdk, the way the demo app's card wizard is built (act/fixtures/radix.jsx).
// Each test reads React's own state afterwards. These libraries are not
// dependencies of the project: the tests are skipped when they cannot be
// found (see act/harness.ts for how to add them).

const skip = LIBRARIES ? false : "React, Radix and cmdk are not installed here; see test/widget/act/harness.ts";
const json = (value: unknown) => JSON.stringify(value);

async function onForm(check: (page: ActPage, state: () => Promise<Record<string, unknown>>) => Promise<void>) {
  const page = await openPage(`<h1>New card</h1>`, { library: "radix" });
  try {
    await page.page.waitForSelector("#state");
    const state = async () => JSON.parse(await page.text("#state")) as Record<string, unknown>;
    await check(page, state);
  } finally {
    await page.close();
  }
}

test("React: a controlled input takes typed text into the component's state", { skip }, () =>
  onForm(async (page, state) => {
    const outcome = await page.run({ target: "#name", act: "type", control: "text", value: "Ads", role: "textbox", name: "Card name" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal((await state()).name, "Ads");
  }));

test("React: a controlled field that keeps only digits takes typed money one key at a time", { skip }, () =>
  onForm(async (page, state) => {
    const outcome = await page.run({ target: "#amount", act: "type", control: "text", value: "$500", role: "textbox", name: "Spending limit" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal((await state()).amount, "500");
  }));

test("React: a controlled native select is set, and the state follows", { skip }, () =>
  onForm(async (page, state) => {
    const outcome = await page.run({ target: "#country", act: "choose", control: "select", value: "Japan", role: "select", name: "Country" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal((await state()).country, "jp");
  }));

test("Radix Select, which opens on pointer down and picks on pointer up, ends on the option asked for", { skip }, () =>
  onForm(async (page, state) => {
    const outcome = await page.run({ target: "#interval", act: "choose", control: "combobox", value: "Per month", role: "combobox", name: "Limit interval" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal((await state()).interval, "monthly");
    assert.equal(await page.text("#interval"), "Per month▾");
    assert.equal(await page.page.$('[role="listbox"]'), null, "the list closed");
  }));

test("Radix Select: a choice written in other words finds the option that holds them", { skip }, () =>
  onForm(async (page, state) => {
    const outcome = await page.run({ target: "#interval", act: "choose", control: "combobox", value: "monthly", role: "combobox", name: "Limit interval" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal((await state()).interval, "monthly");
  }));

test("Radix radio cards: a radio is chosen, and what it shows appears", { skip }, () =>
  onForm(async (page, state) => {
    const outcome = await page.run({ target: "#who-someone", act: "click", control: "tick", want: true, role: "radio", name: "For someone else" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal((await state()).who, "someone");
    assert.ok(await page.page.$("#holder"), "the Cardholder field appeared");
  }));

test("Radix Popover with a cmdk list: opened, searched, and the person asked for picked", { skip }, () =>
  onForm(async (page, state) => {
    await page.run({ target: "#who-someone", act: "click", control: "tick", want: true, role: "radio", name: "For someone else" });
    const outcome = await page.run({ target: "#holder", act: "choose", control: "combobox", value: "Malika Cummerata", role: "combobox", name: "Cardholder" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal((await state()).holder, "p0-0");
    assert.equal(await page.text("#holder"), "Malika Cummerata⇅");
    assert.match(outcome.event ?? "", /^You chose "Malika Cummerata( Finance)?" from the list that combobox "Cardholder" opened\.$/);
    assert.ok(outcome.typed >= "Malika".length && outcome.typed < "Malika Cummerata".length, `typed ${outcome.typed} characters: the first word was enough`);
  }));

test("Radix Popover with a cmdk list: a name that two people share goes to the visitor", { skip }, () =>
  onForm(async (page, state) => {
    await page.run({ target: "#who-someone", act: "click", control: "tick", want: true, role: "radio", name: "For someone else" });
    const outcome = await page.run({ target: "#holder", act: "choose", control: "combobox", value: "Maya", role: "combobox", name: "Cardholder" });
    assert.equal(outcome.kind, "visitor", json(outcome));
    assert.match(outcome.say ?? "", /more than one match/);
    assert.equal((await state()).holder, null);
  }));

test("Radix Checkbox and Switch are set to on", { skip }, () =>
  onForm(async (page, state) => {
    const lock = await page.run({ target: "#lock", act: "check", control: "tick", want: true, role: "checkbox", name: "Lock to one merchant" });
    assert.equal(lock.kind, "done", json(lock));
    const online = await page.run({ target: "#online", act: "check", control: "tick", want: true, role: "switch", name: "Online payments" });
    assert.equal(online.kind, "done", json(online));
    const now = await state();
    assert.equal(now.lock, true);
    assert.equal(now.online, true);
  }));

test("Radix Tabs switch to the tab asked for", { skip }, () =>
  onForm(async (page, state) => {
    const outcome = await page.run({ target: "#tab-access", act: "click", control: "tab", role: "tab", name: "Access" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal((await state()).tab, "access");
  }));

test("Radix DropdownMenu: opened on pointer down, its submenu opened by resting on it, and the entry in it chosen", { skip }, () =>
  onForm(async (page, state) => {
    const opened = await page.run({ target: "#more", act: "click", control: "button", role: "button", name: "More" });
    assert.equal(opened.kind, "done", json(opened));
    assert.equal(opened.opened, true);
    const theme = await page.run({ target: "#theme", act: "click", control: "option", role: "menuitem", name: "Theme" });
    assert.equal(theme.kind, "done", json(theme));
    const dark = await page.run({ target: "#theme-dark", act: "click", control: "option", role: "menuitemradio", name: "Dark" });
    assert.equal(dark.kind, "done", json(dark));
    assert.equal((await state()).theme, "dark");
  }));

test("the demo's card form, step by step: radio, person, name, limit and interval all end as asked", { skip }, () =>
  onForm(async (page, state) => {
    const steps = [
      { target: "#who-someone", act: "click", control: "tick", want: true, role: "radio", name: "For someone else" },
      { target: "#holder", act: "choose", control: "combobox", value: "Malika Cummerata", role: "combobox", name: "Cardholder" },
      { target: "#name", act: "type", control: "text", value: "Ads", role: "textbox", name: "Card name" },
      { target: "#amount", act: "type", control: "text", value: "500", role: "textbox", name: "Spending limit" },
      { target: "#interval", act: "choose", control: "combobox", value: "Per month", role: "combobox", name: "Limit interval" },
    ] as const;
    for (const step of steps) {
      const outcome = await page.run({ ...step });
      assert.equal(outcome.kind, "done", `${step.name}: ${json(outcome)}`);
    }
    const now = await state();
    assert.deepEqual({ who: now.who, holder: now.holder, name: now.name, amount: now.amount, interval: now.interval }, { who: "someone", holder: "p0-0", name: "Ads", amount: "500", interval: "monthly" });
  }));
