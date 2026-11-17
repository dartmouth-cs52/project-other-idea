import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// A select inside a dialog, built the way Ant Design builds it (antdpro's
// rule-template guide): the chosen value is drawn over a see-through input,
// and the list of choices is drawn at the end of the page, outside the
// dialog, on top of everything. The widget moves itself into the dialog.

const select = (searchable: boolean) => `<h1>Rules</h1><button type="button">New rule</button>
  <div style="position:fixed;inset:0;background:rgba(0,0,0,.45)"></div>
  <div id="dialog" role="dialog" aria-modal="true" aria-labelledby="title" style="position:fixed;top:60px;left:360px;width:520px;background:#fff;padding:16px">
    <h2 id="title">Rule configuration</h2>
    <label for="tpl">Rule Template</label>
    <div id="select" style="position:relative;width:300px;height:32px;border:1px solid #999;cursor:pointer">
      <input id="tpl" role="combobox" ${searchable ? "" : "readonly"} aria-expanded="false" aria-controls="tpl_list" style="position:absolute;inset:0;width:100%;opacity:0;border:0;padding:0">
      <span id="value" style="position:absolute;inset:0;line-height:32px;padding:0 8px">规则模板一</span>
    </div>
    <p>Pick the template the rule follows.</p>
    <button type="button">Next</button>
  </div>
  <div id="drop" style="position:absolute;display:none;width:300px;background:#fff;border:1px solid #999;z-index:1050">
    <div id="tpl_list" role="listbox" style="height:0;width:0;overflow:hidden"><div role="option" aria-selected="true">规则模板一</div><div role="option">规则模板二</div></div>
    ${["规则模板一", "规则模板二", "规则模板三"].map((name) => `<div class="opt" title="${name}" style="padding:6px 8px;cursor:pointer">${name}</div>`).join("")}
  </div>
  <script>
    const input = document.getElementById('tpl'), drop = document.getElementById('drop');
    document.getElementById('select').addEventListener('mousedown', () => {
      const box = document.getElementById('select').getBoundingClientRect();
      Object.assign(drop.style, { display: 'block', left: box.left + 'px', top: (box.bottom + 4 + scrollY) + 'px' });
      input.setAttribute('aria-expanded', 'true');
    });
    for (const option of drop.querySelectorAll('.opt')) option.addEventListener('click', () => {
      document.getElementById('value').textContent = option.title;
      drop.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
    });
  </script>`;

const caption = (session: Session) =>
  session.page.evaluate(() => {
    const el = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".caption") as HTMLElement;
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { shown: !el.hidden, top: box.top, bottom: box.bottom, hitsHaptic: hit?.tagName === "HAPTIC-ROOT" };
  });

test("a click on the words of a select in a dialog is a click on the select, and a pick from its list outside the dialog is heard", async () => {
  const session = await start(select(false), (request, index) => {
    if (index === 0) return point(request, "Rule Template", "Open Rule Template and choose 规则模板二.");
    if (index === 1) return point(request, "规则模板二", "Choose 规则模板二.");
    return words("The rule now uses 规则模板二.");
  });
  try {
    await session.ask("move the rule to template two");
    await session.untilState("pointing");
    assert.ok(await session.page.evaluate(() => !!document.querySelector("#dialog haptic-root")), "the widget is not inside the dialog");
    // The visitor clicks the middle of the select, which is the words of its value.
    const box = (await session.page.locator("#select").boundingBox())!;
    await session.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const second = await session.untilAsked(2);
    assert.match(second.event ?? "", /^The user clicked combobox "Rule Template"\./);
    await session.until(async () => (await session.caption()) === "Choose 规则模板二.", "the second sentence");
    assert.ok(await session.page.evaluate(() => (document.querySelector("haptic-root") as unknown as { pointedAt?: Element }).pointedAt === document.querySelector('.opt[title="规则模板二"]')));
    assert.equal((await caption(session)).hitsHaptic, false, "the caption takes clicks");
    await session.page.locator('.opt[title="规则模板二"]').click();
    const third = await session.untilAsked(3);
    assert.match(third.event ?? "", /^The user clicked clickable "规则模板二"\./);
  } finally {
    await session.close();
  }
});

test("under one pointer at a searchable select in a dialog, the caption keeps off its list and the pick is heard", async () => {
  const session = await start(select(true), (request, index) => (index === 0 ? point(request, "Rule Template", "Open Rule Template and choose 规则模板二.") : words("The rule now uses 规则模板二.")));
  try {
    await session.ask("move the rule to template two");
    await session.untilState("pointing");
    await session.page.waitForTimeout(400);
    const box = (await session.page.locator("#select").boundingBox())!;
    await session.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await session.page.waitForTimeout(600);
    // Clicking into a field that takes typing is not the step, so the sentence stays while the list is open: off the list, and letting clicks through.
    const shown = await caption(session);
    const list = (await session.page.locator("#drop").boundingBox())!;
    assert.ok(shown.shown, "the sentence went away before the pick");
    assert.equal(shown.hitsHaptic, false);
    assert.ok(shown.bottom <= list.y || shown.top >= list.y + list.height, "the caption is over the list");
    assert.equal(session.requests.length, 1);
    await session.page.locator('.opt[title="规则模板二"]').click();
    const second = await session.untilAsked(2);
    // The row was hidden when the page was read, so it is not in the list, and a plain row's own words are not sent:
    // a list that opens under a field can repeat what the visitor typed in it.
    assert.match(second.event ?? "", /^The user chose an entry from the list that combobox "Rule Template" opened\./);
    await session.untilState("finished");
  } finally {
    await session.close();
  }
});
