import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { namedButNotDone, namedButNotPointed, pressLeftToVisitor } from "../src/server/check.ts";
import type { ModelReply } from "../src/server/answers.ts";
import { ceilingFor, configure, measureTurn, SETTINGS } from "../src/server/model.ts";
import { checkAction } from "../src/shared/act-rules.ts";
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
  /** A guide's or an act reply, or a reply as it is written on a site with Answers on. */
  reply?: TurnReply | ModelReply;
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
  const measure = await measureTurn(site, request, undefined, { onTarget: (id) => early.push(id) });
  assert.equal(sent.length, 2);
  const told = sent[1]!.messages.at(-1)!.content as string;
  assert.match(told, /tells the visitor to use link "FAQ" \(e3\), but its target is null/);
  assert.deepEqual(JSON.parse(sent[1]!.messages.at(-2)!.content as string), namesFaq);
  assert.deepEqual(measure.reply, pointsAtFaq);
  assert.deepEqual(measure.recheck, { named: "e3", asked: true, verdict: "ask" });
  // The second reply's pointer goes out as soon as it is known, as a first reply's would.
  assert.deepEqual(early, ["e3"]);
});

test("after the first question, a question about what the site has that is answered in words is left as it is", async () => {
  // The owner's rule of 15 November: such a question can be answered in one sentence. Asked again, a model points at what it named.
  const { sent } = use([{ reply: namesFaq }, { reply: pointsAtFaq }], "ask");
  const later = { ...request, step: 2, event: 'The user clicked tab "History".' };
  const measure = await measureTurn(site, later);
  assert.equal(sent.length, 1);
  assert.equal(measure.reply.target, null);
  assert.deepEqual(measure.recheck, { named: "e3", asked: false, verdict: "aside" });
});

test("with the check only logging, the reply is sent as the model wrote it", async () => {
  const { sent } = use([{ reply: namesFaq }, { reply: pointsAtFaq }], "log");
  const measure = await measureTurn(site, request);
  assert.equal(sent.length, 1);
  assert.equal(measure.reply.target, null);
  assert.deepEqual(measure.recheck, { named: "e3", asked: false, verdict: "ask" });
});

// After the first question: Northpine's owner asked to add a budget, was led to Budgets, and the guide ended there in words.

const budgetsPage: Snapshot = {
  path: "/budgets",
  title: "Budgets, Northpine",
  headings: ["Budgets"],
  text: [],
  truncated: false,
  elements: [
    { id: "e14", role: "link", label: "Budgets", href: "/budgets", context: "nav", state: ["current"] },
    { id: "e17", role: "link", label: "People", href: "/people", context: "nav" },
    { id: "e27", role: "button", label: "New budget", context: "main › Budgets" },
    { id: "e28", role: "button", label: "Show only these", context: "main › Budgets" },
  ],
};
const atBudgets: TurnRequest = {
  site: site.id,
  goal: "add a budget",
  step: 1,
  history: [],
  event: 'The user clicked link "Budgets". It is e14 in the list now, and is now current.',
  closing: true,
  snapshot: budgetsPage,
};
/** What the owner read, word for word, with the guide ended there. */
const ownersStop: TurnReply = { target: null, status: "done", say: "You're on the Budgets page now, where every team's budget is listed. To add one, use New budget at the top." };

test("after the first question, the owner's stop is pointed at New budget with the same sentence and no second call", async () => {
  const { sent } = use([{ reply: ownersStop }, { reply: pointsAtFaq }], "ask");
  const early: string[] = [];
  const { result: measure, lines } = await logging(() => measureTurn(site, atBudgets, undefined, { onTarget: (id) => early.push(id) }));
  assert.equal(sent.length, 1);
  assert.deepEqual(measure.reply, { target: "e27", status: "continue", say: ownersStop.say });
  assert.deepEqual(measure.recheck, { named: "e27", asked: false, verdict: "point", pointed: true });
  // The pointer goes out at once, and the step costs one call.
  assert.deepEqual(early, ["e27"]);
  assert.deepEqual(
    lines.filter((line) => line.startsWith("recheck ")),
    ["recheck site_test step 1: the sentence tells the visitor to use e27 and nothing is pointed at, so it is pointed at"],
  );
  // With the check only logging, or off, the reply goes as the model wrote it.
  for (const recheck of ["log", "off"]) {
    use([{ reply: ownersStop }], recheck);
    assert.deepEqual((await measureTurn(site, atBudgets)).reply, ownersStop, recheck);
  }
});

test("after the first question, a control named as an aside is left as it is, and one less plain is asked about once more", async () => {
  // Written for this test: the visitor's own call, once the budget is saved.
  const optional: TurnReply = { target: null, status: "done", say: "Your budget is saved. If you ever need another, use New budget." };
  const aside = use([{ reply: optional }, { reply: pointsAtFaq }], "ask");
  const left = await measureTurn(site, atBudgets);
  assert.equal(aside.sent.length, 1);
  assert.deepEqual(left.reply, optional);
  assert.deepEqual(left.recheck, { named: "e27", asked: false, verdict: "aside" });
  // The sentence says something is done, and still names the goal's control: the model decides, told what it did.
  const opened: TurnReply = { target: null, status: "done", say: "The Budgets page is now open. To add one, use New budget at the top." };
  const pointsAtNew: TurnReply = { target: "e27", status: "continue", say: "Click New budget at the top." };
  const asked = use([{ reply: opened }, { reply: pointsAtNew }], "ask");
  const again = await measureTurn(site, atBudgets);
  assert.equal(asked.sent.length, 2);
  assert.match(asked.sent[1]!.messages.at(-1)!.content as string, /tells the visitor to use button "New budget" \(e27\), but its target is null/);
  assert.deepEqual(again.reply, pointsAtNew);
  assert.deepEqual(again.recheck, { named: "e27", asked: true, verdict: "ask" });
});

test("in act mode, a later reply that ends in words naming the goal's control is asked about once more, never made a step in code", async () => {
  const acting: SiteContext = { ...site, acting: { enabled: true } };
  const actAt: TurnRequest = { ...atBudgets, site: acting.id, version: 3, mode: "act" };
  delete actAt.closing;
  const opens: TurnReply = { target: "e27", do: "click", enter: null, commits: false, status: "continue", say: "Opening New budget." };
  const { sent } = use([{ reply: { ...ownersStop, do: null, enter: null, commits: false } }, { reply: opens }], "ask");
  const measure = await measureTurn(acting, actAt);
  assert.equal(sent.length, 2);
  assert.equal(measure.reply.target, "e27");
  assert.equal(measure.reply.do, "click");
  assert.deepEqual(measure.recheck, { named: "e27", asked: true, verdict: "point" });
});

// The same stop on a site with Answers on, which is where the owner met it: Northpine with its help docs. Until this
// was fixed nothing there was looked at twice, since an answer in words names controls without pointing by design.

const withDocs: SiteContext = {
  ...site,
  id: "site_docs",
  docs: [{ title: "Freeze or cancel a card", source: "freeze.md", text: "Freezing a card blocks new charges until you unfreeze it. Open the card and click Freeze card." }],
};
/** A reply as the model writes it on a site with Answers on. */
const written = (reply: Partial<ModelReply>): ModelReply => ({ mode: "guide", target: null, status: "done", reason: null, say: "", sources: [], controls: [], ...reply });

test("on a site with Answers on, the owner's stop in guide mode is pointed at New budget, with the same sentence and no second call", async () => {
  const asked: TurnRequest = { ...atBudgets, site: withDocs.id, goal: "how do I add a budget" };
  delete asked.closing;
  const { sent } = use([{ reply: written({ say: ownersStop.say }) }, { reply: pointsAtFaq }], "ask");
  const early: string[] = [];
  const { result: measure, lines } = await logging(() => measureTurn(withDocs, asked, undefined, { onTarget: (id) => early.push(id) }));
  assert.equal(sent.length, 1);
  assert.deepEqual(measure.reply, { target: "e27", status: "continue", say: ownersStop.say, mode: "guide" });
  assert.deepEqual(measure.recheck, { named: "e27", asked: false, verdict: "point", pointed: true });
  assert.deepEqual(early, ["e27"]);
  assert.deepEqual(
    lines.filter((line) => line.startsWith("recheck ")),
    ["recheck site_docs step 1: the sentence tells the visitor to use e27 and nothing is pointed at, so it is pointed at"],
  );
  // The closing statement after a "done", which is how the widget of this work asks it, is judged the same.
  use([{ reply: written({ say: ownersStop.say }) }], "ask");
  assert.equal((await measureTurn(withDocs, { ...asked, closing: true })).reply.target, "e27");
  // With the check only logging, or off, the reply goes as the model wrote it.
  for (const recheck of ["log", "off"]) {
    use([{ reply: written({ say: ownersStop.say }) }], recheck);
    assert.deepEqual((await measureTurn(withDocs, asked)).reply, { target: null, status: "done", say: ownersStop.say, mode: "guide" }, recheck);
  }
});

test("on a site with Answers on, a guide reply that is less plain is asked about once more, and the model is shown its own reply whole", async () => {
  const asked: TurnRequest = { ...atBudgets, site: withDocs.id, goal: "how do I add a budget" };
  const opened = written({ say: "The Budgets page is now open. To add one, use New budget at the top." });
  const pointsAtNew = written({ target: "e27", status: "continue", say: "Click New budget at the top." });
  const { sent } = use([{ reply: opened }, { reply: pointsAtNew }], "ask");
  const measure = await measureTurn(withDocs, asked);
  assert.equal(sent.length, 2);
  assert.deepEqual(JSON.parse(sent[1]!.messages.at(-2)!.content as string), opened);
  assert.match(sent[1]!.messages.at(-1)!.content as string, /tells the visitor to use button "New budget" \(e27\), but its target is null/);
  assert.deepEqual(measure.reply, { target: "e27", status: "continue", say: "Click New budget at the top.", mode: "guide" });
  assert.deepEqual(measure.recheck, { named: "e27", asked: true, verdict: "ask" });
  // An aside is left as it is, as on any site.
  const aside = use([{ reply: written({ say: "Your budget is saved. If you ever need another, use New budget." }) }, { reply: pointsAtNew }], "ask");
  const left = await measureTurn(withDocs, asked);
  assert.equal(aside.sent.length, 1);
  assert.equal(left.reply.target, null);
  assert.deepEqual(left.recheck, { named: "e27", asked: false, verdict: "aside" });
});

// A card's page, where an answer from the article can name a control that is on the page.
const cardPage: Snapshot = {
  path: "/cards/card_1",
  title: "Team offsite, Northpine",
  headings: ["Team offsite"],
  text: [],
  truncated: false,
  elements: [
    { id: "e5", role: "link", label: "Cards", href: "/cards", context: "nav" },
    { id: "e30", role: "button", label: "Freeze card", context: "main › Team offsite" },
    { id: "e31", role: "button", label: "Edit limits", context: "main › Team offsite" },
  ],
};
const freezeAnswer = written({ mode: "answer", say: "Freezing a card blocks new charges right away. Click Freeze card to do it.", sources: ["a1"], controls: ["Freeze card"] });

test("on a site with Answers on, an answer in words to a question of fact or explanation stays as it is, whatever control it names", async () => {
  for (const goal of ["what does freezing a card do?", "how does freezing work", "can I freeze a card?"]) {
    const { sent } = use([{ reply: freezeAnswer }, { reply: pointsAtFaq }], "ask");
    const measure = await measureTurn(withDocs, { site: withDocs.id, goal, step: 0, history: [], snapshot: cardPage });
    assert.equal(sent.length, 1, goal);
    assert.equal(measure.recheck, undefined, goal);
    assert.equal(measure.reply.mode, "answer", goal);
    assert.equal(measure.reply.target, null, goal);
    assert.equal(measure.reply.status, "done", goal);
    assert.equal(measure.reply.say, freezeAnswer.say, goal);
    assert.deepEqual(measure.cited, ["freeze.md"], goal);
  }
  // "I can't help" is a fixed sentence, and what the model wrote under it is never looked at. (Only "not covered" to a
  // question that asks for a way is asked about again: see the test of it below.)
  const { sent } = use([{ reply: written({ mode: "cannot_help", reason: "sensitive", say: "Click Freeze card." }) }], "ask");
  const cannot = await measureTurn(withDocs, { site: withDocs.id, goal: "how do I freeze this card", step: 0, history: [], snapshot: cardPage });
  assert.equal(sent.length, 1);
  assert.equal(cannot.reply.mode, "cannot_help");
  assert.equal(cannot.recheck, undefined);
});

test("on a site with Answers on, an answer in words to a how-to question is not the end: the control it names is pointed at and the guide goes on", async () => {
  const howTo: TurnRequest = { site: withDocs.id, goal: "how do I freeze this card", step: 0, history: [], snapshot: cardPage };
  // It names the goal's control and points at nothing: the control is pointed at, the answer's words and article stay.
  const { sent } = use([{ reply: freezeAnswer }, { reply: pointsAtFaq }], "ask");
  const measure = await measureTurn(withDocs, howTo);
  assert.equal(sent.length, 1);
  assert.equal(measure.reply.mode, "answer");
  assert.equal(measure.reply.target, "e30");
  assert.equal(measure.reply.status, "continue");
  assert.equal(measure.reply.say, freezeAnswer.say);
  assert.equal(measure.reply.sources?.[0]?.title, "Freeze or cancel a card");
  assert.deepEqual(measure.recheck, { named: "e30", asked: false, verdict: "point", pointed: true });
  // It points at the control and calls that the end: for a how-to question the pointer is the first step.
  use([{ reply: { ...freezeAnswer, target: "e30", status: "done" } }], "ask");
  const pointed = await measureTurn(withDocs, howTo);
  assert.equal(pointed.reply.target, "e30");
  assert.equal(pointed.reply.status, "continue");
  // For a question of fact the same reply is the end, with the pointer showing where the thing is.
  use([{ reply: { ...freezeAnswer, target: "e30", status: "done" } }], "ask");
  const shown = await measureTurn(withDocs, { ...howTo, goal: "what does freezing a card do?" });
  assert.equal(shown.reply.target, "e30");
  assert.equal(shown.reply.status, "done");
  // It tells them to use two controls, so which comes first is the model's to say: asked once more.
  const both = written({ mode: "answer", say: "Freezing a card blocks new charges. Open Cards, then click Freeze card on the card's page.", sources: ["a1"], controls: ["Cards", "Freeze card"] });
  const step = written({ target: "e30", status: "continue", say: "Click Freeze card." });
  const asked = use([{ reply: both }, { reply: step }], "ask");
  const again = await measureTurn(withDocs, howTo);
  assert.equal(asked.sent.length, 2);
  assert.deepEqual(again.reply, { target: "e30", status: "continue", say: "Click Freeze card.", mode: "guide" });
});

// Haptic's demo app, which has help docs and so Answers on, in the tuned benchmark of 16 November: asked "Where do I
// get an API key?", the guide ended on the Security tab in words that name the button and do not say to use it.
const securityPage: Snapshot = {
  path: "/demo/settings-security",
  title: "Settings, Acme",
  headings: ["Settings", "API keys"],
  text: [],
  truncated: false,
  elements: [
    { id: "e4", role: "link", label: "Security", href: "/demo/settings-security", context: "main › Settings", state: ["current"] },
    { id: "e9", role: "checkbox", label: "Require two-factor authentication", context: "main › Security" },
    { id: "e12", role: "button", label: "Create API key", context: "main › API keys" },
    { id: "e13", role: "button", label: "Revoke", context: "main › API keys" },
  ],
};
const demoStop = "You're on the Security tab, and the API keys section is in the main area. Existing keys are listed there, and Create API key makes a new one.";
const atSecurity: TurnRequest = { site: site.id, goal: "Where do I get an API key?", step: 3, history: [], event: 'The user clicked link "Security". It is e4 in the list now, and is now current.', snapshot: securityPage };

test("a guide that ends in words naming the goal's control, with no word that says to use it, is asked about once more, with Answers on or off", async () => {
  const pointsAtCreate: TurnReply = { target: "e12", status: "continue", say: "Click Create API key." };
  // On a site without Answers.
  const plain = use([{ reply: { target: null, status: "done", say: demoStop } }, { reply: pointsAtCreate }], "ask");
  const { result: measure, lines } = await logging(() => measureTurn(site, atSecurity));
  assert.equal(plain.sent.length, 2);
  assert.match(plain.sent[1]!.messages.at(-1)!.content as string, /ends the guide and names button "Create API key" \(e12\), but its target is null/);
  assert.deepEqual(measure.reply, pointsAtCreate);
  assert.deepEqual(measure.recheck, { named: "e12", asked: true, verdict: "ask" });
  assert.deepEqual(
    lines.filter((line) => line.startsWith("recheck ")),
    ["recheck site_test step 3: the guide ends in words that name e12, a control of the goal, and nothing is pointed at, asking again"],
  );
  // On a site with Answers on, where it was seen.
  const answersOn = use([{ reply: written({ say: demoStop }) }, { reply: written({ target: "e12", status: "continue", say: "Click Create API key." }) }], "ask");
  const guided = await measureTurn(withDocs, { ...atSecurity, site: withDocs.id });
  assert.equal(answersOn.sent.length, 2);
  assert.deepEqual(guided.reply, { target: "e12", status: "continue", say: "Click Create API key.", mode: "guide" });
  // The model may end as it did: its second reply stands, and nothing is pointed at in code.
  use([{ reply: { target: null, status: "done", say: demoStop } }, { reply: { target: null, status: "done", say: "The API keys are listed on this tab." } }], "ask");
  const stands = await measureTurn(site, atSecurity);
  assert.deepEqual(stands.reply, { target: null, status: "done", say: "The API keys are listed on this tab." });
  // A guide that gives up while naming the goal's control as the place to try is the same contradiction (backstage, 16 November).
  const gaveUp = use([{ reply: { target: null, status: "stuck", say: "I can't find a way to make a key here. Try Create API key in the API keys section." } }, { reply: pointsAtCreate }], "ask");
  assert.deepEqual((await measureTurn(site, atSecurity)).reply, pointsAtCreate);
  assert.equal(gaveUp.sent.length, 2);
  // With the check only logging, the reply goes as the model wrote it.
  const logged = use([{ reply: { target: null, status: "done", say: demoStop } }], "log");
  assert.equal((await measureTurn(site, atSecurity)).reply.target, null);
  assert.equal(logged.sent.length, 1);
});

test("a guide that ends in words is left alone when the goal is a question of fact, the thing is done, or the control is not the goal's", async () => {
  const left: [string, string][] = [
    // A question of fact, answered.
    ["which API keys do we have?", "Two keys are listed on this tab, and Create API key makes a new one."],
    // The thing is done.
    ["Where do I get an API key?", "Your key has been created and is shown once. Create API key makes another."],
    ["Where do I get an API key?", "Done. The new key is listed here, and Create API key makes another."],
    // It names a control that has nothing to do with the goal, or tells the visitor not to use the one that has.
    ["Where do I get an API key?", "You're on the Security tab. Revoke is beside each one."],
    ["Where do I get an API key?", "This tab lists your keys. There's no need to use Create API key for that."],
    // It names nothing on the page by its own name.
    ["Where do I get an API key?", "API keys are made on this tab, with the button above the list."],
  ];
  for (const [goal, say] of left) {
    const { sent } = use([{ reply: { target: null, status: "done", say } }, { reply: pointsAtFaq }], "ask");
    const measure = await measureTurn(site, { ...atSecurity, goal });
    assert.equal(sent.length, 1, say);
    assert.equal(measure.reply.target, null, say);
    assert.equal(measure.recheck, undefined, say);
  }
});

// Haptic's demo app with its help docs, 17 November: "How do I delete this workspace?" on the home page, where the way
// is behind the account menu, was answered "I couldn't find that on Acme Console or in its help docs." in 7 replies of 12.
const demoHome: Snapshot = {
  path: "/demo",
  title: "Acme Console",
  headings: ["Projects"],
  text: [],
  truncated: false,
  elements: [
    { id: "e1", role: "link", label: "Projects", href: "/demo/projects", context: "nav" },
    { id: "e2", role: "link", label: "Team", href: "/demo/team", context: "nav" },
    { id: "e5", role: "button", label: "A", context: "header", state: ["collapsed"] },
  ],
};
const cannotFind = written({ mode: "cannot_help", status: "done", reason: "not_covered" });
const opensAccount = written({ target: "e5", status: "continue", say: "Click the round A button at the top right to open the account menu." });
const deleteIt: TurnRequest = { site: withDocs.id, goal: "How do I delete this workspace?", step: 0, history: [], snapshot: demoHome };

test('on a site with Answers on, "not covered" to a first question that asks for a way is asked about once more, and the second reply is the one sent', async () => {
  const { sent } = use([{ streams: '{"mode":"cannot_help","target":null', reply: cannotFind }, { streams: '{"mode":"guide","target":"e5"', reply: opensAccount }], "ask");
  const early: string[] = [];
  const { result: measure, lines } = await logging(() => measureTurn(withDocs, deleteIt, undefined, { onTarget: (id) => early.push(id) }));
  assert.equal(sent.length, 2);
  assert.deepEqual(JSON.parse(sent[1]!.messages.at(-2)!.content as string), cannotFind);
  assert.match(sent[1]!.messages.at(-1)!.content as string, /says you can't help because nothing covers it\. The visitor asked for a way/);
  assert.deepEqual(measure.reply, { target: "e5", status: "continue", say: "Click the round A button at the top right to open the account menu.", mode: "guide" });
  assert.deepEqual(measure.recheck, { named: "", asked: true, gaveUp: true });
  // The second reply's pointer goes out as soon as it is known, though the first reply declined.
  assert.deepEqual(early, ["e5"]);
  assert.deepEqual(lines.filter((line) => line.startsWith("recheck ")), ['recheck site_docs step 0: "not covered" to a question that asks for a way, asking again']);
  // The model may say it again: then the visitor reads the fixed sentence, and is offered a person as before.
  const twice = use([{ reply: cannotFind }, { reply: cannotFind }], "ask");
  const still = await measureTurn(withDocs, deleteIt);
  assert.equal(twice.sent.length, 2);
  assert.deepEqual(still.reply, { target: null, status: "stuck", say: "I couldn't find that on Test or in its help docs.", mode: "cannot_help", reason: "not_covered" });
});

test('"not covered" is left as it is for a question of fact, a question for a person, one off the subject, a later step, and when the check is not asking', async () => {
  const once = async (reply: ModelReply, request: TurnRequest, recheck = "ask") => {
    const { sent } = use([{ reply }, { reply: opensAccount }], recheck);
    const measure = await measureTurn(withDocs, request);
    return [sent.length, measure.reply.mode, measure.reply.reason];
  };
  assert.deepEqual(await once(cannotFind, { ...deleteIt, goal: "can a workspace be deleted?" }), [1, "cannot_help", "not_covered"]);
  assert.deepEqual(await once({ ...cannotFind, reason: "sensitive" }, deleteIt), [1, "cannot_help", "sensitive"]);
  assert.deepEqual(await once({ ...cannotFind, reason: "off_topic" }, deleteIt), [1, "cannot_help", "off_topic"]);
  assert.deepEqual(await once(cannotFind, { ...deleteIt, step: 2, event: 'The user clicked link "Team".' }), [1, "cannot_help", "not_covered"]);
  assert.deepEqual(await once(cannotFind, deleteIt, "log"), [1, "cannot_help", "not_covered"]);
  assert.deepEqual(await once(cannotFind, deleteIt, "off"), [1, "cannot_help", "not_covered"]);
});

test('"Not that one." is said only to a visitor who used something other than the step shown', async () => {
  // Northpine's Bills, 16 November: the model pointed at the Vendor column's button, the visitor clicked it, and was told "Not that one."
  const blames: TurnReply = { target: "e17", status: "continue", say: "Not that one. Click People in the sidebar." };
  const didTheStep: TurnRequest = { ...atBudgets, event: 'The user clicked link "Budgets". It is e14 in the list now, and looks unchanged.' };
  delete didTheStep.closing;
  use([{ reply: blames }], "ask");
  assert.equal((await measureTurn(site, didTheStep)).reply.say, "Click People in the sidebar.");
  // The visitor used something else, or went elsewhere, and the widget says so: the opening stays, as the instructions ask.
  for (const event of ['The user clicked button "Show only these" instead of link "Budgets".', 'The user went to /people without using link "Budgets".']) {
    use([{ reply: blames }], "ask");
    assert.equal((await measureTurn(site, { ...didTheStep, offTrack: true, event })).reply.say, "Not that one. Click People in the sidebar.", event);
  }
  // They closed the dialog the control was in. That is off the way, and there was still no other one.
  use([{ reply: blames }], "ask");
  const closed = await measureTurn(site, { ...didTheStep, offTrack: true, event: 'The user clicked outside the dialog "Pay Brightdesk", which closed it without using button "Continue".' });
  assert.equal(closed.reply.say, "Click People in the sidebar.");
  // On a site with Answers on it is the same sentence and the same rule.
  use([{ reply: written({ target: "e17", status: "continue", say: "Not that one. click People in the sidebar." }) }], "ask");
  assert.equal((await measureTurn(withDocs, { ...didTheStep, site: withDocs.id })).reply.say, "Click People in the sidebar.");
  // A sentence that is nothing but the opening is left as it is, rather than shown empty.
  use([{ reply: { target: "e17", status: "continue", say: "Not that one." } }], "ask");
  assert.equal((await measureTurn(site, didTheStep)).reply.say, "Not that one.");
});

test("when asking again fails, the first reply still reaches the visitor", async () => {
  const refused = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "bad" } }, undefined, new Headers());
  use([{ reply: namesFaq }, { fails: refused }], "ask");
  const measure = await measureTurn(site, request);
  assert.equal(measure.reply.say, namesFaq.say);
});

// What a step costs when the model is asked twice: both calls are paid for, and the budget sets aside room for both.

test("a step that asks the model again costs both calls, and a second call that fails still counts", async () => {
  use([{ reply: pointsAtFaq }], "ask");
  const once = await measureTurn(site, request);
  assert.ok(once.usd > 0, "a call to a real model costs something");
  use([{ reply: namesFaq }, { reply: pointsAtFaq }], "ask");
  const twice = await measureTurn(site, request);
  assert.equal(twice.recheck?.asked, true);
  assert.ok(Math.abs(twice.usd - 2 * once.usd) < 1e-12, `two calls cost ${twice.usd}, one ${once.usd}`);
  const refused = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "bad" } }, undefined, new Headers());
  use([{ reply: namesFaq }, { fails: refused }], "ask");
  assert.equal((await measureTurn(site, request)).usd, once.usd);
});

test("the budget sets aside two calls for a step that may ask again, and one where it cannot", () => {
  use([], "ask");
  const first = ceilingFor(site, request);
  const later = ceilingFor(site, { ...request, step: 2, event: 'The user clicked link "FAQ".' });
  const withAnswers = { ...site, answers: { enabled: true } };
  const answered = ceilingFor(withAnswers, { ...request, step: 2, event: 'The user clicked link "FAQ".' });
  use([], "off");
  const unchecked = ceilingFor(site, request);
  const answeredUnchecked = ceilingFor(withAnswers, { ...request, step: 2, event: 'The user clicked link "FAQ".' });
  // Any step of a guide may be asked again, the first or a later one, and on a site with Answers on too: its guide steps are judged the same.
  assert.ok(first.cold > unchecked.cold && first.warm > unchecked.warm);
  assert.ok(later.warm > unchecked.warm);
  assert.ok(answered.warm > answeredUnchecked.warm && answered.cold > answeredUnchecked.cold);
  // A read of the cached prompt costs less than writing it, so the second call adds less than the first.
  assert.ok(first.cold - unchecked.cold < unchecked.cold);
  assert.equal(SETTINGS.recheck, "off");
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
    measure = await measureTurn(actingSite, onCardType, undefined, { onTarget: (id) => early.push(id) });
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

test("a guide's later step is judged as a guide's, the same page and words included", async () => {
  const guideStep: TurnRequest = { ...onCardType, mode: undefined, event: 'The user clicked button "Next".' };
  delete guideStep.mode;
  const clickNext: TurnReply = { target: null, status: "continue", say: "Virtual is already selected. Click Next to open Limits and controls." };
  const pointsAtNext: TurnReply = { target: "e32", status: "continue", say: "Click Next." };
  // "Next" shares no word with the goal, so the model is asked once more, with a guide's note: never made a press.
  for (const [on, request] of [
    [site, guideStep],
    // The widget asked to act where the site has acting off: answered as a guide, and checked as one.
    [site, onCardType],
  ] as const) {
    const { sent } = use([{ reply: clickNext }, { reply: pointsAtNext }], "ask");
    const measure = await measureTurn(on, request);
    assert.equal(sent.length, 2);
    assert.match(sent[1]!.messages.at(-1)!.content as string, /tells the visitor to use button "Next" \(e32\), but its target is null/);
    assert.deepEqual(measure.reply, pointsAtNext);
    assert.deepEqual(measure.recheck, { named: "e32", asked: true, verdict: "ask" });
  }
  // With no word that tells the visitor to use it, a guide's sentence names nothing.
  const { sent } = use([{ reply: { target: null, status: "continue", say: skipsVirtual.say } }, { reply: pointsAtNext }], "ask");
  const measure = await measureTurn(site, guideStep);
  assert.equal(sent.length, 1);
  assert.equal(measure.recheck, undefined);
});

// Act mode: a press written as the visitor's. At the wizard's Limits page the
// model pointed at Next with "do" null and a guide's sentence in 2 demo runs
// of the last 3, and the visitor was given a turn for it.

const step8 = actStep(limits, 8, 'You chose "Per month" from the list that combobox "Limit interval" opened. It is e29 in the list now.');
// Runs 1 and 2, call 9, exactly as the model wrote them.
const clickNextRun1 = act({ target: "e36", status: "continue", say: "Click Next to go to the Review step. The $500 monthly limit is set." });
const clickNextRun2 = act({ target: "e36", status: "continue", say: "Click Next to move on to the Review step, where you can issue the card." });
/** The sentence Haptic says when it makes the press, or undefined when the press stays the visitor's. */
const made = (request: TurnRequest, reply: TurnReply, words?: readonly string[]) => pressLeftToVisitor(request, reply, words)?.say;
const sayingAt = (target: string, say: string) => act({ target, status: "continue", say });

/** Runs a step with the server's log caught, and gives back the lines that are not the model call's own. */
async function logging<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...words: unknown[]) => void lines.push(words.join(" "));
  try {
    const result = await run();
    return { result, lines: lines.filter((line) => !line.startsWith("turn ")) };
  } finally {
    console.log = log;
  }
}

test("in act mode, a reply that points at a control Haptic could press and only tells the visitor to click it is made Haptic's click", () => {
  assert.equal(pressLeftToVisitor(step8, clickNextRun1)?.element.id, "e36");
  assert.equal(made(step8, clickNextRun1), "Clicking Next to go to the Review step. The $500 monthly limit is set.");
  assert.equal(made(step8, clickNextRun2), "Clicking Next to move on to the Review step, where you can issue the card.");
  // As it was written at the same page in earlier rounds.
  assert.equal(
    made(step8, sayingAt("e36", "Click Next in the footer to go to the Review step. The limit is $500 and resets monthly.")),
    "Clicking Next in the footer to go to the Review step. The limit is $500 and resets monthly.",
  );
  assert.equal(
    made(step8, sayingAt("e36", "Click Next at the bottom to go to the Review step, where you can issue the card.")),
    "Clicking Next at the bottom to go to the Review step, where you can issue the card.",
  );
  // Inside a sentence it reads as the model writes its own steps.
  assert.equal(made(step8, sayingAt("e36", "The limit is set, so click Next to go to the Review step.")), "The limit is set, so I'm clicking Next to go to the Review step.");
  // Only the instruction changes: a "please", quote marks and the kind of control are kept or dropped with it.
  assert.equal(made(step8, sayingAt("e36", 'Please click "Next" to continue.')), 'Clicking "Next" to continue.');
  assert.equal(made(step8, sayingAt("e36", "Tap the Next button to go on.")), "Tapping the Next button to go on.");
  assert.equal(made(onCardType, sayingAt("e32", "Virtual is already selected. Press Next to open Limits and controls.")), "Virtual is already selected. Pressing Next to open Limits and controls.");
});

test("in act mode, the press stays the visitor's when the sentence leaves them more than the click, when it is not that control's, and when the control is a field, a list or a commit", () => {
  const left: [TurnRequest, TurnReply][] = [
    // A check, a choice or a value said to be theirs. The first three were written at this wizard in earlier rounds.
    [step8, sayingAt("e36", "Click Next to go to the Review step, where you can check the card before issuing it.")],
    [onCardType, sayingAt("e32", "Click Next to move on to Card type, where you can choose Virtual. Limits come after that.")],
    [onCardType, sayingAt("e32", "Virtual is already selected, so click Next to go to Limits and controls, where you can set the $500 monthly limit.")],
    [step8, sayingAt("e36", "Check that the limit is $500, then click Next.")],
    [step8, sayingAt("e36", "Make sure the limit reads $500 and click Next.")],
    [step8, sayingAt("e36", "Click Next, or Back to change the limit.")],
    [step8, sayingAt("e36", "If you want, click Next to go to the Review step.")],
    [step8, sayingAt("e36", "Click Next when you're ready.")],
    [step8, sayingAt("e36", "Ready for the Review step? Click Next.")],
    [step8, sayingAt("e36", "Click Next and pick Monthly there.")],
    [step8, sayingAt("e36", "Click Next, and click Issue card on the Review step.")],
    // Not an instruction to press it, or an instruction to press another control.
    [step8, sayingAt("e36", "Don't click Next yet.")],
    [step8, sayingAt("e36", "Now you can click Next to go on.")],
    [step8, sayingAt("e36", "The limit is set. Next takes you to the Review step.")],
    [step8, sayingAt("e36", "Click Back to change the limit.")],
    // A field and a list are filled in or picked from, never pressed in their place.
    [step8, sayingAt("e28", "Click Spending limit and type 500.")],
    [step8, sayingAt("e29", "Click Limit interval to pick Monthly.")],
    [step8, sayingAt("e29", "Check that Resets under Limit interval is set to Monthly. Change it if it isn't, then click Next.")],
    // A control that commits.
    [onReview, sayingAt("e33", "Click Issue card to create it.")],
    // The hand-over, a reply that already does something, and the answer to a closing question.
    [step8, { ...clickNextRun1, status: "done" }],
    [step8, { ...clickNextRun1, commits: true }],
    [step8, { ...clickNextRun1, target: null }],
    [{ ...step8, closing: true }, clickNextRun1],
  ];
  for (const [request, reply] of left) assert.equal(made(request, reply), undefined, reply.say);
  // A control the site marks with its own commit words.
  assert.equal(made(step8, clickNextRun1, ["Next"]), undefined);
});

test("in act mode, the step 8 reply is sent as Haptic's click with no second model call, and the conversion is logged with ids only", async () => {
  for (const recheck of ["ask", "off"]) {
    const { sent } = use([{ streams: '{"target":"e36"', reply: clickNextRun1 }, { reply: clickNextRun2 }], recheck);
    const early: string[] = [];
    const { result: measure, lines } = await logging(() => measureTurn(actingSite, step8, undefined, { onTarget: (id) => early.push(id) }));
    assert.equal(sent.length, 1, recheck);
    assert.deepEqual(measure.reply, {
      target: "e36",
      do: "click",
      enter: null,
      commits: false,
      status: "continue",
      say: "Clicking Next to go to the Review step. The $500 monthly limit is set.",
      mode: "act",
    });
    assert.deepEqual(measure.acting, { modelDo: null, converted: true });
    assert.equal(measure.wrote, clickNextRun1.say);
    assert.equal(measure.recheck, undefined);
    assert.deepEqual(early, ["e36"]);
    assert.deepEqual(lines, ['press site_acting step 8: an act reply of "continue" left a click on e36 to the visitor, which Haptic could press, so Haptic clicks it']);
  }
});

test("a guide's step is never made a click, the same page and words included", async () => {
  const guideStep: TurnRequest = { ...step8, event: 'The user chose "Per month" from the list that combobox "Limit interval" opened.' };
  delete guideStep.mode;
  const asGuide: TurnReply = { target: "e36", status: "continue", say: clickNextRun1.say };
  for (const [on, request, reply] of [
    [site, guideStep, asGuide],
    [actingSite, guideStep, asGuide],
    // The widget asked to act where the site has acting off: answered as a guide.
    [site, step8, clickNextRun1],
  ] as const) {
    const { sent } = use([{ reply }], "ask");
    const { result: measure, lines } = await logging(() => measureTurn(on, request));
    assert.equal(sent.length, 1);
    assert.deepEqual(measure.reply, asGuide);
    assert.equal(measure.acting?.converted, undefined);
    assert.deepEqual(lines, []);
  }
});

test('in act mode, "Click Issue card" on the commit with do null and commits false stays the visitor\'s, and the click it asks for is refused', async () => {
  const onIssueCard = sayingAt("e33", "Click Issue card to create it.");
  const { sent } = use([{ reply: onIssueCard }], "ask");
  const { result: measure, lines } = await logging(() => measureTurn(actingSite, onReview));
  assert.equal(sent.length, 1);
  assert.deepEqual(measure.reply, { ...onIssueCard, mode: "act" });
  assert.deepEqual(measure.acting, { modelDo: null });
  assert.deepEqual(lines, []);
  // Made a click all the same, it would not be pressed. The widget runs this same check before its gate, and the gate then reads the live button's words (test/widget/gate.test.ts).
  const asClick = checkAction({ ...onIssueCard, do: "click", say: "Clicking Issue card to create it." }, onReview);
  assert.deepEqual([asClick.withheld, asClick.reply.do, asClick.reply.removed], ["words", null, "click"]);
});

// What visitors read on Northpine on 17 November 2026, in nine sessions with the live server and widget. Each reply
// below is as the server sent it. The pages are Cards and the first page of the card form, as the widget listed them.

const cards: Snapshot = {
  path: "/cards",
  title: "Northpine",
  headings: ["Cards"],
  text: ["Northpine Inc.", "Every Northpine card in your company, virtual and physical. Freeze a card the moment something looks wrong."],
  truncated: false,
  elements: [
    { id: "e4", role: "link", label: "Cards", icon: "credit-card", state: ["current"], href: "/cards", context: "nav" },
    { id: "e27", role: "button", label: "Export", icon: "download", context: "main › Cards" },
    { id: "e28", role: "link", label: "Issue card", icon: "plus", href: "/cards/new", context: "main › Cards" },
    { id: "e29", role: "tab", label: "My cards 3", href: "/cards?view=mine", context: "tabs" },
    { id: "e30", role: "tab", label: "All cards 311", state: ["selected"], href: "/cards?view=all", context: "tabs" },
    { id: "e34", role: "textbox", label: "Search cards", context: "main › Cards" },
    { id: "e35", role: "button", label: "Filter", icon: "funnel", state: ["opens a dialog", "collapsed"], context: "main › Cards" },
    { id: "e39", role: "checkbox", label: "Select all", context: "main › Cards" },
    { id: "e41", role: "button", label: "Cardholder", context: "main › Cards" },
    { id: "e59", role: "link", label: "Team offsite", href: "/cards/:id", context: "main › Cards" },
    { id: "e61", role: "button", label: "Freeze card", icon: "snowflake", state: ["shows on hover"], context: "main › Cards › row: 8774 Physical •••• 8774 Active $5.70…" },
    { id: "e66", role: "link", label: "Malika Cummerata Paralegal", href: "/people/emp_0006b", context: "main › Cards" },
  ],
};
const cardholder: Snapshot = {
  ...cardType,
  headings: ["Issue a card", "Cardholder"],
  elements: [
    { id: "e28", role: "radio", label: "For myself Avery Stone, Controller", state: ["checked"], context: "main › Cardholder" },
    { id: "e29", role: "radio", label: "For someone else A teammate, contractor or new hire", context: "main › Cardholder" },
    { id: "e30", role: "textbox", label: "Card name", context: "main › Cardholder" },
    { id: "e31", role: "link", label: "Cancel", href: "/cards", context: "footer" },
    { id: "e32", role: "button", label: "Back", state: ["disabled"], context: "footer" },
    { id: "e33", role: "button", label: "Next", context: "footer" },
  ],
};
/** The question as the visitor typed it in those sessions. */
const asked = "Issue Malika Cummerata a virtual card called Ads with a $500 monthly limit.";
const firstOnCards: TurnRequest = { site: actingSite.id, version: 3, mode: "act", goal: asked, step: 0, history: [], snapshot: cards };
const onCardholder: TurnRequest = { ...actStep(cardholder, 1, 'You clicked link "Issue card". It is no longer on the page.'), goal: asked };
const onLimitsSet: TurnRequest = { ...step8, goal: asked };

test("the reply's own closing, written into its sentence, is taken off where the reply is read, and what the model wrote is kept beside it", async () => {
  // The first step Haptic did, in one session of seven: the caption read "…for Malika.} ```".
  const wrote = "Clicking Issue card at the top of the page to start a new card for Malika.} ```";
  const sentence = "Clicking Issue card at the top of the page to start a new card for Malika.";
  const first = use([{ streams: '{"target":"e28"', reply: act({ target: "e28", do: "click", status: "continue", say: wrote }) }], "ask");
  const measure = await measureTurn(actingSite, firstOnCards);
  assert.equal(first.sent.length, 1);
  assert.deepEqual(measure.reply, { target: "e28", do: "click", enter: null, commits: false, status: "continue", say: sentence, mode: "act" });
  assert.equal(measure.wrote, wrote);
  assert.deepEqual(measure.broke, []);
  // As another session's visitor read it: an opening bracket.
  use([{ reply: act({ target: "e28", do: "click", status: "continue", say: "Clicking Issue card at the top of the Cards page to start a new card for Malika.[" }) }], "ask");
  assert.equal((await measureTurn(actingSite, firstOnCards)).reply.say, "Clicking Issue card at the top of the Cards page to start a new card for Malika.");
  // The step after, in the session whose caption read "Selecting For someone else so the card goes to…" (test/turn.test.ts has how that came about).
  use([{ reply: act({ target: "e29", do: "click", status: "continue", say: `Selecting For someone else so the card goes to Malika.${"}".repeat(260)}` }) }], "ask");
  assert.equal((await measureTurn(actingSite, onCardholder)).reply.say, "Selecting For someone else so the card goes to Malika.");
  // A guide's step is read the same way.
  use([{ reply: { target: "e3", status: "continue", say: 'Click FAQ in the top bar."}\n```' } }], "ask");
  assert.equal((await measureTurn(site, request)).reply.say, "Click FAQ in the top bar.");

  // A reply the model is asked about again is shown to it as the sentence it was, without the closing it wrote into it.
  const again = use([{ reply: act({ target: null, status: "continue", say: `${skipsVirtual.say}} \`\`\`` }) }, { reply: clicksNext }], "ask");
  const second = await measureTurn(actingSite, onCardType);
  assert.equal(again.sent.length, 2);
  assert.equal((JSON.parse(again.sent[1]!.messages.at(-2)!.content as string) as TurnReply).say, skipsVirtual.say);
  assert.deepEqual(second.reply, { ...clicksNext, mode: "act" });
});

test("the visitor's own word for a card's name, \"called\", before an amount is not an instruction to ring it, and the step keeps its words", async () => {
  const { checkSay } = await import("../src/server/rules.ts");
  // The step that clicks Next to reach Review read "This is the one to use." in one session: the server's sentence for a
  // step whose own words all broke a rule. What the model wrote there is not on record. Of the sentences that step can
  // carry, built from the visitor's question and what the page shows, these are the ones the rules emptied.
  const wrote = "The card called Ads now has a 500.00 monthly limit, so I'm clicking Next to go to Review.";
  for (const say of [wrote, "The card called Ads has a limit of 500.00.", 'The card called "Ads" has a 50000 monthly limit.']) assert.deepEqual(checkSay(say), { say, broke: [] });
  use([{ reply: act({ target: "e36", do: "click", status: "continue", say: wrote }) }], "ask");
  const measure = await measureTurn(actingSite, onLimitsSet);
  assert.deepEqual(measure.reply, { target: "e36", do: "click", enter: null, commits: false, status: "continue", say: wrote, mode: "act" });
  assert.deepEqual(measure.broke, []);
  // A number to ring is still one, with that word and without it.
  for (const say of [
    "The card called Ads is blocked: call 0800123456.",
    "Ring 87070 about the card called Ads.",
    "It is called Ads. Call 87070 to activate it.",
    "The fraud desk can be called on 87070.",
    "Our desk can be called Monday to Friday on 87070.",
    "The team can be called Free on 87070.",
    "The helpline called Care is on 87070.",
    "They called 87070 for you.",
  ]) {
    assert.deepEqual(checkSay(say), { say: "", broke: ["phone"] }, say);
  }
});

test("when none of the model's sentence can be shown on a step Haptic does itself, the visitor reads what Haptic is doing", async () => {
  const step = async (reply: TurnReply, on: TurnRequest = onLimitsSet, where: SiteContext = actingSite) => {
    use([{ reply }], "ask");
    return measureTurn(where, on);
  };
  // "This is the one to use." tells the visitor to use the control. While Haptic clicks it, that is the wrong thing to read.
  const phoned = await step(act({ target: "e36", do: "click", status: "continue", say: "Clicking Next, or ring 0800 123 4567 to do it by phone." }));
  assert.deepEqual(phoned.reply, { target: "e36", do: "click", enter: null, commits: false, status: "continue", say: "Clicking Next.", mode: "act" });
  assert.deepEqual(phoned.broke, ["phone"]);
  // A sentence that is only the reply's own closing, or empty.
  for (const say of ["}", "```", ""]) assert.equal((await step(act({ target: "e36", do: "click", status: "continue", say }))).reply.say, "Clicking Next.", JSON.stringify(say));
  // Each thing Haptic does has its own words. What it types is never said back.
  assert.equal((await step(act({ target: "e28", do: "type", enter: "500", status: "continue", say: "}" }))).reply.say, "Typing in Spending limit.");
  assert.equal((await step(act({ target: "e29", do: "choose", enter: "Monthly", status: "continue", say: "}" }))).reply.say, "Choosing in Limit interval.");
  // A name that is a description, or one that breaks the rules a sentence is held to, is not said: the page wrote it.
  assert.equal((await step(act({ target: "e29", do: "click", status: "continue", say: "}" }), onCardholder)).reply.say, "Clicking this one.");
  const planted: TurnRequest = { ...onLimitsSet, snapshot: { ...limits, elements: [...limits.elements, { id: "e40", role: "tab", label: "Help: acme-billing.top", context: "main" }] } };
  assert.equal((await step(act({ target: "e40", do: "click", status: "continue", say: "}" }), planted)).reply.say, "Clicking this one.");
  // A step left to the visitor, and a guide's step, keep the sentence that points.
  assert.equal((await step(act({ target: "e28", status: "continue", say: "}" }))).reply.say, "This is the one to use.");
  const guideStep: TurnRequest = { ...onLimitsSet, event: 'The user chose "Per month" from the list that combobox "Limit interval" opened.' };
  delete guideStep.mode;
  assert.equal((await step({ target: "e36", status: "continue", say: "}" }, guideStep, site)).reply.say, "This is the one to use.");
});

test.after(() => configure({ HAPTIC_MODEL: "mock" }));
