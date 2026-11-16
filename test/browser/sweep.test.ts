import assert from "node:assert/strict";
import { after, test } from "node:test";
import { lines, startBrowser } from "./page.ts";

// What the widget lists on pages built the way public sites build them, where
// a sweep of 90 sites found it wrong: a control named only by the picture it
// shows or by a component inside it, boxes that are no control taking places
// in the list, controls in a frame of the page's own, a page too large to read
// whole, and tabs in a tab list that cannot be used. Each page is the smallest
// one that shows the fault. Run with: npm run test:browser

const started = await startBrowser();
if (process.env.CI && typeof started === "string") throw new Error(started);
const browser = typeof started === "string" ? undefined : started;
const skip = typeof started === "string" ? started : false;
after(() => browser?.close());
const read = (...args: Parameters<NonNullable<typeof browser>["read"]>) => browser!.read(...args);

/** Defines a component whose shadow root holds the given markup. */
const component = (name: string, html: string) =>
  `<script>customElements.define(${JSON.stringify(name)}, class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = ${JSON.stringify(html)}; } });</script>`;

// Names the accessibility tree gives ------------------------------------------------

test("a control that shows only a picture is named by the picture's aria-label, its <title> or the box that says it is a picture", { skip }, async () => {
  const snapshot = await read(`<main>
    <button><svg role="img" aria-label="Copy" width="16" height="16"><path d="M0 0h16v16H0z"/></svg></button>
    <button><span role="img" aria-label="Filter cards" style="display:inline-block;width:16px;height:16px"></span></button>
    <a href="/home"><svg width="16" height="16"><title>Trello</title><path d="M0 0h16v16H0z"/></svg></a>
    <a href="/help"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Help" width="16" height="16"></a>
    <button><svg aria-hidden="true" aria-label="Never read" width="16" height="16"></svg></button></main>`);
  assert.deepEqual(lines(snapshot), ['button "Copy" [main]', 'button "Filter cards" [main]', 'link "Trello" [main] → /home', 'link "Help" [main] → /help', 'button [main]']);
});

test("a control is named by the words a component inside it draws in its shadow root, and by what the page put in its slot", { skip }, async () => {
  const snapshot = await read(`${component("x-words", "<span>Settings</span>")}${component("x-button", '<button part="base"><slot name="prefix"></slot><span><slot></slot></span></button>')}
    <main><a href="/settings"><x-words></x-words></a><x-button><b slot="prefix">*</b>Save draft</x-button>
      <x-icon-link></x-icon-link></main>
    ${component("x-icon-link", '<a href="/energy"><x-icon role="img" aria-label="Energy" style="display:inline-block;width:16px;height:16px"></x-icon></a>')}`);
  assert.deepEqual(lines(snapshot), ['link "Settings" [main] → /settings', 'button "* Save draft" [main]', 'link "Energy" [main] → /energy']);
});

test("an empty link is named by the words its stylesheet writes before it, and not by a character of a font of icons", { skip }, async () => {
  const snapshot = await read(`<style>.self-link::before { content: "§"; } .glyph::before { content: "\\f233"; font-family: icons; }</style>
    <main><h3 id="forms">Forms <a href="#forms" class="self-link"></a></h3><a href="https://github.com/" class="glyph"></a></main>`);
  assert.deepEqual(lines(snapshot), ['link "§" [main › Forms]', "link [main › Forms] → external:github.com"]);
});

// Boxes that are no control ---------------------------------------------------------

test("a box only the pointer marks, that says nothing, is not listed when it is larger than an icon or holds controls, and is when it is the size of one", { skip }, async () => {
  const card = (name: string) => `<li style="cursor:pointer"><a href="/c/${name.toLowerCase()}">${name}</a></li><div style="cursor:pointer;height:8px;width:256px"></div>`;
  const snapshot = await read(`<main><h2>Roadmap</h2><ol style="list-style:none">${card("Search")}${card("Labels")}</ol>
    <div style="cursor:pointer;padding:8px;width:300px"><button>Archive</button><button>Move</button></div>
    <div class="close" style="cursor:pointer;width:20px;height:20px;background:#ccc"></div></main>`);
  assert.deepEqual(lines(snapshot), ['link "Search" [main › Roadmap] → /c/search', 'link "Labels" [main › Roadmap] → /c/labels', 'button "Archive" [main › Roadmap]', 'button "Move" [main › Roadmap]', 'clickable [main › Roadmap]']);
});

// A page too large to read whole --------------------------------------------------------

test("on a page with more elements than a reading visits, what is on screen is read first, and listed in its place in the page", { skip }, async () => {
  // The article comes first in the page and lies below the window; the side bar on screen comes after it, as Sphinx builds documentation.
  const words = Array.from({ length: 16000 }, (_, i) => `<span>w${i} </span>`).join("");
  const snapshot = await read(`<main style="margin-top:900px"><a href="/top">Top of the article</a><p>${words}</p><a href="/end">End of the article</a></main>
    <nav aria-label="Contents" style="position:fixed;top:0;left:0"><a href="/one">One</a> <a href="/two">Two</a></nav>`);
  assert.deepEqual(lines(snapshot), [
    'link "Top of the article" [main] → /top below the visible area',
    'link "One" [nav › Contents] → /one',
    'link "Two" [nav › Contents] → /two',
  ]);
});
