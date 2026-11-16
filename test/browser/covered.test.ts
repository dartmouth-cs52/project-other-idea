import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { ask, BROWSERS, idOf, labelsOf, launch, page, point, startHarness, turns, type Harness } from "./harness.ts";

// A control that something else covers can't be clicked, so the snapshot
// leaves it out. One that is only scrolled away, or only under a sticky
// header for now, stays in.

for (const name of BROWSERS) {
  describe(`covered controls in ${name}`, () => {
    let browser: Browser;
    let tab: Page;
    before(async () => {
      browser = await launch(name);
      tab = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    });
    after(() => browser.close());

    test("leaves out a button buried under another element", async () => {
      // Like the pilot app's Restart button under its stack of cards.
      const labels = await labelsOf(tab, `
        <div style="position:relative;width:300px;height:200px">
          <button style="position:absolute;left:20px;top:20px">Restart</button>
          <div style="position:absolute;inset:0;background:#fff">Card</div>
          <button style="position:absolute;right:10px;top:10px">Shuffle</button>
        </div>`);
      assert.deepEqual(labels, ["Shuffle"]);
    });

    test("keeps a button that is only partly covered", async () => {
      const labels = await labelsOf(tab, `
        <div style="position:relative;width:300px;height:200px">
          <button style="position:absolute;left:0;top:0;width:120px;height:40px">Partly</button>
          <div style="position:absolute;left:0;top:0;width:70px;height:40px;background:#fff"></div>
        </div>`);
      assert.deepEqual(labels, ["Partly"]);
    });

    test("leaves out the page behind a full-screen overlay and keeps the overlay's own controls", async () => {
      const labels = await labelsOf(tab, `
        <button>Behind</button>
        <div style="position:fixed;inset:0;background:rgba(0,0,0,.2)"><div><button>View</button></div></div>`);
      assert.deepEqual(labels, ["View"]);
    });

    test("keeps a button under a sticky header, since scrolling it to the middle shows it", async () => {
      const labels = await labelsOf(
        tab,
        `<header style="position:sticky;top:0;height:80px;background:#fff;z-index:1"><a href="/">Home</a></header>
         <div style="height:400px"></div><button id="save">Save</button><div style="height:3000px"></div>`,
        `window.scrollTo(0, document.getElementById("save").getBoundingClientRect().top + window.scrollY - 20)`,
      );
      assert.ok(labels.includes("Save"), labels.join(", "));
    });

    test("keeps a button scrolled out of its own scroll box", async () => {
      const labels = await labelsOf(tab, `
        <div style="height:100px;overflow:auto"><div style="height:600px"></div><button>Deep</button></div>
        <div style="height:400px">Footer text</div>`);
      assert.ok(labels.includes("Deep"));
    });

    test("keeps a styled checkbox whose input sits under the box drawn over it", async () => {
      const labels = await labelsOf(tab, `
        <label style="position:relative;display:inline-block">
          <input type="checkbox" style="position:absolute;left:0;top:0;margin:0">
          <span style="position:relative;display:inline-block;width:20px;height:20px;background:#333"></span> Remember me
        </label>`);
      assert.ok(labels.includes("Remember me"));
    });

    test("keeps a control that takes no clicks itself", async () => {
      const labels = await labelsOf(tab, `<button style="pointer-events:none">Create</button>`);
      assert.deepEqual(labels, ["Create"]);
    });

    test("never counts Haptic's own element as covering the page", async () => {
      const labels = await labelsOf(tab, `<button>Under our caption</button><div id="ours" style="position:fixed;inset:0"></div>`);
      assert.deepEqual(labels, ["Under our caption"]);
    });

    test("in a guide, the model is never shown the covered button", async () => {
      const harness: Harness = await startHarness();
      harness.pages.set("/", page(`
        <h1>Deck</h1>
        <div style="position:relative;width:300px;height:200px">
          <button id="restart" style="position:absolute;left:20px;top:20px">Restart</button>
          <div style="position:absolute;inset:0;background:#eee">Card 12 of 12</div>
        </div>
        <button id="shuffle">Shuffle</button>`));
      harness.script = (request) => point(idOf(request, "Shuffle"));
      const guide = await browser.newPage();
      await guide.goto(`${harness.url}/`);
      await ask(guide, "start the deck again");
      const [first] = await turns(harness, 1);
      assert.ok(!first!.snapshot.elements.some((element) => element.label === "Restart"));
      await guide.close();
      await harness.close();
    });
  });
}
