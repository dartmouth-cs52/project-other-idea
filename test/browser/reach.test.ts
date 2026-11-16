import assert from "node:assert/strict";
import { after, test } from "node:test";
import { lines, startBrowser } from "./page.ts";

// What the widget lists as usable has to be something a visitor can reach.
// Each page is the smallest one that shows a fault a sweep of public sites
// found: controls clipped out of view inside a box, drawn invisible, under a
// wall of cookie choices or a dialog in a component, or under a bar pinned to
// the window. Run with: npm run test:browser

const started = await startBrowser();
if (process.env.CI && typeof started === "string") throw new Error(started);
const browser = typeof started === "string" ? undefined : started;
const skip = typeof started === "string" ? started : false;
after(() => browser?.close());
const read = (...args: Parameters<NonNullable<typeof browser>["read"]>) => browser!.read(...args);

/** Links in a side bar, 30 pixels apart. */
const links = (names: string[]) => names.map((name) => `<a href="/docs/${name.toLowerCase()}" style="display:block;height:30px">${name}</a>`).join("");
const LETTERS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet"];

// Clipped by a box ---------------------------------------------------------------

test("a control scrolled out of a box that scrolls is said to be above or below, as one out of the window is", { skip }, async () => {
  // The side bar shows 90 pixels: scrolled down by 90, Delta to Foxtrot show, Alpha to Charlie are above and Golf on below.
  const snapshot = await read(`<nav aria-label="Docs" style="height:90px;overflow:auto">${links(LETTERS)}</nav>`, {
    before: (page) => page.evaluate(() => (document.querySelector("nav")!.scrollTop = 90)),
  });
  assert.deepEqual(lines(snapshot), [
    'link "Alpha" [nav › Docs] → /docs/alpha above the visible area',
    'link "Bravo" [nav › Docs] → /docs/bravo above the visible area',
    'link "Charlie" [nav › Docs] → /docs/charlie above the visible area',
    'link "Delta" [nav › Docs] → /docs/delta',
    'link "Echo" [nav › Docs] → /docs/echo',
    'link "Foxtrot" [nav › Docs] → /docs/foxtrot',
    'link "Golf" [nav › Docs] → /docs/golf below the visible area',
    'link "Hotel" [nav › Docs] → /docs/hotel below the visible area',
    'link "India" [nav › Docs] → /docs/india below the visible area',
    'link "Juliet" [nav › Docs] → /docs/juliet below the visible area',
  ]);
});

test("a control scrolled out of a box that scrolls across is said to be before or after what the box shows", { skip }, async () => {
  // The strip shows 230 pixels: One whole, Two in part, and Three and Four after.
  const tab = (name: string) => `<button role="tab" style="box-sizing:border-box;width:120px;padding:0;flex:none">${name}</button>`;
  const snapshot = await read(`<div role="tablist" aria-label="Sections" style="display:flex;width:230px;overflow-x:auto">${["One", "Two", "Three", "Four"].map(tab).join("")}</div>`);
  assert.deepEqual(lines(snapshot), ['tab "One" [tabs › Sections]', 'tab "Two" [tabs › Sections]', 'tab "Three" [tabs › Sections] below the visible area', 'tab "Four" [tabs › Sections] below the visible area']);
});

test("a control cut away by a box that does not scroll is left out", { skip }, async () => {
  const snapshot = await read(`<main>
    <div style="width:300px;overflow:hidden;white-space:nowrap">Fix the build after the merge of the long branch of work <a href="/pull/12">#12</a></div>
    <div style="width:200px;height:40px;overflow:hidden;position:relative">
      <div style="display:flex;width:600px;transform:translateX(-200px)"><a href="/slide/1" style="width:200px">First slide</a><a href="/slide/2" style="width:200px">Second slide</a><a href="/slide/3" style="width:200px">Third slide</a></div>
    </div>
    <div style="height:0;overflow:hidden"><a href="/folded">Folded away</a></div></main>`);
  assert.deepEqual(lines(snapshot), ['link "Second slide" [main] → /slide/:id']);
});

test("a list placed over the page from a box that clips is still listed, since that box does not lay it out", { skip }, async () => {
  const snapshot = await read(`<div style="height:0;overflow:hidden">
      <ul role="listbox" aria-label="Fruit" style="position:fixed;top:100px;left:100px;margin:0;background:#fff"><li role="option">Apple</li><li role="option">Pear</li></ul></div>`);
  assert.deepEqual(lines(snapshot), ['option "Apple" [list › Fruit]', 'option "Pear" [list › Fruit]']);
});

// Drawn invisible -----------------------------------------------------------------

const SKIP_STYLES = `
  .skip { position: absolute; top: -100px; left: 0; }
  .skip:focus { top: 0; }
  .sr-only-focusable:not(:focus) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
  .gone { position: absolute; left: -9999px; }`;

test("a link parked out of view until the keyboard reaches it is listed as showing on focus, and one nothing brings into view is left out", { skip }, async () => {
  const snapshot = await read(`<style>${SKIP_STYLES}</style>
    <a class="skip" href="#main">Skip to main content</a>
    <a class="gone" href="#nav">Skip to navigation</a>
    <div class="sr-only-focusable"><a href="#search" style="display:inline-block;width:150px">Skip to search</a></div>
    <main id="main"><h1>Welcome</h1><a href="/start">Start</a></main>`);
  assert.deepEqual(lines(snapshot), ['link "Skip to main content" (shows on focus)', 'link "Start" [main › Welcome] → /start']);
});

test("a link cut down to nothing until it has the keyboard is listed as showing on focus", { skip }, async () => {
  const snapshot = await read(`<style>.visually-hidden-focusable:not(:focus):not(:focus-within) { position: absolute !important; width: 120px; height: 20px; clip-path: inset(50%); }</style>
    <a class="visually-hidden-focusable" href="#content">Skip to content</a><main id="content"><a href="/start">Start</a></main>`);
  assert.deepEqual(lines(snapshot), ['link "Skip to content" (shows on focus)', 'link "Start" [main] → /start']);
});

test("a see-through menu under the page is left out, and a see-through field over its own picture is still listed", { skip }, async () => {
  const snapshot = await read(`<header style="position:relative;height:40px"><button aria-expanded="false">Menu</button>
      <nav style="opacity:0;position:absolute;top:40px;left:0;width:300px"><a href="/a">Account</a><a href="/b">Billing</a></nav></header>
    <main style="position:relative;z-index:1;background:#fff;height:300px">
      <label><span style="position:relative;display:inline-block;width:20px;height:20px;background:#ccc">
        <input type="checkbox" style="opacity:0;position:absolute;left:0;top:0;width:100%;height:100%;margin:0"></span> Remember me</label>
      <div style="position:relative;width:200px;height:32px;cursor:pointer"><input role="combobox" aria-label="Template" readonly style="position:absolute;inset:0;opacity:0;border:0;padding:0">
        <span style="position:absolute;inset:0;line-height:32px">First template</span></div></main>`);
  // The select draws the chosen value over its see-through field, in its own box: a click on the value is a click on the select.
  assert.deepEqual(lines(snapshot), ['button "Menu" (collapsed) [header]', 'checkbox "Remember me" [main]', 'combobox "Template" [main]']);
});

// Under something pinned to the window ----------------------------------------------

test("a control under a header pinned to the window is above the visible area, and one under a notice pinned to its foot is below", { skip }, async () => {
  const snapshot = await read(`<div style="position:fixed;top:0;left:0;right:0;height:60px;background:#fff;z-index:5"><a href="/">Home</a></div>
    <div style="height:2000px;padding-top:60px"><a href="/under-header" style="display:block">Under the header</a><a href="/open" style="display:block;margin-top:200px">In the open</a>
      <a href="/under-notice" style="display:block;margin-top:350px">Under the notice</a></div>
    <div style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#eee;z-index:5"><p>This site uses cookies.</p></div>`, {
    before: (page) => page.evaluate(() => window.scrollTo(0, 30)),
  });
  assert.deepEqual(lines(snapshot), [
    'link "Home" → /',
    'link "Under the header" → /under-header above the visible area',
    'link "In the open" → /open',
    'link "Under the notice" → /under-notice below the visible area',
  ]);
});

test("a wall of cookie choices over the whole window is all of the page that can be used, and is named like a dialog", { skip }, async () => {
  const snapshot = await read(`<header><a href="/">Home</a><a href="/news">News</a></header><main><h1>Today</h1><a href="/story">Read the story</a></main>
    <div style="height:3000px"><a href="/far" style="margin-top:2500px;display:block">Far down</a></div>
    <div class="wall" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10">
      <div style="margin:100px auto;width:400px;background:#fff"><h2>Your privacy</h2><p>We and our partners use cookies.</p>
        <button>Accept</button><button>Reject all</button><a href="/privacy">Privacy policy</a></div></div>`);
  assert.equal(snapshot.dialog, "Your privacy");
  assert.deepEqual(lines(snapshot), ['button "Accept" [Your privacy]', 'button "Reject all" [Your privacy]', 'link "Privacy policy" [Your privacy] → /privacy']);
});

test("a layout pinned to the window that holds the page is not taken for a layer over it", { skip }, async () => {
  const snapshot = await read(`<a href="#app" style="position:absolute;left:10px;top:10px">Behind the app</a>
    <div id="app" style="position:fixed;inset:0;background:#fff;z-index:1"><nav><a href="/a">One</a><a href="/b">Two</a><a href="/c">Three</a></nav><main><button>Save</button></main></div>`);
  assert.equal(snapshot.dialog, undefined);
  assert.deepEqual(lines(snapshot), ['link "One" [nav] → /a', 'link "Two" [nav] → /b', 'link "Three" [nav] → /c', 'button "Save" [main]']);
});

test("a modal dialog inside a component's shadow root shuts out the page, as one in the page does", { skip }, async () => {
  const snapshot = await read(`<a href="/home">Home</a><button>Search</button>
    <x-dialog></x-dialog>
    <script>
      customElements.define("x-dialog", class extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: "open" }).innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.4)"></div>' +
            '<div role="dialog" aria-modal="true" aria-label="Search the docs" style="position:fixed;top:200px;left:300px;width:400px;height:200px;background:#fff">' +
            '<input type="search" placeholder="Search"><button>Close</button></div>';
        }
      });
    </script>`);
  assert.equal(snapshot.dialog, "Search the docs");
  assert.deepEqual(lines(snapshot), ['textbox "Search" [dialog]', 'button "Close" [dialog]']);
});

test("a modal dialog in a component is found when what shows at the middle of the window is the words the page put in it", { skip }, async () => {
  const snapshot = await read(`<a href="/home">Home</a><a href="/far" style="display:block;margin-top:2000px">Far down</a>
    <x-notice><p style="margin:0;padding:120px 20px">Shoelace is now Web Awesome. Read how to move your pages over.</p><button>No, thanks</button></x-notice>
    <script>
      customElements.define("x-notice", class extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: "open" }).innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.4)"></div>' +
            '<div role="dialog" aria-modal="true" aria-label="Shoelace is now Web Awesome" style="position:fixed;top:100px;left:250px;width:500px;background:#fff"><slot></slot></div>';
        }
      });
    </script>`);
  assert.equal(snapshot.dialog, "Shoelace is now Web Awesome");
  assert.deepEqual(lines(snapshot), ['button "No, thanks"']);
});
