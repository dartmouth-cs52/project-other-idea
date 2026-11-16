import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openPage, type ActPage } from "./act/harness.ts";
import { closeBrowser } from "./harness.ts";

after(closeBrowser);

// The acting engine (src/widget/act.ts) on small pages built the way the
// common libraries build their controls. Each test runs one step the gate
// allowed and reads the state the page ends in, never the engine's word for
// it. The gate here allows everything (act/stub-gate.ts); its own rules are
// tested on their own. The real React, Radix and cmdk are in
// act-libraries.test.ts.

async function on(body: string, check: (page: ActPage) => Promise<void>, options: { path?: string; pages?: Record<string, string> } = {}) {
  const page = await openPage(options.pages ? { "/": body, ...options.pages } : body, options.path ? { path: options.path } : {});
  try {
    await check(page);
  } finally {
    await page.close();
  }
}

const json = (value: unknown) => JSON.stringify(value);

// Links and buttons ---------------------------------------------------------------

test("a link to another route of the app is followed, and the address changes", () =>
  on(
    `<nav><a id="cards" href="/cards">Cards</a></nav><main><h1 id="title">Home</h1></main>
    <script>
      // A router that takes over links, as single-page apps do.
      document.getElementById('cards').addEventListener('click', (event) => {
        event.preventDefault();
        history.pushState({}, '', '/cards');
        document.getElementById('title').textContent = 'Cards';
      });
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#cards", act: "click", control: "link", role: "link" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(outcome.event, 'You clicked link "Cards".');
      assert.equal(outcome.nothingChanged, undefined);
      assert.equal(await page.page.evaluate(() => location.pathname), "/cards");
      assert.equal(await page.text("#title"), "Cards");
      assert.equal(outcome.heard?.how, "clicked", "the guide's hearing heard the click as a visitor's");
    },
  ));

test("a plain link loads the next page", () =>
  on(
    `<a id="next" href="/two">Two</a>`,
    async (page) => {
      const ended = page.run({ target: "#next", act: "click", control: "link", role: "link" }).catch(() => "the page went away");
      await page.page.waitForURL(`${page.origin}/two`, { timeout: 5000 });
      assert.equal(await page.text("h1"), "Page two");
      await ended;
    },
    { pages: { "/two": `<h1>Page two</h1>` } },
  ));

test("a button is pressed, and what it shows is there", () =>
  on(
    `<button id="more" type="button">Show details</button><section id="details" hidden>Billing details</section>
    <script>document.getElementById('more').addEventListener('click', () => (document.getElementById('details').hidden = false));</script>`,
    async (page) => {
      const outcome = await page.run({ target: "#more", act: "click", control: "button", role: "button" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(outcome.nothingChanged, undefined);
      assert.equal(await page.page.isVisible("#details"), true);
    },
  ));

test("a button whose page ignores clicks that are not the visitor's own is reported as changing nothing, and nothing happens", () =>
  on(
    `<button id="open" type="button">Open report</button><section id="report" hidden>Report</section>
    <script>document.getElementById('open').addEventListener('click', (event) => { if (event.isTrusted) document.getElementById('report').hidden = false; });</script>`,
    async (page) => {
      const outcome = await page.run({ target: "#open", act: "click", control: "button", role: "button" });
      // DESIGN 3.5: a press heard with nothing visible coming of it goes back to the model as "Nothing visible on the page changed".
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(outcome.nothingChanged, true);
      assert.equal(await page.page.isVisible("#report"), false);
    },
  ));

test("a control drawn as a button that only listens for keys is used with Space or Enter once the press does nothing", () =>
  on(
    `<div id="toggle" role="button" tabindex="0">Expand all</div><p id="state">collapsed</p>
    <script>
      document.getElementById('toggle').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') document.getElementById('state').textContent = 'expanded';
      });
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#toggle", act: "click", control: "button", role: "button" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.text("#state"), "expanded");
    },
  ));

test("a press waits until the control is scrolled into view and still, and lands on it", () =>
  on(
    `<div style="height:1600px">Long page</div><button id="far" type="button">Load more</button><p id="loaded"></p>
    <script>document.getElementById('far').addEventListener('click', (event) => (document.getElementById('loaded').textContent = event.clientY > 0 && event.clientY < innerHeight ? 'on screen' : 'off screen'));</script>`,
    async (page) => {
      const outcome = await page.run({ target: "#far", act: "click", control: "button", role: "button" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.text("#loaded"), "on screen");
    },
  ));

test("a press is the events a mouse makes, in a mouse's order, with focus moved as a press moves it", () =>
  on(
    `<input id="before" aria-label="Before"><button id="b" type="button">Next</button><ol id="log"></ol>
    <script>
      const log = [];
      for (const type of ['pointerover','pointerenter','mouseover','mouseenter','pointermove','mousemove','pointerdown','mousedown','focus','pointerup','mouseup','click'])
        document.getElementById('b').addEventListener(type, (event) => log.push(type + (type === 'click' ? ':' + event.detail + ':' + (event.clientX > 0) : '')));
      window.pressLog = log;
      document.getElementById('before').focus();
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#b", act: "click", control: "button", role: "button" });
      assert.equal(outcome.kind, "done", json(outcome));
      const log = (await page.page.evaluate("window.pressLog")) as string[];
      const order = log.filter((type) => !/move/.test(type));
      assert.deepEqual(order, ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointerdown", "mousedown", "focus", "pointerup", "mouseup", "click:1:true"]);
      assert.ok(log.includes("pointermove"), "the pointer moved over it first");
    },
  ));

test("a page that asks its own question with confirm() stops acting once the visitor has answered it", () =>
  on(
    `<button id="archive" type="button">Archive</button><p id="state"></p>
    <script>document.getElementById('archive').addEventListener('click', () => { document.getElementById('state').textContent = confirm('Archive it?') ? 'yes' : 'no'; });</script>`,
    async (page) => {
      // The visitor takes a moment to read the question and answer it.
      page.page.on("dialog", (dialog: { accept(): Promise<void> }) => setTimeout(() => void dialog.accept(), 500));
      const outcome = await page.run({ target: "#archive", act: "click", control: "button", role: "button" });
      assert.equal(outcome.kind, "stop", json(outcome));
      assert.equal(outcome.say, "You answered the page's question, so I've stopped.");
    },
  ));

// Text ---------------------------------------------------------------------------

test("text typed into an input that listens for input, as Angular's forms do, reaches the form's model", () =>
  on(
    `<label for="name">Card name</label> <input id="name"> <output id="model"></output>
    <script>
      // Angular's DefaultValueAccessor: the model follows each input event, but not while a composition is under way.
      const input = document.getElementById('name');
      let composing = false;
      input.addEventListener('compositionstart', () => (composing = true));
      input.addEventListener('compositionend', () => { composing = false; document.getElementById('model').textContent = input.value; });
      input.addEventListener('input', () => { if (!composing) document.getElementById('model').textContent = input.value; });
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#name", act: "type", control: "text", value: "Ads", role: "textbox" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(outcome.event, 'You typed "Ads" in textbox "Card name".');
      assert.equal(await page.text("#model"), "Ads");
      assert.deepEqual(outcome.did, { name: "Card name", value: "Ads" });
      assert.equal(outcome.typed, 3);
    },
  ));

test("text typed into a Vue v-model.lazy field reaches the model when the next control is pressed", () =>
  on(
    `<label for="memo">Memo</label> <input id="memo"> <button id="next" type="button">Next</button> <output id="model"></output>
    <script>
      // Vue's vModelText with .lazy listens for change, which the browser fires when the field is left.
      const input = document.getElementById('memo');
      input.addEventListener('change', () => (document.getElementById('model').textContent = input.value));
    </script>`,
    async (page) => {
      const typed = await page.run({ target: "#memo", act: "type", control: "text", value: "Team lunch", role: "textbox" });
      assert.equal(typed.kind, "done", json(typed));
      assert.equal(await page.text("#model"), "", "the model waits for the field to be left");
      const next = await page.run({ target: "#next", act: "click", control: "button", role: "button" });
      assert.equal(next.kind, "done", json(next));
      assert.equal(await page.text("#model"), "Team lunch");
    },
  ));

test("text replaces what a field held, and goes on the field's undo stack", () =>
  on(
    `<label for="city">City</label> <input id="city" value="Oslo">`,
    async (page) => {
      const outcome = await page.run({ target: "#city", act: "type", control: "text", value: "Lisbon", role: "textbox" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.page.inputValue("#city"), "Lisbon");
      await page.page.keyboard.press("ControlOrMeta+z");
      assert.notEqual(await page.page.inputValue("#city"), "Lisbon", "undo takes Haptic's typing back");
    },
  ));

test("a field that keeps only digits takes typed money one key at a time, and the check reads its digits", () =>
  on(
    `<label for="limit">Spending limit</label> <input id="limit" inputmode="numeric"> <output id="model"></output>
    <script>
      const input = document.getElementById('limit');
      input.addEventListener('input', () => { input.value = input.value.replace(/[^0-9]/g, ''); document.getElementById('model').textContent = input.value; });
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#limit", act: "type", control: "text", value: "$500", role: "textbox" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.page.inputValue("#limit"), "500");
      assert.equal(await page.text("#model"), "500");
    },
  ));

test("where the browser will not edit the field, the field's own setter and an input event stand in, and a change follows", () =>
  on(
    `<label for="ref">Reference</label> <input id="ref"> <output id="model"></output> <output id="changed"></output>
    <script>
      document.execCommand = () => false;
      const input = document.getElementById('ref');
      input.addEventListener('input', (event) => (document.getElementById('model').textContent = input.value + '|' + event.inputType));
      input.addEventListener('change', () => (document.getElementById('changed').textContent = 'changed'));
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#ref", act: "type", control: "text", value: "INV-42", role: "textbox" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.page.inputValue("#ref"), "INV-42");
      assert.equal(await page.text("#model"), "INV-42|insertText");
      assert.equal(await page.text("#changed"), "changed");
    },
  ));

test("a text area takes several lines, and a new line is not an Enter key the page could take as send", () =>
  on(
    `<label for="note">Note</label> <textarea id="note"></textarea> <output id="sent"></output>
    <script>document.getElementById('note').addEventListener('keydown', (event) => { if (event.key === 'Enter') document.getElementById('sent').textContent = 'sent'; });</script>`,
    async (page) => {
      const outcome = await page.run({ target: "#note", act: "type", control: "text", value: "Line one\nLine two", role: "textbox" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.page.inputValue("#note"), "Line one\nLine two");
      assert.equal(await page.text("#sent"), "");
    },
  ));

test("a long text goes in one key at a time and then in chunks, in about a second and a half", () =>
  on(
    `<label for="desc">Description</label> <input id="desc">`,
    async (page) => {
      const text = "Quarterly offsite catering for the whole design team in Lisbon";
      const outcome = await page.run({ target: "#desc", act: "type", control: "text", value: text, role: "textbox" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.page.inputValue("#desc"), text);
      assert.ok(outcome.ms < 3500, `it took ${outcome.ms} ms`);
    },
  ));

test("Stop part way through typing: no character goes in after it, and what was typed is reported", () =>
  on(
    `<label for="desc">Description</label> <input id="desc">`,
    async (page) => {
      const outcome = await page.run({ target: "#desc", act: "type", control: "text", value: "Quarterly offsite catering", role: "textbox", stopAfterMs: 650 });
      assert.equal(outcome.kind, "stopped", json(outcome));
      const atStop = await page.page.inputValue("#desc");
      assert.ok(atStop.length > 0 && atStop.length < "Quarterly offsite catering".length, `"${atStop}" was typed by the time Stop came`);
      assert.equal(outcome.partly?.value, atStop);
      await page.page.waitForTimeout(400);
      assert.equal(await page.page.inputValue("#desc"), atStop);
    },
  ));

// Native selects --------------------------------------------------------------------------

test("a native select is set without opening the browser's list, and the page hears input and change", () =>
  on(
    `<label for="resets">Resets</label>
    <select id="resets"><option value="">Pick one</option><option value="day">Per day</option><option value="month">Per month</option></select>
    <output id="model"></output>
    <script>
      // Vue's v-model and Angular's SelectControlValueAccessor both listen for change.
      const select = document.getElementById('resets');
      select.addEventListener('change', () => (document.getElementById('model').textContent = select.value));
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#resets", act: "choose", control: "select", value: "Monthly", role: "select" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(outcome.event, 'You chose "Per month" in select "Resets".');
      assert.equal(await page.text("#model"), "month");
      assert.equal(outcome.heard?.how, "filled");
    },
  ));

test("a native select whose choice matches two options goes to the visitor", () =>
  on(
    `<label for="who">Approver</label> <select id="who"><option>Maya Chen</option><option>Maya Patel</option><option>Sam Okafor</option></select>`,
    async (page) => {
      const outcome = await page.run({ target: "#who", act: "choose", control: "select", value: "Maya", role: "select" });
      assert.equal(outcome.kind, "visitor", json(outcome));
      assert.equal(await page.page.inputValue("#who"), "Maya Chen", "nothing was changed");
    },
  ));

// Tick boxes, radios, switches -------------------------------------------------------------

const TICKS = `
  <label id="lock-label" style="display:inline-flex;gap:6px;align-items:center;cursor:pointer">
    <input id="lock" type="checkbox" style="position:absolute;opacity:0;width:1px;height:1px;margin:0">
    <span style="width:14px;height:14px;border:1px solid #333;display:inline-block"></span> Lock to one merchant
  </label>
  <div id="notify" role="checkbox" aria-checked="false" tabindex="0" style="display:inline-block;padding:4px;border:1px solid">Notify me</div>
  <fieldset><legend>Who is it for</legend>
    <input type="radio" name="who" id="me" checked> <label for="me">For me</label>
    <input type="radio" name="who" id="someone"> <label for="someone">For someone else</label>
  </fieldset>
  <button id="online" type="button" role="switch" aria-checked="false">Online payments</button>
  <script>
    // A custom tick box that listens for keys only, as some toolkits' do.
    const notify = document.getElementById('notify');
    notify.addEventListener('keydown', (event) => { if (event.key === ' ') { event.preventDefault(); notify.setAttribute('aria-checked', String(notify.getAttribute('aria-checked') !== 'true')); } });
    const online = document.getElementById('online');
    online.addEventListener('click', () => online.setAttribute('aria-checked', String(online.getAttribute('aria-checked') !== 'true')));
  </script>`;

test("a tick box drawn as a speck under its label is pressed through its label, and ends ticked", () =>
  on(TICKS, async (page) => {
    const outcome = await page.run({ target: "#lock", act: "check", control: "tick", want: true, role: "checkbox", name: "Lock to one merchant" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(outcome.event, 'You ticked checkbox "Lock to one merchant".');
    assert.equal(await page.page.isChecked("#lock"), true);
    assert.deepEqual(outcome.did, { name: "Lock to one merchant", value: "on" });
  }));

test("a tick box already as wanted is left alone, with no press at all", () =>
  on(TICKS, async (page) => {
    await page.page.check("#lock", { force: true });
    await page.watch("#lock-label");
    const outcome = await page.run({ target: "#lock", act: "check", control: "tick", want: true, role: "checkbox", name: "Lock to one merchant" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.match(outcome.event ?? "", /already ticked/);
    assert.deepEqual(await page.counted("#lock-label"), {});
    assert.equal(outcome.actions, 0);
  }));

test("unticking sets the state off rather than toggling it", () =>
  on(TICKS, async (page) => {
    await page.page.check("#lock", { force: true });
    const outcome = await page.run({ target: "#lock", act: "uncheck", control: "tick", want: false, role: "checkbox", name: "Lock to one merchant" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(await page.page.isChecked("#lock"), false);
  }));

test("a custom tick box that only listens for Space is ticked by the fallback, after one press and no second", () =>
  on(TICKS, async (page) => {
    await page.watch("#notify");
    const outcome = await page.run({ target: "#notify", act: "check", control: "tick", want: true, role: "checkbox" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(await page.page.getAttribute("#notify", "aria-checked"), "true");
    assert.equal((await page.counted("#notify")).click, 1, "one press, and then the key");
  }));

test("a radio is chosen through its label", () =>
  on(TICKS, async (page) => {
    const outcome = await page.run({ target: "#someone", act: "click", control: "tick", want: true, role: "radio", name: "For someone else", mine: true });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(outcome.event, 'You chose radio "For someone else".');
    assert.equal(await page.page.isChecked("#someone"), true);
    assert.deepEqual(outcome.did, { name: "For someone else", value: "on", mine: true });
  }));

test("a switch is turned on", () =>
  on(TICKS, async (page) => {
    const outcome = await page.run({ target: "#online", act: "check", control: "tick", want: true, role: "switch" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(outcome.event, 'You turned on switch "Online payments".');
    assert.equal(await page.page.getAttribute("#online", "aria-checked"), "true");
  }));

test("a tick box set in a page that saves at once trips the wire, and acting stops", () =>
  on(TICKS, async (page) => {
    await page.page.evaluate(() => ((window as unknown as { __gate: { tripped: boolean } }).__gate = { calls: [], covered: [], ungrounded: [], keysRefused: [], tripped: true } as never));
    const outcome = await page.run({ target: "#online", act: "check", control: "tick", want: true, role: "switch", tripwire: true });
    assert.equal(outcome.kind, "stop", json(outcome));
    assert.equal(outcome.reason, "tripwire");
  }));

// Tabs --------------------------------------------------------------------------------------

test("tabs that switch on mouse down, as Radix's do, end on the tab asked for", () =>
  on(
    `<div role="tablist">
      <button role="tab" id="t-general" aria-selected="true" aria-controls="p-general" type="button">General</button>
      <button role="tab" id="t-access" aria-selected="false" aria-controls="p-access" type="button" tabindex="-1">Access</button>
    </div>
    <div role="tabpanel" id="p-general">General settings</div><div role="tabpanel" id="p-access" hidden>Access settings</div>
    <script>
      for (const tab of document.querySelectorAll('[role=tab]')) tab.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || event.ctrlKey) return;
        for (const other of document.querySelectorAll('[role=tab]')) { other.setAttribute('aria-selected', String(other === tab)); document.getElementById(other.getAttribute('aria-controls')).hidden = other !== tab; }
      });
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#t-access", act: "click", control: "tab", role: "tab" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.page.getAttribute("#t-access", "aria-selected"), "true");
      assert.equal(await page.page.isVisible("#p-access"), true);
    },
  ));

// Lists that are opened, then picked from ----------------------------------------------------------

test("a list whose options act on mouse down is picked from, and the click a browser would send to what is now under the mouse is not sent", () =>
  on(
    `<button id="var" type="button" aria-haspopup="listbox" aria-expanded="false">Region: All</button>
    <div style="position:relative;height:200px">
      <button id="danger" type="button" style="position:absolute;top:20px;left:0;width:300px;height:80px">Delete dashboard</button>
    </div>
    <script>
      // Grafana's variable list: an option is taken as the mouse goes down, and the list is gone before it comes up.
      const trigger = document.getElementById('var');
      let clicks = 0;
      document.getElementById('danger').addEventListener('click', () => (window.dangerClicks = ++clicks));
      trigger.addEventListener('click', () => {
        if (document.getElementById('list')) return;
        const box = trigger.getBoundingClientRect();
        const list = document.createElement('ul');
        list.id = 'list'; list.setAttribute('role', 'listbox');
        list.style.cssText = 'position:absolute;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid #999;width:300px;top:' + (box.bottom + scrollY + 30) + 'px;left:' + box.left + 'px';
        for (const name of ['All', 'Europe', 'Asia']) {
          const option = document.createElement('li');
          option.setAttribute('role', 'option'); option.textContent = name; option.style.padding = '10px';
          option.addEventListener('mousedown', (event) => { event.preventDefault(); trigger.textContent = 'Region: ' + name; trigger.setAttribute('aria-expanded', 'false'); list.remove(); });
          list.append(option);
        }
        document.body.append(list);
        trigger.setAttribute('aria-expanded', 'true');
      });
    </script>`,
    async (page) => {
      const outcome = await page.run({ target: "#var", act: "choose", control: "combobox", value: "Asia", role: "combobox", name: "Region" });
      assert.equal(outcome.kind, "done", json(outcome));
      assert.equal(await page.text("#var"), "Region: Asia");
      assert.equal(await page.page.evaluate("window.dangerClicks ?? 0"), 0, "no click went to what was under the option");
    },
  ));

/** A select built the way MUI's Select builds it. */
const MUI_SELECT = `
  <div style="display:inline-flex;flex-direction:column;position:relative;min-width:200px">
    <label id="age-label" style="font-size:12px">Age</label>
    <div style="position:relative;border:1px solid #999;border-radius:4px">
      <div id="age" role="combobox" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="age-label" style="padding:12px;min-height:20px;cursor:pointer">&#8203;</div>
      <input aria-hidden="true" tabindex="-1" id="age-native" value="" style="position:absolute;bottom:0;left:0;opacity:0;pointer-events:none;width:100%;box-sizing:border-box">
    </div>
  </div>
  <p><button id="behind" type="button">Behind the list</button> <output id="model"></output></p>
  <script>
    // MUI's SelectInput opens on mouse down (button 0), prevents the default and focuses itself.
    // The list is a Menu: a Popover in a Modal portal, with a backdrop that closes it, and options that pick on click.
    const trigger = document.getElementById('age');
    const choices = [['10', 'Ten'], ['20', 'Twenty'], ['30', 'Thirty']];
    function close() { document.getElementById('menu-root')?.remove(); trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
    trigger.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      trigger.focus();
      const root = document.createElement('div');
      root.id = 'menu-root'; root.setAttribute('role', 'presentation'); root.style.cssText = 'position:fixed;inset:0;z-index:1300';
      const backdrop = document.createElement('div');
      backdrop.setAttribute('aria-hidden', 'true'); backdrop.style.cssText = 'position:fixed;inset:0;background:transparent';
      backdrop.addEventListener('click', close);
      const paper = document.createElement('div');
      const box = trigger.getBoundingClientRect();
      paper.style.cssText = 'position:absolute;background:#fff;box-shadow:0 2px 8px #0004;min-width:' + box.width + 'px;top:' + (box.top) + 'px;left:' + box.left + 'px';
      const list = document.createElement('ul');
      list.setAttribute('role', 'listbox'); list.tabIndex = -1; list.setAttribute('aria-labelledby', 'age-label'); list.style.cssText = 'margin:0;padding:8px 0;list-style:none';
      for (const [value, label] of choices) {
        const option = document.createElement('li');
        option.setAttribute('role', 'option'); option.tabIndex = -1; option.dataset.value = value; option.textContent = label; option.style.cssText = 'padding:6px 16px;cursor:pointer';
        option.setAttribute('aria-selected', String(document.getElementById('age-native').value === value));
        option.addEventListener('click', () => { document.getElementById('age-native').value = value; trigger.textContent = label; document.getElementById('model').textContent = value; close(); });
        list.append(option);
      }
      paper.append(list); root.append(backdrop, paper); document.body.append(root);
      trigger.setAttribute('aria-expanded', 'true');
      list.focus();
    });
    document.getElementById('behind').addEventListener('click', () => (window.behindClicks = (window.behindClicks ?? 0) + 1));
  </script>`;

test("a select built like MUI's opens on mouse down, and the option asked for is picked and shown", () =>
  on(MUI_SELECT, async (page) => {
    const outcome = await page.run({ target: "#age", act: "choose", control: "combobox", value: "Twenty", role: "combobox", name: "Age" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(outcome.event, 'You chose "Twenty" from the list that combobox "Age" opened.');
    assert.equal(await page.text("#age"), "Twenty");
    assert.equal(await page.text("#model"), "20");
    assert.equal(await page.page.$("#menu-root"), null, "the list closed");
    assert.equal(await page.page.evaluate("window.behindClicks ?? 0"), 0);
    assert.deepEqual(outcome.did, { name: "Age", value: "Twenty" });
    assert.equal(outcome.opened, false, "the list Haptic opened is forgotten once it closes");
  }));

test("an option is pressed only after the gate was asked about it, and about where the press lands", () =>
  on(MUI_SELECT, async (page) => {
    await page.run({ target: "#age", act: "choose", control: "combobox", value: "Thirty", role: "combobox", name: "Age" });
    const calls = await page.gateCalls();
    const pick = calls.findIndex(([fn]) => fn === "planPick");
    assert.ok(pick > 0, json(calls));
    assert.equal(calls[pick]![1], "li");
    assert.ok(calls.slice(pick + 1).some(([fn, el]) => fn === "reachable" && el === "li"), "the option's press point was asked for after the pick was allowed");
    assert.equal(calls[0]![0], "reachable", "the trigger's press point was asked for before anything was pressed");
  }));

test("an option the gate does not allow is not pressed, and the visitor picks", () =>
  on(MUI_SELECT, async (page) => {
    await page.page.evaluate(() => {
      // The gate refuses every option of the list once it opens.
      const gate = ((window as unknown as { __gate?: { ungrounded: Element[] } }).__gate ??= { calls: [], covered: [], ungrounded: [], keysRefused: [], tripped: false } as never);
      new MutationObserver(() => gate.ungrounded.push(...document.querySelectorAll("li"))).observe(document.body, { childList: true, subtree: true });
    });
    await page.page.evaluate(() => {
      document.addEventListener("click", (event) => {
        if ((event.target as Element).closest?.("li")) (window as unknown as { optionClicks: number }).optionClicks = 1;
      }, true);
    });
    const outcome = await page.run({ target: "#age", act: "choose", control: "combobox", value: "Twenty", role: "combobox", name: "Age" });
    assert.equal(outcome.kind, "visitor", json(outcome));
    assert.equal(outcome.reason, "ungrounded");
    assert.equal(await page.page.evaluate("window.optionClicks ?? 0"), 0);
    assert.equal(await page.text("#model"), "", "nothing was chosen");
  }));

test("a covered control is not pressed at all, and the visitor has it", () =>
  on(
    `<button id="go" type="button">Next</button><p id="state"></p>
    <script>document.getElementById('go').addEventListener('click', () => (document.getElementById('state').textContent = 'clicked'));</script>`,
    async (page) => {
      await page.page.evaluate(() => ((window as unknown as { __gate: unknown }).__gate = { calls: [], covered: [document.getElementById("go")], ungrounded: [], keysRefused: [], tripped: false }));
      await page.watch("#go");
      const outcome = await page.run({ target: "#go", act: "click", control: "button", role: "button" });
      assert.equal(outcome.kind, "visitor", json(outcome));
      assert.equal(outcome.reason, "covered");
      assert.deepEqual(await page.counted("#go"), {});
      assert.equal(await page.text("#state"), "");
      assert.equal(outcome.actions, 0);
    },
  ));

/** An autocomplete built the way MUI's Autocomplete builds it. */
const MUI_AUTOCOMPLETE = `
  <label for="movie">Movie</label>
  <div style="position:relative;width:300px"><input id="movie" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" style="width:100%;padding:8px;box-sizing:border-box"></div>
  <output id="model"></output>
  <script>
    const films = ['The Shawshank Redemption', 'The Godfather', 'The Godfather: Part II', 'The Dark Knight', '12 Angry Men', "Schindler's List", 'Pulp Fiction'];
    const input = document.getElementById('movie');
    let chosen = '';
    let popup;
    function close() { popup?.remove(); popup = undefined; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-controls'); }
    function open() {
      close();
      popup = document.createElement('div');
      const box = input.getBoundingClientRect();
      popup.style.cssText = 'position:absolute;background:#fff;border:1px solid #999;width:' + box.width + 'px;top:' + (box.bottom + scrollY) + 'px;left:' + box.left + 'px';
      const list = document.createElement('ul');
      list.id = 'movie-listbox'; list.setAttribute('role', 'listbox'); list.style.cssText = 'margin:0;padding:4px 0;list-style:none;max-height:200px;overflow:auto';
      // The list keeps the keyboard in the input: a press on it does not move focus.
      list.addEventListener('mousedown', (event) => event.preventDefault());
      const typed = input.value.toLowerCase();
      for (const film of films.filter((film) => film.toLowerCase().includes(typed))) {
        const option = document.createElement('li');
        option.setAttribute('role', 'option'); option.textContent = film; option.style.padding = '6px 12px';
        option.addEventListener('mousemove', () => { for (const other of list.children) other.classList.toggle('Mui-focused', other === option); });
        option.addEventListener('click', () => { chosen = film; input.value = film; document.getElementById('model').textContent = film; close(); });
        list.append(option);
      }
      popup.append(list); document.body.append(popup);
      input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'movie-listbox');
    }
    input.addEventListener('input', open);
    input.addEventListener('mousedown', () => { if (!popup) open(); });
    // Leaving the field closes the list and puts back the chosen value, as clearOnBlur does.
    input.addEventListener('blur', () => { close(); input.value = chosen; });
  </script>`;

test("an autocomplete built like MUI's is typed into, and the option asked for is picked from what it shows", () =>
  on(MUI_AUTOCOMPLETE, async (page) => {
    const outcome = await page.run({ target: "#movie", act: "choose", control: "combobox", value: "The Godfather", role: "combobox", name: "Movie" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(await page.text("#model"), "The Godfather");
    assert.equal(await page.page.inputValue("#movie"), "The Godfather");
    assert.equal(await page.page.$("#movie-listbox"), null);
  }));

/** A select built the way Ant Design's builds it: a read-only input, options with no role in a virtual list, and the roles on a hidden list beside it. */
const ANTD_SELECT = (search: boolean) => `
  <div style="margin-top:20px">
    <span id="city-label">City</span>
    <div class="ant-select" id="select" style="position:relative;display:inline-block;width:260px;border:1px solid #999;border-radius:6px;cursor:pointer">
      <div class="ant-select-selector" style="position:relative;height:30px;padding:0 11px">
        <span class="ant-select-selection-search" style="position:absolute;inset:0 11px">
          <input id="city" role="combobox" aria-labelledby="city-label" aria-expanded="false" aria-haspopup="listbox" aria-owns="city_list" aria-controls="city_list" aria-autocomplete="list" autocomplete="off"
            ${search ? "" : 'readonly unselectable="on"'} style="width:100%;height:100%;border:0;outline:0;background:transparent;${search ? "" : "opacity:0;"}">
        </span>
        <span class="ant-select-selection-placeholder" style="line-height:30px;color:#999;pointer-events:none">Select a person</span>
      </div>
    </div>
  </div>
  <output id="model"></output>
  <script>
    const first = ['Ada', 'Alan', 'Grace', 'Edsger', 'Barbara', 'Donald', 'Ken', 'Dennis', 'Margaret', 'John'];
    const last = ['Lovelace', 'Turing', 'Hopper', 'Dijkstra', 'Liskov', 'Knuth', 'Thompson', 'Ritchie', 'Hamilton', 'Backus'];
    const people = [];
    for (const a of first) for (const b of last) people.push(a + ' ' + b);
    const input = document.getElementById('city');
    const selector = document.querySelector('.ant-select-selector');
    const ROW = 32, HEIGHT = 256;
    let dropdown, holder, inner, a11y, active = 0;
    const shown = () => people.filter((name) => name.toLowerCase().includes(${search ? "input.value.toLowerCase()" : "''"}));
    function render() {
      const list = shown();
      inner.style.height = list.length * ROW + 'px';
      const start = Math.floor(holder.scrollTop / ROW), end = Math.min(list.length, start + Math.ceil(HEIGHT / ROW) + 1);
      const rows = document.createElement('div');
      rows.style.cssText = 'position:absolute;left:0;right:0;top:' + start * ROW + 'px';
      for (let i = start; i < end; i++) {
        const name = list[i];
        const item = document.createElement('div');
        item.className = 'ant-select-item ant-select-item-option'; item.title = name; item.style.cssText = 'height:' + ROW + 'px;line-height:' + ROW + 'px;padding:0 12px;cursor:pointer';
        const content = document.createElement('div'); content.className = 'ant-select-item-option-content'; content.textContent = name;
        item.append(content);
        item.addEventListener('mouseenter', () => item.classList.add('ant-select-item-option-active'));
        item.addEventListener('click', () => pick(name));
        rows.append(item);
      }
      inner.replaceChildren(rows);
      // The roles are on a list nobody sees, holding only the options around the active one.
      a11y.replaceChildren(...list.slice(Math.max(0, active - 1), active + 2).map((name, i) => { const o = document.createElement('div'); o.setAttribute('role', 'option'); o.id = 'city_list_' + i; o.textContent = name; o.setAttribute('aria-selected', 'false'); return o; }));
    }
    function build() {
      dropdown = document.createElement('div');
      dropdown.className = 'ant-select-dropdown';
      dropdown.style.cssText = 'position:absolute;background:#fff;box-shadow:0 2px 8px #0004;width:260px';
      a11y = document.createElement('div'); a11y.setAttribute('role', 'listbox'); a11y.id = 'city_list'; a11y.style.cssText = 'height:0;width:0;overflow:hidden';
      holder = document.createElement('div'); holder.className = 'rc-virtual-list-holder'; holder.style.cssText = 'max-height:' + HEIGHT + 'px;overflow-y:auto;position:relative';
      inner = document.createElement('div'); inner.style.position = 'relative';
      holder.append(inner);
      holder.addEventListener('scroll', render);
      // A press in the list keeps the keyboard where it was.
      dropdown.addEventListener('mousedown', (event) => event.preventDefault());
      dropdown.append(a11y, holder);
      document.body.append(dropdown);
    }
    function open() {
      if (!dropdown) build();
      const box = selector.getBoundingClientRect();
      dropdown.style.top = box.bottom + scrollY + 4 + 'px'; dropdown.style.left = box.left + 'px';
      dropdown.classList.remove('ant-select-dropdown-hidden'); dropdown.style.display = '';
      holder.scrollTop = 0; render();
      input.setAttribute('aria-expanded', 'true');
    }
    function close() { if (dropdown) { dropdown.classList.add('ant-select-dropdown-hidden'); dropdown.style.display = 'none'; } input.setAttribute('aria-expanded', 'false'); }
    function pick(name) {
      document.querySelector('.ant-select-selection-placeholder')?.remove();
      let item = document.querySelector('.ant-select-selection-item');
      if (!item) { item = document.createElement('span'); item.className = 'ant-select-selection-item'; item.style.cssText = 'line-height:30px;pointer-events:none'; selector.append(item); }
      item.textContent = name; item.title = name;
      ${search ? "input.value = '';" : ""}
      document.getElementById('model').textContent = name;
      close();
    }
    // rc-select: the selector opens and closes the list on mouse down, and keeps the keyboard in its input.
    selector.addEventListener('mousedown', (event) => {
      if (event.target !== input) event.preventDefault();
      input.focus();
      if (input.getAttribute('aria-expanded') === 'true' && ${search ? "false" : "true"}) close(); else open();
    });
    input.addEventListener('input', () => { open(); render(); });
    input.addEventListener('blur', close);
  </script>`;

test("a select built like Ant Design's, with options that have no role in a virtual list, is scrolled to the option and picked", () =>
  on(ANTD_SELECT(false), async (page) => {
    // The 56th of 100 rows, eight to a page: seven pages down.
    const outcome = await page.run({ target: "#city", act: "choose", control: "combobox", value: "Donald Knuth", role: "combobox", name: "City" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(await page.text("#model"), "Donald Knuth");
    assert.equal(await page.text(".ant-select-selection-item"), "Donald Knuth");
    assert.equal(await page.page.isVisible(".ant-select-dropdown"), false, "the list closed");
  }));

test("a virtual list is looked through ten pages at most, and an option further down goes to the visitor", () =>
  on(ANTD_SELECT(false), async (page) => {
    // The 89th of 100 rows is past ten pages of eight.
    const outcome = await page.run({ target: "#city", act: "choose", control: "combobox", value: "Margaret Hamilton", role: "combobox", name: "City" });
    assert.equal(outcome.kind, "visitor", json(outcome));
    assert.equal(await page.text("#model"), "");
  }));

test("an Ant Design select with a search box in it is typed into, and the option found is picked", () =>
  on(ANTD_SELECT(true), async (page) => {
    const outcome = await page.run({ target: "#city", act: "choose", control: "combobox", value: "Grace Hopper", role: "combobox", name: "City" });
    assert.equal(outcome.kind, "done", json(outcome));
    assert.equal(await page.text("#model"), "Grace Hopper");
    assert.ok(outcome.typed >= "Grace".length, "the search was typed");
  }));

test("a choice that is not in the list goes to the visitor, with the list left open for them", () =>
  on(MUI_SELECT, async (page) => {
    const outcome = await page.run({ target: "#age", act: "choose", control: "combobox", value: "Forty", role: "combobox", name: "Age" });
    assert.equal(outcome.kind, "visitor", json(outcome));
    assert.equal(outcome.reason, "failed");
    assert.match(outcome.say ?? "", /couldn't find/);
  }));

// Menus ----------------------------------------------------------------------------------

/**
 * A menu with a submenu, which opens while the pointer rests on its entry and
 * closes when the pointer rests on another entry of the menu for a moment, as
 * menus with hover intent do. A pointer that jumps without moving through the
 * menu never opens it.
 */
const MENU = `
  <button id="actions" type="button" aria-haspopup="menu" aria-expanded="false">Actions</button>
  <output id="done"></output>
  <script>
    const trigger = document.getElementById('actions');
    let menu, sub;
    const item = (name, extra = {}) => { const el = document.createElement('div'); el.setAttribute('role', 'menuitem'); el.tabIndex = -1; el.textContent = name; el.style.cssText = 'padding:8px 12px;cursor:pointer'; Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v)); return el; };
    function closeAll() { menu?.remove(); sub?.remove(); menu = sub = undefined; trigger.setAttribute('aria-expanded', 'false'); }
    trigger.addEventListener('click', () => {
      if (menu) return closeAll();
      menu = document.createElement('div'); menu.setAttribute('role', 'menu');
      const box = trigger.getBoundingClientRect();
      menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #999;width:160px;top:' + (box.bottom + scrollY + 4) + 'px;left:' + box.left + 'px';
      const rename = item('Rename'), share = item('Share', { 'aria-haspopup': 'menu', 'aria-expanded': 'false', id: 'share' }), archive = item('Archive');
      rename.addEventListener('click', () => { document.getElementById('done').textContent = 'Rename'; closeAll(); });
      // The submenu opens while the pointer rests on its entry, and closes when the pointer goes over another entry of the menu.
      let timer;
      let closing;
      share.addEventListener('pointermove', () => { clearTimeout(closing); if (!sub && !timer) timer = setTimeout(() => { timer = undefined; openSub(share); }, 100); });
      for (const other of [rename, archive]) other.addEventListener('pointermove', () => {
        clearTimeout(timer); timer = undefined;
        clearTimeout(closing);
        closing = setTimeout(() => { sub?.remove(); sub = undefined; share.setAttribute('aria-expanded', 'false'); }, 150);
      });
      window.cancelClosing = () => clearTimeout(closing);
      menu.append(rename, share, archive);
      document.body.append(menu);
      trigger.setAttribute('aria-expanded', 'true');
    });
    function openSub(share) {
      sub = document.createElement('div'); sub.setAttribute('role', 'menu');
      const box = share.getBoundingClientRect();
      sub.style.cssText = 'position:absolute;background:#fff;border:1px solid #999;width:160px;top:' + (box.top + scrollY + 40) + 'px;left:' + (box.right + 2) + 'px';
      sub.addEventListener('pointerenter', () => window.cancelClosing());
      for (const name of ['Copy link', 'Email']) { const el = item(name); el.addEventListener('click', () => { document.getElementById('done').textContent = name; closeAll(); }); sub.append(el); }
      document.body.append(sub);
      share.setAttribute('aria-expanded', 'true');
    }
  </script>`;

test("a click-opened menu is opened, its submenu opened by resting on its entry, and the entry in the submenu pressed", () =>
  on(MENU, async (page) => {
    const opened = await page.run({ target: "#actions", act: "click", control: "button", role: "button" });
    assert.equal(opened.kind, "done", json(opened));
    assert.equal(opened.opened, true, "the menu is the list Haptic opened");
    const share = await page.run({ target: "#share", act: "click", control: "option", role: "menuitem" });
    assert.equal(share.kind, "done", json(share));
    assert.equal(await page.page.getAttribute("#share", "aria-expanded"), "true");
    const email = page.page.locator('[role="menuitem"]', { hasText: "Email" });
    await email.evaluate((el: Element) => (el.id = "email"));
    const picked = await page.run({ target: "#email", act: "click", control: "option", role: "menuitem" });
    assert.equal(picked.kind, "done", json(picked));
    assert.equal(await page.text("#done"), "Email");
  }));
