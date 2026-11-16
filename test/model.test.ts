import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { namedButNotPointed } from "../src/server/check.ts";
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

test.after(() => configure({ HAPTIC_MODEL: "mock" }));
