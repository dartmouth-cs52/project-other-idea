import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Act, PublicSiteConfig, TurnReply } from "../../src/shared/types.ts";
import { ACTING_ON, closeBrowser, idOf, start, words, type Asked, type Session } from "./harness.ts";

after(closeBrowser);

// "Do it with me" through the whole widget: the visitor presses Do it, a
// scripted model answers each step in act mode, and Haptic does the steps
// itself, showing each move, until it hands the click that commits to the
// visitor. No model is called. Each test reads what reached the page, not
// only what the widget said: a listener the page installs before anything
// else counts every press, click, key and form submit on the controls it
// watches.

/** An act reply that Haptic does itself. */
const doing = (request: Asked, label: string, act: Act, say: string, enter?: string, role?: string): TurnReply => ({
  target: idOf(request, label, role),
  do: act,
  ...(enter !== undefined ? { enter } : {}),
  commits: false,
  status: "continue",
  say,
  mode: "act",
});
/** The hand-over: the visitor makes the click that commits. */
const handOver = (request: Asked, label: string, say: string, role?: string): TurnReply => ({ target: idOf(request, label, role), do: null, commits: true, status: "done", say, mode: "act" });

/**
 * Counts, from before anything else on the page runs, every event that could
 * make a control act (presses, clicks, keys, typing, submits) that reaches a
 * control marked data-watch, by the control's id and the event's type, and
 * whether the browser marked it as the visitor's own.
 */
const WATCH = `<script>
  window.reached = [];
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown', 'input', 'change', 'submit']) {
    document.addEventListener(type, (event) => {
      const watched = event.composedPath().find((node) => node instanceof Element && node.hasAttribute('data-watch'));
      if (watched) window.reached.push(watched.id + ':' + type + (event.isTrusted ? ':visitor' : ''));
    }, true);
  }
</script>`;

const reached = (session: Session): Promise<string[]> => session.page.evaluate(() => (window as unknown as { reached: string[] }).reached);
/** What reached a watched control, by its id. */
const reachedOn = async (session: Session, id: string): Promise<string[]> => (await reached(session)).filter((entry) => entry.startsWith(`${id}:`));

/** A card form that waits for its submit, like the end of Northpine's wizard. A submit is counted and goes nowhere. */
const CARD_FORM = `${WATCH}<h1>New card</h1>
  <form id="card" data-watch>
    <label>Card name <input id="name" name="name"></label>
    <label>Resets <select id="interval" name="interval"><option>Per day</option><option>Per month</option></select></label>
    <label><input id="virtual" type="checkbox" name="virtual"> Virtual card</label>
    <button id="issue" type="submit" data-watch>Issue card</button>
  </form>
  <p id="result"></p>
  <script>
    document.getElementById('card').addEventListener('submit', (event) => {
      event.preventDefault();
      document.getElementById('result').textContent = 'Card issued';
    });
  </script>`;

test("Do it: Haptic types, chooses and ticks what the visitor asked for, and stops at the commit with What I did, which the visitor then clicks", async () => {
  const session = await start(
    CARD_FORM,
    (request, index) => {
      if (index === 0) return doing(request, "Card name", "type", "Typing the card's name.", "Ads");
      if (index === 1) return doing(request, "Resets", "choose", "Choosing Per month.", "Per month");
      if (index === 2) return doing(request, "Virtual card", "check", "Making it virtual.");
      if (index === 3) return handOver(request, "Issue card", "Ready. Check the card and click Issue card.");
      return words("The card is issued.");
    },
    "/",
    { acting: ACTING_ON },
  );
  try {
    await session.ask("Can you issue a virtual card called Ads that resets per month?", { act: true });
    await session.untilAsked(4, 20_000);
    await session.untilState("pointing");
    const asked = session.requests;
    assert.equal(asked[0]!.mode, "act", "the question did not ask for act mode");
    assert.ok(asked[0]!.version! >= 3);
    assert.match(asked[1]!.event ?? "", /^You typed "Ads" in textbox "Card name"\./);
    assert.match(asked[2]!.event ?? "", /^You chose "Per month" in select "Resets"\./);
    assert.match(asked[3]!.event ?? "", /^You ticked checkbox "Virtual card"\./);
    assert.equal(await session.page.inputValue("#name"), "Ads");
    assert.equal(await session.page.inputValue("#interval"), "Per month");
    assert.equal(await session.page.isChecked("#virtual"), true);
    assert.equal(await session.pointed(), "issue", "the pointer is not on the commit");
    assert.equal(await session.caption(), "Ready. Check the card and click Issue card.");
    const did = await session.did();
    assert.deepEqual(did.lines, ["Card name: Ads", "Resets: Per month", "Virtual card: on"]);
    assert.equal(did.closing, "Nothing is saved until you click Issue card.");
    assert.deepEqual(await reachedOn(session, "issue"), [], "something reached the commit before the visitor clicked it");
    assert.equal(await session.page.textContent("#result"), "", "the form was sent");
    // The visitor makes the click, and the guide looks at what came of it.
    await session.page.locator("#issue").click();
    const closing = await session.untilAsked(5);
    assert.equal(closing.closing, true);
    assert.equal(closing.mode, undefined, "the closing question was asked in act mode");
    await session.untilState("finished");
    assert.equal(await session.page.textContent("#result"), "Card issued");
    assert.ok((await reachedOn(session, "issue")).every((entry) => entry.endsWith(":visitor")), "only the visitor's own events reached the commit");
  } finally {
    await session.close();
  }
});

/** Whether the Do it button is on show. */
const doItShown = (session: Session) => session.page.locator("haptic-root .panel .doit").isVisible();

test("the first Do it on a site says what will happen, and nothing is asked until Go; once seen, it is not shown again", async () => {
  const session = await start(CARD_FORM, (request) => (request.mode === "act" ? handOver(request, "Issue card", "Ready. Click Issue card.") : words("Use the form.")), "/", { acting: ACTING_ON });
  try {
    await session.ask("can you issue a card", { act: true, go: false });
    const first = session.page.locator("haptic-root .panel .first");
    assert.equal(await first.isVisible(), true, "the first-use line is not shown");
    assert.match((await first.textContent()) ?? "", /stop before anything is saved/);
    await session.page.waitForTimeout(600);
    assert.equal(session.requests.length, 0, "a question went before Go");
    await session.page.locator("haptic-root .panel .first .go").click();
    await session.untilState("pointing");
    assert.equal(session.requests[0]!.mode, "act");
    // Asked again on the same site: straight to work.
    await session.page.locator("haptic-root .caption .close").click();
    await session.untilState("finished");
    await session.page.locator("haptic-root .panel input").fill("can you issue another card");
    await session.page.locator("haptic-root .panel .doit").click();
    await session.untilAsked(2);
    assert.equal(session.requests[1]!.mode, "act");
    assert.equal(await first.isVisible(), false);
  } finally {
    await session.close();
  }
});

test("the visitor's words only colour Do it: Enter still asks to be shown, in any of the shipped languages; Ctrl+Enter is Do it", async () => {
  const session = await start(CARD_FORM, (request) => (request.mode === "act" ? handOver(request, "Issue card", "Ready.") : words("Use the form.")), "/", { acting: { ...ACTING_ON, confirmFirst: false } });
  try {
    await session.page.locator("haptic-root .launcher").click();
    const input = session.page.locator("haptic-root .panel input");
    const nudged = () => session.page.evaluate(() => document.querySelector("haptic-root")!.shadowRoot!.querySelector(".panel")!.classList.contains("nudged"));
    await input.fill("how do I issue a card");
    assert.equal(await nudged(), false);
    for (const question of ["Can you issue a card for me?", "¿Puedes emitir una tarjeta?", "Kannst du bitte eine Karte ausstellen?", "Peux-tu créer une carte ?", "帮我开一张卡"]) {
      await input.fill(question);
      assert.equal(await nudged(), true, `"${question}" did not colour Do it`);
    }
    await input.fill("can you issue a card");
    await input.press("Enter");
    await session.untilAsked(1);
    assert.equal(session.requests[0]!.mode, undefined, "words alone started acting");
    await session.untilState("finished");
    await session.page.locator("haptic-root .launcher").click().catch(() => undefined);
    await input.fill("issue a card");
    await input.press("Control+Enter");
    await session.untilAsked(2);
    assert.equal(session.requests[1]!.mode, "act", "Ctrl+Enter did not press Do it");
  } finally {
    await session.close();
  }
});

test("Do it shows only where acting is allowed: not on a site without it, not on a page that turns it off, not on a path the site leaves out", async () => {
  const off = `${CARD_FORM}<script>
    // The page turns acting off on its own script tag, as a company may for some pages.
    new MutationObserver(() => document.querySelector('script[data-site]')?.setAttribute('data-acting', 'off')).observe(document.documentElement, { childList: true, subtree: true });
  </script>`;
  const cases: [string, string, PublicSiteConfig["acting"]][] = [
    ["a site without acting", CARD_FORM, undefined],
    ["a page with data-acting=off", off, ACTING_ON],
    ["a path the site leaves out", CARD_FORM, { ...ACTING_ON, paths: ["/cards"] }],
  ];
  for (const [what, pages, acting] of cases) {
    const session = await start(pages, () => words("Use the form."), "/", acting ? { acting } : {});
    try {
      await session.page.locator("haptic-root .launcher").click();
      assert.equal(await doItShown(session), false, `Do it shows on ${what}`);
      await session.page.locator("haptic-root .panel input").fill("can you issue a card");
      await session.page.locator("haptic-root .panel input").press("Control+Enter");
      await session.page.waitForTimeout(500);
      assert.ok(session.requests.every((request) => request.mode === undefined), `act mode was asked for on ${what}`);
    } finally {
      await session.close();
    }
  }
  const on = await start(CARD_FORM, () => words("Use the form."), "/", { acting: { ...ACTING_ON, paths: ["/"] } });
  try {
    await on.page.locator("haptic-root .launcher").click();
    assert.equal(await doItShown(on), true, "Do it does not show where the site allows acting");
  } finally {
    await on.close();
  }
});

test("a server that answers without acting (an older one, or acting turned off) gets a pointer and the words that say so, and nothing is done", async () => {
  const session = await start(CARD_FORM, (request) => ({ ...doing(request, "Card name", "type", "Type the name here.", "Ads"), mode: undefined }), "/", { acting: ACTING_ON });
  try {
    await session.ask("can you issue a card called Ads", { act: true });
    await session.untilState("pointing");
    assert.equal(await session.caption(), "I'll show you the way instead. Type the name here.");
    assert.equal(await session.pointed(), "name");
    await session.page.waitForTimeout(800);
    assert.equal(await session.page.inputValue("#name"), "", "Haptic typed on a reply without the act echo");
    assert.deepEqual(await reached(session), []);
  } finally {
    await session.close();
  }
});

/** A long name, so that typing it takes a while: a Stop or a touch can come in the middle of it. */
const LONG = "Quarterly offsite planning for the whole design team";

/** Counts what reached the watched controls from now on: the entries after this call. */
async function mark(session: Session): Promise<() => Promise<string[]>> {
  const from = (await reached(session)).length;
  return async () => (await reached(session)).slice(from);
}

test("Stop part way: no event reaches the page after it, the half-typed name stays as it is, and What I did says so", async () => {
  const session = await start(
    `${WATCH}<h1>New card</h1><form><label>Card name <input id="name" data-watch></label><button id="next" type="button" data-watch>Next</button></form>`,
    (request, index) => (index === 0 ? doing(request, "Card name", "type", "Typing the card's name.", LONG) : doing(request, "Next", "click", "Going on.")),
    "/",
    { acting: ACTING_ON },
  );
  try {
    await session.ask(`can you make a card called ${LONG}`, { act: true });
    await session.untilState("acting");
    await session.until(async () => (await session.page.inputValue("#name")).length >= 4, "some of the name to be typed");
    await session.page.locator("haptic-root .status .stop").click();
    await session.untilState("finished");
    const typed = await session.page.inputValue("#name");
    const after = await mark(session);
    await session.page.waitForTimeout(1500);
    assert.deepEqual(await after(), [], "something reached the page after Stop");
    assert.equal(await session.page.inputValue("#name"), typed, "typing went on after Stop");
    assert.ok(typed.length < LONG.length, "the whole name was typed before Stop");
    assert.equal(session.requests.length, 1, "a question was asked after Stop");
    await session.until(async () => (await session.did()).lines.length > 0, "What I did to show the half-typed name");
    assert.deepEqual((await session.did()).lines, [`Card name: ${typed} (stopped part way)`]);
  } finally {
    await session.close();
  }
});

test("the visitor's own hand pauses Haptic: nothing more reaches the page until they carry on, and then it does", async () => {
  const session = await start(
    `${WATCH}<h1 id="title">New card</h1><form><label>Card name <input id="name" data-watch></label><button id="next" type="button" data-watch>Next</button></form><p id="moved"></p>
    <script>document.getElementById('next').addEventListener('click', () => (document.getElementById('moved').textContent = 'Step two'));</script>`,
    (request, index) => {
      if (index === 0) return doing(request, "Card name", "type", "Typing the card's name.", LONG);
      if (index === 1) return doing(request, "Next", "click", "Going on.");
      return words("Done.");
    },
    "/",
    { acting: ACTING_ON },
  );
  try {
    await session.ask(`can you make a card called ${LONG}`, { act: true });
    await session.untilState("acting");
    await session.until(async () => (await session.page.inputValue("#name")).length >= 4, "some of the name to be typed");
    // The visitor clicks on the page, with the real mouse.
    await session.page.locator("#title").click();
    await session.untilState("paused");
    assert.equal(await session.status(), "You took over, so I've paused.");
    const after = await mark(session);
    const typed = await session.page.inputValue("#name");
    await session.page.waitForTimeout(1500);
    assert.deepEqual(await after(), [], "something reached the page while paused");
    assert.equal(await session.page.inputValue("#name"), typed);
    assert.equal(session.requests.length, 1);
    await session.page.locator("haptic-root .status .resume").click();
    const next = await session.untilAsked(2);
    assert.equal(next.mode, "act");
    assert.match(next.event ?? "", /took over for a moment/);
    await session.untilState("finished", 15_000);
    assert.equal(await session.page.textContent("#moved"), "Step two", "Haptic did not carry on after Carry on");
  } finally {
    await session.close();
  }
});

test("Escape stops Haptic and still reaches the page, so the page's open menu closes", async () => {
  const session = await start(
    `${WATCH}<h1>Orders</h1><button id="more" type="button">More</button><ul id="menu" hidden><li>Archive</li></ul>
    <form><label>Note <input id="note" data-watch></label></form><p id="keys"></p>
    <script>
      document.getElementById('more').addEventListener('click', () => (document.getElementById('menu').hidden = false));
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && event.isTrusted) { document.getElementById('menu').hidden = true; document.getElementById('keys').textContent = 'Escape'; } });
    </script>`,
    (request) => doing(request, "Note", "type", "Typing the note.", LONG),
    "/",
    { acting: ACTING_ON },
  );
  try {
    await session.page.locator("#more").click();
    await session.ask(`can you write ${LONG} in the note`, { act: true });
    await session.untilState("acting");
    await session.until(async () => (await session.page.inputValue("#note")).length >= 2, "some of the note to be typed");
    await session.page.keyboard.press("Escape");
    await session.untilState("finished");
    assert.equal(await session.page.textContent("#keys"), "Escape", "Escape did not reach the page");
    assert.equal(await session.page.isVisible("#menu"), false);
    const typed = await session.page.inputValue("#note");
    await session.page.waitForTimeout(1000);
    assert.equal(await session.page.inputValue("#note"), typed, "typing went on after Escape");
  } finally {
    await session.close();
  }
});

test("a value the visitor did not give is their turn: the pointer waits on the field, and acting carries on once they have filled it in", async () => {
  const session = await start(
    CARD_FORM,
    (request, index) => {
      if (index === 0) return { target: idOf(request, "Card name"), do: null, commits: false, status: "continue", say: "What should the card be called? Type it here and I'll carry on.", mode: "act" };
      if (index === 1) return doing(request, "Resets", "choose", "Choosing Per month.", "Per month");
      return handOver(request, "Issue card", "Ready. Click Issue card.");
    },
    "/",
    { acting: ACTING_ON },
  );
  try {
    await session.ask("can you issue a card that resets per month", { act: true });
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "name");
    assert.equal(await session.status(), "Your turn");
    assert.equal(await session.page.evaluate(() => document.querySelector("haptic-root")!.shadowRoot!.querySelector(".ring")!.classList.contains("turn")), true, "the ring does not say it is the visitor's turn");
    await session.page.locator("#name").click();
    await session.page.keyboard.type("Travel", { delay: 30 });
    await session.page.locator("h1").click();
    const next = await session.untilAsked(2, 10_000);
    assert.equal(next.mode, "act");
    assert.match(next.event ?? "", /The visitor filled in textbox "Card name"\. You can't see what they entered\./);
    assert.ok(!(next.event ?? "").includes("Travel"), "what the visitor typed was sent");
    await session.untilAsked(3, 10_000);
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "issue");
    assert.equal(await session.page.inputValue("#interval"), "Per month");
    assert.deepEqual((await session.did()).lines, ["Resets: Per month"], "the visitor's own typing is listed as Haptic's");
  } finally {
    await session.close();
  }
});

test("a page load from Haptic's own link carries on acting on the next page; a load the visitor makes ends it and says so", async () => {
  const pages = {
    "/": `${WATCH}<h1>Cards</h1><a id="new" href="/new">Issue card</a><form><label>Search <input id="search" type="search"></label></form>`,
    "/new": CARD_FORM,
  };
  const session = await start(
    pages,
    (request, index) => {
      if (index === 0) return doing(request, "Issue card", "click", "Opening the new card form.", undefined, "link");
      if (index === 1) return doing(request, "Card name", "type", "Typing the card's name.", "Ads");
      return handOver(request, "Issue card", "Ready. Click Issue card.", "button");
    },
    "/",
    { acting: ACTING_ON },
  );
  try {
    await session.ask("can you issue a card called Ads", { act: true });
    const second = await session.untilAsked(2, 15_000);
    assert.equal(second.mode, "act", "acting did not carry on after the page load");
    assert.equal(second.snapshot.path, "/new");
    assert.match(second.event ?? "", /^You clicked link "Issue card"\. A new page loaded: \/new\./);
    await session.untilAsked(3, 15_000);
    await session.untilState("pointing");
    assert.equal(await session.page.inputValue("#name"), "Ads");
    assert.deepEqual(await reachedOn(session, "issue"), []);
  } finally {
    await session.close();
  }

  // The visitor goes somewhere while Haptic waits for its next step.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  const other = await start(
    { "/": CARD_FORM, "/elsewhere": `${WATCH}<h1>Elsewhere</h1><label>Card name <input id="name" data-watch></label>` },
    async (request, index) => {
      if (index === 0) return doing(request, "Card name", "type", "Typing the card's name.", "Ads");
      await held;
      return doing(request, "Card name", "type", "Typing again.", "Ads");
    },
    "/",
    { acting: ACTING_ON },
  );
  try {
    await other.ask("can you issue a card called Ads", { act: true });
    await other.untilAsked(2, 15_000);
    await other.page.goto(`${other.origin}/elsewhere`);
    await other.page.waitForSelector("haptic-root", { state: "attached" });
    await other.untilState("finished", 10_000);
    assert.equal(await other.caption(), "You moved to another page, so I stopped doing it. Ask again to carry on.");
    assert.deepEqual((await other.did()).lines, ["Card name: Ads"]);
    release();
    await other.page.waitForTimeout(800);
    assert.equal(await other.page.inputValue("#name"), "", "Haptic acted on a page the visitor went to");
    assert.deepEqual(await reached(other), []);
  } finally {
    release();
    await other.close();
  }
});

/** Counts, from before the widget loads, its timers and frames that run, the observers it leaves on, and its listeners on the document and the window. */
const COUNTED = `<script>
  const counts = (window.__counts = { calls: 0, observers: 0, kept: () => [] });
  const ours = () => /widget\\.js/.test(new Error().stack || '');
  for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
    const original = window[name];
    window[name] = function (callback, ...rest) {
      const counted = typeof callback === 'function' && ours() ? function (...args) { counts.calls++; return callback.apply(this, args); } : callback;
      return original.call(window, counted, ...rest);
    };
  }
  for (const Observer of [MutationObserver, PerformanceObserver]) {
    const observe = Observer.prototype.observe, disconnect = Observer.prototype.disconnect;
    Observer.prototype.observe = function (...args) { if (!this.__on && ours()) { this.__on = true; counts.observers++; } return observe.apply(this, args); };
    Observer.prototype.disconnect = function () { if (this.__on) { this.__on = false; counts.observers--; } return disconnect.apply(this); };
  }
  const kept = new Set();
  for (const target of [window, document]) {
    const add = target.addEventListener, remove = target.removeEventListener;
    const key = (type, listener, options) => [target === window ? 'w' : 'd', type, typeof options === 'boolean' ? options : !!(options && options.capture), listener && (listener.__id ??= Math.random())].join(':');
    target.addEventListener = function (type, listener, options) { const k = key(type, listener, options); if (!kept.has(k) && ours()) kept.add(k); return add.call(this, type, listener, options); };
    target.removeEventListener = function (type, listener, options) { kept.delete(key(type, listener, options)); return remove.call(this, type, listener, options); };
  }
  counts.kept = () => [...kept].map((k) => k.split(':').slice(0, 3).join(':')).sort();
</script>`;

/** Our callbacks that run in two quiet seconds, the observers left on, and the listeners left, by where, type and phase. */
async function quiet(session: Session): Promise<{ calls: number; observers: number; listeners: string[] }> {
  await session.page.waitForTimeout(1500);
  const before = await session.page.evaluate(() => (window as unknown as { __counts: { calls: number } }).__counts.calls);
  await session.page.waitForTimeout(2000);
  return session.page.evaluate((calls: number) => {
    const counts = (window as unknown as { __counts: { calls: number; observers: number; kept: () => string[] } }).__counts;
    return { calls: counts.calls - calls, observers: counts.observers, listeners: counts.kept() };
  }, before);
}

test("once acting is over, by the visitor's click on the commit or by Stop, nothing of Haptic's is left running but the one top-layer listener", async () => {
  const session = await start(
    `${COUNTED}${CARD_FORM}`,
    (request) => {
      if (request.mode !== "act") return words("The card is issued.");
      if (request.step === 0) return doing(request, "Card name", "type", "Typing the card's name.", request.goal.includes(LONG) ? LONG : "Ads");
      return handOver(request, "Issue card", "Ready. Click Issue card.");
    },
    "/",
    { acting: { ...ACTING_ON, confirmFirst: false } },
  );
  const idle = { calls: 0, observers: 0, listeners: ["d:toggle:true"] };
  // The ask box is put away, as a visitor done with it does. While it is open the widget is in use.
  const putAway = async () => {
    if (await session.page.locator("haptic-root .panel").isVisible()) await session.page.locator("haptic-root .launcher").click();
  };
  try {
    await session.ask("can you issue a card called Ads", { act: true });
    await session.untilState("pointing", 15_000);
    await session.page.locator("#issue").click();
    await session.untilState("finished", 10_000);
    await session.page.locator("haptic-root .caption .close").click();
    await putAway();
    assert.deepEqual(await quiet(session), idle, "after the hand-over and the visitor's click");
    // Stopped part way through typing.
    await session.ask(`can you make a card called ${LONG}`, { act: true });
    await session.untilState("acting", 10_000);
    await session.until(async () => (await session.page.inputValue("#name")).length >= 3, "some of the name to be typed");
    await session.page.locator("haptic-root .status .stop").click();
    await session.untilState("finished");
    await putAway();
    assert.deepEqual(await quiet(session), idle, "after Stop");
  } finally {
    await session.close();
  }
});

/** A picker built the way Northpine's is, from a Radix popover and cmdk: options carry data-disabled="false" unless they are disabled. */
const PICKER = `${WATCH}<h1>New card</h1><form>
  <label for="holder">Cardholder</label>
  <button id="holder" type="button" role="combobox" aria-expanded="false" aria-controls="people" aria-label="Cardholder">Search people…</button>
  <div id="people" role="listbox" hidden style="position:absolute;background:#fff;border:1px solid #999;padding:4px;width:220px">
    <div role="option" cmdk-item="" data-disabled="false" aria-disabled="false" id="malika" data-watch><span>Malika Cummerata</span> <span>Senior Accountant</span></div>
    <div role="option" cmdk-item="" data-disabled="false" aria-disabled="false" id="ravi" data-watch><span>Ravi Patel</span> <span>Designer</span></div>
    <div role="option" cmdk-item="" data-disabled="" aria-disabled="true" id="gone" data-watch><span>Former Employee</span></div>
  </div>
  <button type="button">Next</button></form>
  <script>
    const holder = document.getElementById('holder'), people = document.getElementById('people');
    const show = (open) => { people.hidden = !open; holder.setAttribute('aria-expanded', String(open)); };
    holder.addEventListener('click', () => show(people.hidden));
    for (const option of people.children) option.addEventListener('click', () => { if (option.getAttribute('aria-disabled') === 'true') return; holder.textContent = option.firstElementChild.textContent; show(false); });
  </script>`;

const choosing = (request: Asked, value: string): TurnReply => ({ target: idOf(request, "Cardholder", "combobox"), do: "choose", enter: value, commits: false, status: "continue", say: `Choosing ${value}.`, mode: "act" });

test("a person the visitor named is picked from a list that shows each name with a title and says data-disabled=\"false\", as cmdk's does; one they did not name is theirs to pick, and acting carries on after their pick", async () => {
  const session = await start(PICKER, (request, index) => (index === 0 ? choosing(request, "Malika Cummerata") : words("Done.")), "/", { acting: { ...ACTING_ON, confirmFirst: false } });
  try {
    await session.ask("can you give Malika Cummerata a card", { act: true });
    const second = await session.untilAsked(2, 15_000);
    assert.match(second.event ?? "", /^You chose "Malika Cummerata Senior Accountant" from the list that combobox "Cardholder" opened\./);
    assert.equal(await session.page.textContent("#holder"), "Malika Cummerata");
  } finally {
    await session.close();
  }
  // The model picks a person the visitor never named: the visitor picks, and Haptic waits for the pick, not the click that opens the list.
  const theirs = await start(PICKER, (request, index) => (index === 0 ? choosing(request, "Ravi Patel") : words("Done.")), "/", { acting: { ...ACTING_ON, confirmFirst: false } });
  try {
    await theirs.ask("can you give someone a card", { act: true });
    await theirs.untilState("pointing", 15_000);
    assert.equal(await theirs.status(), "Your turn");
    assert.deepEqual(await reached(theirs), [], "an option was pressed for a name the visitor never gave");
    await theirs.page.locator("#holder").click();
    await theirs.page.waitForTimeout(1500);
    assert.equal(theirs.requests.length, 1, `acting went on once the list was open, before the pick: ${theirs.requests[1]?.event}`);
    await theirs.page.locator("#ravi").click();
    const next = await theirs.untilAsked(2, 10_000);
    assert.equal(next.mode, "act");
    assert.match(next.event ?? "", /The visitor chose "Ravi Patel( Designer)?" from the list that combobox "Cardholder" opened\./);
  } finally {
    await theirs.close();
  }
});

test("a tab that is a link to its own route, drawn again when the route changes, is done by Haptic, not given to the visitor", async () => {
  const session = await start(
    `${WATCH}<h1>People</h1><div id="tabs"></div><main id="panel"></main>
    <script>
      // A router that draws the tabs again for each route, as a page built on its routes does.
      const draw = () => {
        const here = location.pathname;
        document.getElementById('tabs').innerHTML = '<div role="tablist">' + [['/', 'Directory'], ['/roles', 'Roles and permissions']]
          .map(([to, name]) => '<a role="tab" href="' + to + '" aria-selected="' + (here === to) + '">' + name + '</a>').join('') + '</div>';
        document.getElementById('panel').textContent = here === '/roles' ? 'Finance can approve spend.' : 'Everyone';
        for (const tab of document.querySelectorAll('[role=tab]')) tab.addEventListener('click', (event) => { event.preventDefault(); history.pushState({}, '', tab.getAttribute('href')); draw(); });
      };
      draw();
    </script>`,
    (request, index) => (index === 0 ? doing(request, "Roles and permissions", "click", "Opening the roles.", undefined, "tab") : words("Finance can approve spend.")),
    "/",
    { acting: { ...ACTING_ON, confirmFirst: false } },
  );
  try {
    await session.ask("can you show me what the Finance role can do", { act: true });
    const next = await session.untilAsked(2, 15_000);
    assert.match(next.event ?? "", /^You clicked tab "Roles and permissions"\./);
    assert.equal(await session.page.evaluate(() => location.pathname), "/roles");
  } finally {
    await session.close();
  }
});

test("after three steps in a row Haptic could not do, acting ends and the guide goes on as a guide", async () => {
  // Fields that refuse a script's keys and throw away what a script sets, so Haptic's typing never takes.
  const field = (n: number) => `<label>Code ${n} <input id="code${n}" data-watch></label>`;
  const session = await start(
    `${WATCH}<h1>Verify</h1><form>${field(1)}${field(2)}${field(3)}<button type="button">Next</button></form>
    <script>
      for (const input of document.querySelectorAll('input')) {
        input.addEventListener('keydown', (event) => { if (!event.isTrusted) event.preventDefault(); });
        input.addEventListener('input', (event) => { if (!event.isTrusted) input.value = ''; });
      }
    </script>`,
    (request) => (request.mode === "act" ? doing(request, `Code ${request.step + 1}`, "type", "Typing the code.", ["alpha", "bravo", "charlie"][request.step] ?? "delta") : words("Now click Next.")),
    "/",
    { acting: { ...ACTING_ON, confirmFirst: false } },
  );
  try {
    await session.ask("can you put alpha, bravo and charlie in the codes", { act: true });
    for (const n of [1, 2, 3]) {
      await session.untilState("pointing", 20_000);
      assert.equal(await session.pointed(), `code${n}`);
      assert.match(await session.caption(), /^I couldn't do this one\./);
      await session.page.locator(`#code${n}`).click();
      await session.page.keyboard.type(["alpha", "bravo", "charlie"][n - 1]!, { delay: 20 });
      await session.untilAsked(n + 1, 15_000);
    }
    const fourth = session.requests[3]!;
    assert.equal(fourth.mode, undefined, "acting went on after three failures in a row");
    assert.match(fourth.event ?? "", /You stopped doing it yourself, since several steps could not be done\./);
    await session.untilState("finished");
  } finally {
    await session.close();
  }
});

test("each press is shown: the pointer glides to it and a ripple marks it, and with reduced motion there is no ripple", async () => {
  for (const reduce of [false, true]) {
    const session = await start(
      `${WATCH}<h1>Wizard</h1><div><button id="next" type="button" data-watch style="margin:200px 0 0 400px">Next</button></div><p id="step"></p>
      <script>document.getElementById('next').addEventListener('click', () => (document.getElementById('step').textContent = 'Step two'));</script>`,
      (request, index) => (index === 0 ? doing(request, "Next", "click", "Going on.") : words("Done.")),
      "/",
      { acting: { ...ACTING_ON, confirmFirst: false } },
    );
    try {
      await session.page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" });
      // Ripples are counted as they are added to Haptic's own element.
      await session.page.evaluate(() => {
        const shadow = document.querySelector("haptic-root")!.shadowRoot!;
        (window as unknown as { ripples: number }).ripples = 0;
        new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) if (node instanceof Element && node.classList.contains("ripple")) (window as unknown as { ripples: number }).ripples++;
        }).observe(shadow, { childList: true });
      });
      await session.ask("can you go to the next step", { act: true });
      await session.untilAsked(2, 15_000);
      assert.equal(await session.page.textContent("#step"), "Step two");
      const ripples = await session.page.evaluate(() => (window as unknown as { ripples: number }).ripples);
      if (reduce) assert.equal(ripples, 0, "a ripple was drawn with reduced motion");
      else assert.ok(ripples >= 1, "no ripple marked the press");
      // The pointer went to the button it pressed.
      const near = await session.page.evaluate(() => {
        const cursor = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".cursor") as HTMLElement;
        const button = document.getElementById("next")!.getBoundingClientRect();
        // Where the pointer was last sent, as its own style says: it is put away once the guide is over.
        const [x, y] = (/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(cursor.style.transform) ?? []).slice(1).map(Number);
        return { ok: Math.abs(x! - (button.left + button.width / 2)) < 30 && Math.abs(y! - (button.top + button.height / 2)) < 30, transform: cursor.style.transform };
      });
      assert.ok(near.ok, `the pointer is not at the button it pressed: ${JSON.stringify(near)}`);
    } finally {
      await session.close();
    }
  }
});
