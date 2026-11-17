import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSuggestions, SuggestionsRefused, suggestionsProblem, usableSuggestions } from "../src/shared/suggestions.ts";
import { DEFAULT_APPEARANCE, type PublicSiteConfig, type SiteContext } from "../src/shared/types.ts";

// The questions a company suggests above the ask box: how a list is checked
// and cleaned when it is saved, and what the server tells the widget.

process.env.HAPTIC_MODEL = "mock";
const { createApp } = await import("../src/server/app.ts");
const { Store } = await import("../src/server/db.ts");

/** The sentence and the position of what `checkSuggestions` refuses. */
function refusal(input: unknown): { message: string; index?: number } {
  try {
    checkSuggestions(input);
  } catch (error) {
    assert.ok(error instanceof SuggestionsRefused, `refused with ${error}`);
    return { message: error.message, ...(error.index === undefined ? {} : { index: error.index }) };
  }
  assert.fail(`${JSON.stringify(input)} was not refused`);
}

test("each suggestion is trimmed, a blank one is left out, and Do it is kept only when it is on", () => {
  assert.deepEqual(
    checkSuggestions([
      { text: "  Lock my Team offsite card  " },
      { text: "", act: true },
      { text: "Who approves   meals over $150?", act: false },
      { text: "\tIssue Malika a $500 virtual card\n", act: true },
    ]),
    [{ text: "Lock my Team offsite card" }, { text: "Who approves meals over $150?" }, { text: "Issue Malika a $500 virtual card", act: true }],
  );
  assert.deepEqual(checkSuggestions(undefined), []);
  assert.deepEqual(checkSuggestions(null), []);
  assert.deepEqual(checkSuggestions([]), []);
  assert.deepEqual(checkSuggestions([{ text: "   " }, { text: "" }, { text: "" }]), []);
});

test("more than three are refused, and blank fields do not count", () => {
  assert.deepEqual(refusal([{ text: "One" }, { text: "Two" }, { text: "Three" }, { text: "Four" }]), { message: "A site can have up to 3 suggested questions.", index: 3 });
  assert.equal(checkSuggestions([{ text: "One" }, { text: " " }, { text: "Two" }, { text: "" }, { text: "Three" }]).length, 3);
});

test("a suggestion is 60 characters at most, counted after trimming", () => {
  const sixty = "x".repeat(60);
  assert.deepEqual(checkSuggestions([{ text: `   ${sixty}   ` }]), [{ text: sixty }]);
  assert.deepEqual(refusal([{ text: "Fine" }, { text: `${sixty}y` }]), { message: "Keep a suggested question to 60 characters. This one has 61.", index: 1 });
});

test("a suggestion is one line: a line break of any kind inside it is refused", () => {
  for (const brk of ["\n", "\r\n", "\r", "\u2028", "\u2029", "\v", "\f", "\u0085"]) {
    assert.deepEqual(refusal([{ text: `Lock my${brk}card` }]), { message: "Keep a suggested question to one line.", index: 0 }, JSON.stringify(brk));
  }
  assert.deepEqual(refusal([{ text: "Lock\u0000 my card" }]), { message: "Take out the character that can't be shown.", index: 0 });
});

test("a list of the wrong shape, words that are not text, a Do it that is not on or off, and a repeat are refused", () => {
  assert.deepEqual(refusal("Lock my card"), { message: "Suggested questions must be a list." });
  assert.deepEqual(refusal({ text: "Lock my card" }), { message: "Suggested questions must be a list." });
  assert.equal(refusal(["Lock my card"]).index, 0);
  assert.equal(refusal([{ text: "One" }, { text: 7 }]).index, 1);
  assert.equal(refusal([{ text: "One" }, null]).index, 1);
  assert.deepEqual(refusal([{ text: "One", act: "yes" }]), { message: "Haptic does it is either on or off.", index: 0 });
  assert.deepEqual(refusal([{ text: "Lock my card" }, { text: " lock my  CARD " }]), { message: "This is the same as another suggested question.", index: 1 });
});

test("the CLI and publishing are told what is wrong, and with which one", () => {
  assert.equal(suggestionsProblem(undefined), undefined);
  assert.equal(suggestionsProblem([{ text: "Lock my card" }]), undefined);
  assert.equal(suggestionsProblem([{ text: "Lock my card" }, { text: "a\nb" }]), "Suggested question 2: Keep a suggested question to one line.");
  assert.equal(suggestionsProblem("nope"), "Suggested questions must be a list.");
});

test("what is shown of a stored list: what passes, the first three, and Do it only while acting is on", () => {
  const stored = [{ text: "One", act: true }, { text: "Two\nlines" }, { text: "" }, "Three", { text: "one" }, { text: " Four " }, { text: "Five" }, { text: "Six" }];
  assert.deepEqual(usableSuggestions(stored), [{ text: "One", act: true }, { text: "Four" }, { text: "Five" }]);
  assert.deepEqual(usableSuggestions(stored, false), [{ text: "One" }, { text: "Four" }, { text: "Five" }]);
  assert.deepEqual(usableSuggestions(undefined), []);
  assert.deepEqual(usableSuggestions({ text: "One" }), []);
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

/** The public settings the widget is sent for this site. */
async function configOf(served: SiteContext): Promise<PublicSiteConfig> {
  const app = createApp({ loadSite: async (id) => (id === served.id ? served : undefined), widget: async () => "", widgetMaxAge: 0, overLimit: () => false });
  const response = await app(new Request(`https://widget.test/v1/sites/${served.id}`, { headers: { Origin: "https://app.test" } }), "1.1.1.1");
  assert.equal(response?.status, 200);
  return (await response!.json()) as PublicSiteConfig;
}

test("the widget is sent the site's suggestions, with Do it only where the site has acting on", async () => {
  const suggestions = [{ text: "Lock my Team offsite card" }, { text: "Who approves meals over $150?" }, { text: "Issue Malika a $500 virtual card", act: true }];
  assert.deepEqual((await configOf({ ...site, suggestions })).suggestions, [{ text: "Lock my Team offsite card" }, { text: "Who approves meals over $150?" }, { text: "Issue Malika a $500 virtual card" }]);
  assert.deepEqual((await configOf({ ...site, suggestions, acting: { enabled: true } })).suggestions, suggestions);
  assert.deepEqual((await configOf({ ...site, suggestions, acting: { enabled: false } })).suggestions?.[2], { text: "Issue Malika a $500 virtual card" });
  // A list edited by hand into a shape the check refuses shows what passes, and never more than three.
  const edited = [{ text: "One\ntwo" }, { text: "Fine" }, { text: "x".repeat(61) }];
  assert.deepEqual((await configOf({ ...site, suggestions: edited as SiteContext["suggestions"] })).suggestions, [{ text: "Fine" }]);
});

test("a site with no suggestions, or none that can be shown, is sent the settings it was always sent", async () => {
  const before = await configOf(site);
  assert.equal("suggestions" in before, false);
  assert.deepEqual(await configOf({ ...site, suggestions: [] }), before);
  assert.deepEqual(await configOf({ ...site, suggestions: [{ text: "  " }] }), before);
  // Switched off, the widget draws nothing, so it is told nothing about them.
  assert.equal("suggestions" in (await configOf({ ...site, off: true, suggestions: [{ text: "Lock my card" }] })), false);
});

test("publishing cleans a site's suggestions, keeps the dashboard's when the file has none, and refuses ones that break the rules", async () => {
  const sent: { text: string; values: unknown[] }[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    sent.push({ text: strings.join("?").replace(/\s+/g, " "), values });
    return Promise.resolve([]);
  };
  const store = new Store(sql as unknown as ConstructorParameters<typeof Store>[0]);
  await store.saveSite({ ...site, suggestions: [{ text: "  Lock my card ", act: true }, { text: "" }] });
  const saved = JSON.parse(String(sent[0]!.values.find((value) => typeof value === "string" && value.startsWith("{")))) as SiteContext;
  assert.deepEqual(saved.suggestions, [{ text: "Lock my card", act: true }]);
  assert.match(sent[0]!.text, /'suggestions', sites\.context->'suggestions'\)\) \|\| excluded\.context/);
  await assert.rejects(store.saveSite({ ...site, suggestions: [{ text: "a\nb" }] }), SuggestionsRefused);
  assert.equal(sent.length, 1, "nothing is written for a list that is refused");
});
