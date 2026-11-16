import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { namedButNotDone, namedButNotPointed } from "../src/server/check.ts";
import { configure, measureTurn } from "../src/server/model.ts";
import { DEFAULT_APPEARANCE, type SiteContext, type Snapshot, type TurnReply, type TurnRequest } from "../src/shared/types.ts";

// The model's service, played by a stand-in that answers from a script, so
// that what the server does when a reply contradicts itself can be checked
// with no key and no network.

const site: SiteContext = {
  version: 1,
  id: "site_test",
  name: "Test",
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [],
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// The page joinhaptic.com showed when the model said "Click FAQ in the top bar to read it" and pointed at nothing.
const snapshot: Snapshot = {
  path: "/request-access",
  title: "Request access, Haptic",
  headings: [],
  text: [],
  truncated: false,
  elements: [
    { id: "e1", role: "link", label: "Haptic", href: "/", context: "header" },
    { id: "e2", role: "link", label: "Pricing", href: "/", context: "nav" },
    { id: "e3", role: "link", label: "FAQ", href: "/", context: "nav" },
    { id: "e4", role: "link", label: "Request access", href: "/request-access", context: "nav" },
    { id: "e5", role: "textbox", label: "Work email", state: ["required"], context: "form" },
    { id: "e7", role: "button", label: "Continue", context: "form" },
  ],
};

const request: TurnRequest = { site: site.id, goal: "What does Haptic see on my page?", step: 0, history: [], snapshot };

/** One call to the model: what it streams, then how it ends. */
interface Call {
  /** The reply's text as it streams, enough of it to name the target. */
  streams?: string;
  fails?: unknown;
  reply?: TurnReply;
}

/** A stand-in for the model's service that answers each call from the script in turn, and keeps what it was sent. */
function standIn(calls: Call[]) {
  const sent: Anthropic.Beta.MessageCreateParams[] = [];
  const stand = {
    beta: {
      messages: {
        stream(params: Anthropic.Beta.MessageCreateParams) {
          sent.push(params);
          const call = calls[sent.length - 1] ?? { fails: new Error("The script has no more calls.") };
          const listeners: ((delta: string, soFar: string) => void)[] = [];
          return {
            on(event: string, listener: (delta: string, soFar: string) => void) {
              if (event === "text") listeners.push(listener);
              return this;
            },
            async finalMessage() {
              await new Promise((resolve) => setTimeout(resolve, 1));
              if (call.streams) for (const listener of listeners) listener(call.streams, call.streams);
              if (call.fails) throw call.fails;
              return {
                parsed_output: call.reply,
                stop_reason: "end_turn",
                model: "claude-test",
                usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              };
            },
          };
        },
      },
    },
  };
  return { stand: stand as unknown as Pick<Anthropic, "beta">, sent };
}

const use = (calls: Call[], recheck = "log") => {
  const made = standIn(calls);
  configure({ HAPTIC_MODEL: "claude-test", HAPTIC_RECHECK: recheck, ANTHROPIC_API_KEY: "test" }, made.stand);
  return made;
};

const pointsAtFaq: TurnReply = { target: "e3", status: "continue", say: "Click FAQ in the top bar." };

// joinhaptic.com, 3 runs in 3 on staging and once more with a trace: "Click FAQ in the top bar to read it", status done, target null, FAQ listed as e3.
const namesFaq: TurnReply = { target: null, status: "done", say: 'The FAQ on the home page has an entry called "What does Haptic see on the page?". Click FAQ in the top bar to find it.' };

test("a reply that tells the visitor to use a listed control and points at nothing is found", () => {
  assert.equal(namedButNotPointed(snapshot, namesFaq)?.id, "e3");
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "continue", say: 'Click the "Request access" link at the top.' })?.id, "e4");
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "done", say: "Open Pricing to compare the plans." })?.id, "e2");
  // The fourth run with the check on: no word that says to use it, only the way through it.
  const through = 'The FAQ on the home page has an entry called "What does Haptic see on the page?" that answers this. You can open it through the FAQ link in the top bar.';
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "done", say: through })?.id, "e3");
});

test("a reply is not taken for one that names a control when it does not tell the visitor to use it", () => {
  // It points at something.
  assert.equal(namedButNotPointed(snapshot, { ...namesFaq, target: "e3" }), undefined);
  // It names a control only to describe the page, also by what kind of control it is.
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "done", say: "There's no export here. You can filter with the Continue button, but nothing downloads." }), undefined);
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "done", say: "The FAQ answers this under 'What does Haptic see on the page?'." }), undefined);
  // It tells the visitor not to use it.
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "done", say: "You're done, so don't click Continue again." }), undefined);
  // It says what a page is about.
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "done", say: "This page explains how to use Pricing tiers for teams." }), undefined);
  // A key is not a control on the list.
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "continue", say: "Press Enter to search." }), undefined);
  // A control that is not on the list, and a name found only inside a longer word.
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "done", say: "Click Settings in your account menu." }), undefined);
  assert.equal(namedButNotPointed(snapshot, { target: null, status: "done", say: "Click FAQs on the home page." }), undefined);
});

test("with the check asking, the model is asked once more, told what it did, and its second reply is the one sent", async () => {
  const { sent } = use([{ streams: '{"target":null', reply: namesFaq }, { streams: '{"target":"e3"', reply: pointsAtFaq }], "ask");
  const early: string[] = [];
  const measure = await measureTurn(site, request, undefined, (id) => early.push(id));
  assert.equal(sent.length, 2);
  const told = sent[1]!.messages.at(-1)!.content as string;
  assert.match(told, /tells the visitor to use link "FAQ" \(e3\), but its target is null/);
  assert.deepEqual(JSON.parse(sent[1]!.messages.at(-2)!.content as string), namesFaq);
  assert.deepEqual(measure.reply, pointsAtFaq);
  assert.deepEqual(measure.recheck, { named: "e3", asked: true });
  // The second reply's pointer goes out as soon as it is known, as a first reply's would.
  assert.deepEqual(early, ["e3"]);
});

test("after the first question, the check only logs: a control named once the goal is reached is an optional extra", async () => {
  // jira, once the History tab was open: "use Load more newer history items for later entries". Asked again, it pointed at it.
  const { sent } = use([{ reply: namesFaq }, { reply: pointsAtFaq }], "ask");
  const later = { ...request, step: 2, event: 'The user clicked tab "History".' };
  const measure = await measureTurn(site, later);
  assert.equal(sent.length, 1);
  assert.equal(measure.reply.target, null);
  assert.deepEqual(measure.recheck, { named: "e3", asked: false });
});

test("with the check only logging, the reply is sent as the model wrote it", async () => {
  const { sent } = use([{ reply: namesFaq }, { reply: pointsAtFaq }], "log");
  const measure = await measureTurn(site, request);
  assert.equal(sent.length, 1);
  assert.equal(measure.reply.target, null);
  assert.deepEqual(measure.recheck, { named: "e3", asked: false });
});

test("when asking again fails, the first reply still reaches the visitor", async () => {
  const refused = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "bad" } }, undefined, new Headers());
  use([{ reply: namesFaq }, { fails: refused }], "ask");
  const measure = await measureTurn(site, request);
  assert.equal(measure.reply.say, namesFaq.say);
});

// Act mode: "Do it with me". A reply of "continue" that points at nothing leaves the visitor waiting on nothing, at any step.

const actingSite: SiteContext = { ...site, id: "site_acting", acting: { enabled: true } };

// Northpine's card wizard on its second page, as the widget listed it when the demo stopped (run 3): the card type, with Virtual already chosen.
const cardType: Snapshot = {
  path: "/cards/new",
  title: "Northpine",
  headings: ["Issue a card", "Card type"],
  text: ["Cardholder", "Card type", "Limits and controls", "Review", "Step 2 of 4"],
  truncated: false,
  elements: [
    { id: "e4", role: "link", label: "Cards", icon: "credit-card", state: ["current"], href: "/cards", context: "nav" },
    { id: "e23", role: "button", label: "Create new", icon: "plus", state: ["opens a menu", "collapsed"], context: "header" },
    { id: "e25", role: "button", label: "Help", icon: "circle-question-mark", state: ["opens a menu", "collapsed"], context: "header" },
    { id: "e27", role: "link", label: "Cards", href: "/cards", context: "nav › Breadcrumb" },
    { id: "e28", role: "radio", label: "Virtual card Use online and in Apple Pay in minutes. Best for subscriptions…", state: ["checked"], context: "main › Card type" },
    { id: "e29", role: "radio", label: "Physical card A metal card mailed to the holder. Best for travel and in-person…", icon: "credit-card", context: "main › Card type" },
    { id: "e30", role: "link", label: "Cancel", href: "/cards", context: "footer" },
    { id: "e31", role: "button", label: "Back", context: "footer" },
    { id: "e32", role: "button", label: "Next", context: "footer" },
  ],
};
// The wizard's third page, with the limit still to set, and its last, with the button that issues the card.
const limits: Snapshot = {
  ...cardType,
  headings: ["Issue a card", "Limits and controls"],
  elements: [
    { id: "e28", role: "textbox", label: "Spending limit", context: "main › Limits and controls" },
    { id: "e29", role: "combobox", label: "Limit interval", state: ["opens a list", "collapsed"], context: "main › Limits and controls" },
    { id: "e35", role: "button", label: "Back", context: "footer" },
    { id: "e36", role: "button", label: "Next", context: "footer" },
  ],
};
const review: Snapshot = {
  ...cardType,
  headings: ["Issue a card", "Review"],
  elements: [
    { id: "e32", role: "button", label: "Back", context: "footer" },
    { id: "e33", role: "button", label: "Issue card", context: "footer" },
  ],
};

const question = "Can you issue Malika Cummerata a virtual card called Ads with a $500 monthly limit?";
const actStep = (snapshot: Snapshot, step: number, event: string): TurnRequest => ({ site: actingSite.id, version: 3, mode: "act", goal: question, step, history: [], event, snapshot });
const onCardType = actStep(cardType, 5, 'You clicked button "Next". It is e32 in the list now, and looks unchanged.');
const onLimits = actStep(limits, 6, 'You clicked button "Next". It is e36 in the list now, and looks unchanged.');
const onReview = actStep(review, 9, 'You clicked button "Next". It is e33 in the list now, and now reads "Issue card".');

const act = (reply: Omit<TurnReply, "do" | "enter" | "commits"> & Partial<TurnReply>): TurnReply => ({ do: null, enter: null, commits: false, ...reply });
// Run 3, call 6, exactly as the model wrote it.
const skipsVirtual = act({ target: null, status: "continue", say: "Virtual is already selected, so I'm skipping that choice. Next to open Limits and controls." });
// Runs 1 and 2, call 6: what it should have been.
const clicksNext = act({ target: "e32", do: "click", status: "continue", say: "Virtual is already selected, so I'm clicking Next to go to Limits and controls." });
const handOver = act({ target: "e33", commits: true, status: "done", say: "Ready. Check that the holder is Malika Cummerata, the card is virtual and named Ads, and the limit is $500.00 per month, then click Issue card." });
// The visitor's turn: a value they did not give, at a field. Pointed at, as the act instructions ask, and with nothing pointed at.
const theirLimit = act({ target: "e28", status: "continue", say: "Fill in Spending limit with the amount you want, and I'll carry on." });
const theirLimitUnpointed = act({ target: null, status: "continue", say: "Type the monthly limit you want in Spending limit, and I'll click Next after." });

test("in act mode, a reply of continue that names a control Haptic could press and points at nothing is found", () => {
  assert.equal(namedButNotDone(onCardType, skipsVirtual)?.id, "e32");
  assert.equal(namedButNotDone(onCardType, act({ target: null, status: "continue", say: "Clicking next to go to Limits and controls." }))?.id, "e32");
  // Of several, the one named last: what is so comes before what comes next.
  assert.equal(namedButNotDone(onCardType, act({ target: null, status: "continue", say: "Virtual is chosen and Cancel would lose it, so Next to open Limits and controls." }))?.id, "e32");
  // A word that says to use it comes first, wherever it is.
  assert.equal(namedButNotDone(onCardType, act({ target: null, status: "continue", say: "Going on with Next later. Opening Help first." }))?.id, "e25");
});

test("in act mode, the hand-over, the visitor's turn, and a reply that names nothing Haptic could press are left alone", () => {
  // It points at something.
  assert.equal(namedButNotDone(onCardType, clicksNext), undefined);
  // The hand-over, pointed or not.
  assert.equal(namedButNotDone(onReview, handOver), undefined);
  assert.equal(namedButNotDone(onReview, { ...handOver, target: null }), undefined);
  // A control that commits is never something Haptic could press, so a "continue" that names only it is not asked about here.
  assert.equal(namedButNotDone(onReview, act({ target: null, status: "continue", say: "Everything is filled in. Issue card to finish." })), undefined);
  // Nor is one the site marks with its own words.
  assert.equal(namedButNotDone(onCardType, skipsVirtual, ["Next"]), undefined);
  // The visitor's turn at a field, a value they did not give: pointed at, unpointed, as a question, and told to them.
  assert.equal(namedButNotDone(onLimits, theirLimit), undefined);
  assert.equal(namedButNotDone(onLimits, theirLimitUnpointed), undefined);
  assert.equal(namedButNotDone(onLimits, act({ target: null, status: "continue", say: "What monthly limit should the card have? I'll press Next once it's in." })), undefined);
  assert.equal(namedButNotDone(onLimits, act({ target: null, status: "continue", say: "You'll need to pick how often it resets in Limit interval. Next comes after." })), undefined);
  assert.equal(namedButNotDone(onLimits, act({ target: null, status: "continue", say: "Spending limit needs an amount from you; please enter it in Spending limit before Next." })), undefined);
  // A field named on its own is never something Haptic presses.
  assert.equal(namedButNotDone(onLimits, act({ target: null, status: "continue", say: "Typing 500 in Spending limit." })), undefined);
  // Told not to, or a common word that is not written as the control's name.
  assert.equal(namedButNotDone(onCardType, act({ target: null, status: "continue", say: "Virtual is already selected, so don't press Back." })), undefined);
  assert.equal(namedButNotDone(onCardType, act({ target: null, status: "continue", say: "Virtual is already selected. The limits come next." })), undefined);
  // "done" is an ending, not a step left waiting.
  assert.equal(namedButNotDone(onCardType, { ...skipsVirtual, status: "done" }), undefined);
});

test("in act mode, the run 3 reply is asked about once more at a later step, and the reply that does the step is the one sent", async () => {
  const { sent } = use([{ streams: '{"target":null', reply: skipsVirtual }, { streams: '{"target":"e32"', reply: clicksNext }], "ask");
  const early: string[] = [];
  const logged: string[] = [];
  const log = console.log;
  console.log = (...words: unknown[]) => void logged.push(words.join(" "));
  let measure;
  try {
    measure = await measureTurn(actingSite, onCardType, undefined, (id) => early.push(id));
  } finally {
    console.log = log;
  }
  assert.equal(sent.length, 2);
  const told = sent[1]!.messages.at(-1)!.content as string;
  assert.match(told, /names button "Next" \(e32\), but its target is null and its status "continue"/);
  assert.match(told, /reply again with e32 as the target, the "do" for it and status "continue"/);
  assert.deepEqual(JSON.parse(sent[1]!.messages.at(-2)!.content as string), skipsVirtual);
  // Asked with the act instructions and the act reply's shape, as the first question was.
  assert.equal(JSON.stringify(sent[1]!.system), JSON.stringify(sent[0]!.system));
  assert.deepEqual(measure.reply, { ...clicksNext, mode: "act" });
  assert.deepEqual(measure.recheck, { named: "e32", asked: true, act: true });
  assert.deepEqual(measure.acting, { modelDo: "click" });
  assert.deepEqual(early, ["e32"]);
  // Each firing is logged with ids and numbers only: nothing the model wrote, nothing from the page.
  const firing = logged.filter((line) => line.startsWith("recheck "));
  assert.deepEqual(firing, ['recheck site_acting step 5: an act reply of "continue" names e32, which Haptic could press, and nothing is pointed at, asking again']);
});

test("in act mode, the hand-over and the visitor's turn are never asked about again", async () => {
  for (const [request, reply] of [[onReview, handOver], [onLimits, theirLimit], [onLimits, theirLimitUnpointed]] as const) {
    const { sent } = use([{ reply }, { reply: clicksNext }], "ask");
    const measure = await measureTurn(actingSite, request);
    assert.equal(sent.length, 1, reply.say);
    // The guide's check may still log "click Next" in a sentence after the first question, as it always has. It does not ask.
    assert.notEqual(measure.recheck?.asked, true, reply.say);
    assert.equal(measure.recheck?.act, undefined, reply.say);
    assert.equal(measure.reply.target, reply.target);
  }
});

test("in act mode, a stalled reply is only logged when the check only logs, and nothing is done when it is off", async () => {
  const logs = use([{ reply: skipsVirtual }, { reply: clicksNext }], "log");
  const measure = await measureTurn(actingSite, onCardType);
  assert.equal(logs.sent.length, 1);
  assert.equal(measure.reply.target, null);
  assert.deepEqual(measure.recheck, { named: "e32", asked: false, act: true });
  const off = use([{ reply: skipsVirtual }, { reply: clicksNext }], "off");
  assert.equal((await measureTurn(actingSite, onCardType)).recheck, undefined);
  assert.equal(off.sent.length, 1);
});

test("a guide's later step is not asked about again, the same page and words included", async () => {
  const guideStep: TurnRequest = { ...onCardType, mode: undefined, event: 'The user clicked button "Next".' };
  delete guideStep.mode;
  const clickNext: TurnReply = { target: null, status: "continue", say: "Virtual is already selected. Click Next to open Limits and controls." };
  for (const [on, request, reply] of [
    [site, guideStep, clickNext],
    [site, guideStep, { target: null, status: "continue", say: skipsVirtual.say } as TurnReply],
    // The widget asked to act where the site has acting off: answered as a guide, and checked as one.
    [site, onCardType, clickNext],
  ] as const) {
    const { sent } = use([{ reply }, { reply: { target: "e32", status: "continue", say: "Click Next." } }], "ask");
    const measure = await measureTurn(on, request);
    assert.equal(sent.length, 1, reply.say);
    assert.equal(measure.reply.target, null);
    assert.notEqual(measure.recheck?.asked, true);
    assert.equal(measure.recheck?.act, undefined);
  }
});

test.after(() => configure({ HAPTIC_MODEL: "mock" }));
