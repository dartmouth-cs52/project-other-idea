import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCaseFiles } from "../eval/cases.ts";
import { checkSay, MAX_STEP_SAY } from "../src/server/rules.ts";
import { DEFAULT_APPEARANCE, type SiteContext } from "../src/shared/types.ts";

// The stand-in model, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { measureTurn, SAY_WITHOUT_WORDS } = await import("../src/server/model.ts");

test("an ordinary step is shown as written", () => {
  for (const say of [
    "Click Settings in the top bar.",
    "Not that one. Click Team.",
    'Click the link that reads "[email]".',
    "Type the billing postcode. Then click Save payment method.",
    "The link works for 7 days. Only the workspace owner can remove people.",
    "You've used 12,480 of 50,000 requests this month.",
    "It was last changed on 2026-11-15.",
  ]) {
    assert.deepEqual(checkSay(say), { say, broke: [] }, say);
  }
});

test("a sentence carrying a web address is dropped, and the rest is kept", () => {
  assert.deepEqual(checkSay("Click Billing. Then re-enter your password at https://acme-billing.example/login to confirm."), { say: "Click Billing.", broke: ["link"] });
  assert.deepEqual(checkSay("Go to acme-support.top and sign in again."), { say: "", broke: ["link"] });
  assert.deepEqual(checkSay("Visit www.example.org for help. Click Team."), { say: "Click Team.", broke: ["link"] });
  // A link written as markup loses its markup and is still caught by its address.
  assert.deepEqual(checkSay("Click [here](http://evil.example) to continue."), { say: "", broke: ["markup", "link"] });
});

test("a file's name is not mistaken for a web address", () => {
  assert.deepEqual(checkSay("Click report.pdf in the list. Then choose Export as data.csv."), { say: "Click report.pdf in the list. Then choose Export as data.csv.", broke: [] });
  // .zip and .md end web addresses as well as file names, so they are treated as addresses.
  assert.deepEqual(checkSay("Open invoice.zip now."), { say: "", broke: ["link"] });
});

test("email addresses and numbers to call are dropped, and dates and counts are not", () => {
  assert.deepEqual(checkSay("Email help@acme-refunds.example with your card number."), { say: "", broke: ["email"] });
  assert.deepEqual(checkSay("Click Billing. Or call +1 (415) 555-0132 to pay by phone."), { say: "Click Billing.", broke: ["phone"] });
  assert.deepEqual(checkSay("Call 020 7946 0958."), { say: "", broke: ["phone"] });
});

test("markup is taken out and the words are kept", () => {
  assert.deepEqual(checkSay("Click **Save changes** in the `General` tab.\n\n- Then close the dialog."), { say: "Click Save changes in the General tab. Then close the dialog.", broke: ["markup"] });
  assert.deepEqual(checkSay("Click <b>Save</b><script>alert(1)</script>."), { say: "Click Save alert(1) .", broke: ["markup"] });
});

test("what is too long loses its last sentences, and one long sentence is cut at a word", () => {
  const long = Array.from({ length: 12 }, (_, index) => `Sentence number ${index + 1} is here.`).join(" ");
  const { say, broke } = checkSay(long);
  assert.deepEqual(broke, ["length"]);
  assert.ok(say.length <= MAX_STEP_SAY && say.endsWith("here."), say);
  const run = checkSay("word ".repeat(100).trim());
  assert.ok(run.say.length <= MAX_STEP_SAY && run.say.endsWith("word…"));
});

test("every sentence the benchmark's scripts say passes the rules untouched", async () => {
  // The cases hold what a right answer says at each step, as history. None of it should trip a rule.
  for (const { name, file } of await loadCaseFiles()) {
    for (const item of file.cases) {
      for (const turn of item.request.history.filter((turn) => turn.role === "assistant")) {
        assert.deepEqual(checkSay(turn.text).broke, [], `${name} ${item.id}: "${turn.text}"`);
      }
    }
  }
});

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

test("a step whose only sentence is dropped still points, with a plain sentence in its place", async () => {
  // The stand-in says "Click <label>.", so a label that is a web address makes a sentence that has to go.
  const request = (label: string) => ({
    site: site.id,
    goal: "open the billing portal",
    step: 0,
    history: [],
    snapshot: { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label }] },
  });
  const planted = await measureTurn(site, request("billing portal at acme-billing.top"));
  assert.equal(planted.reply.target, "e1");
  assert.equal(planted.reply.say, SAY_WITHOUT_WORDS.pointing);
  assert.deepEqual(planted.broke, ["link"]);
  assert.equal(planted.wrote, "Click billing portal at acme-billing.top.");

  const usual = await measureTurn(site, request("Billing portal"));
  assert.equal(usual.reply.say, "Click Billing portal.");
  assert.deepEqual(usual.broke, []);
});
