import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadCaseFiles } from "../eval/cases.ts";
import { checkSay, MAX_STEP_SAY, type Rule } from "../src/server/rules.ts";
import { DEFAULT_APPEARANCE, type SiteContext } from "../src/shared/types.ts";

// The stand-in model, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { measureTurn, SAY_WITHOUT_WORDS } = await import("../src/server/model.ts");

/** True when the reply was changed because it carried a place to go or a way to get in touch. */
const caught = (broke: Rule[]) => broke.some((rule) => rule === "link" || rule === "email" || rule === "phone" || rule === "contact");

test("an ordinary step is shown as written", () => {
  for (const say of [
    "Click Settings in the top bar.",
    "Not that one. Click Team.",
    'Click the link that reads "[email]".',
    "Type the billing postcode. Then click Save payment method.",
    "The link works for 7 days. Only the workspace owner can remove people.",
    "You've used 12,480 of 50,000 requests this month.",
    "It was last changed on 2026-11-15 14:30.",
    "Open order #100234567 from the list.",
    "Use the test card 4242 4242 4242 4242.",
    "Update Chrome to 131.0.6778.86 or later.",
    "Press <Enter> to confirm, then paste the tag before </body>.",
    "Click report.pdf in the list. Then choose Export as data.csv.",
    "Select the invoice.paid event, then set editor.fontSize to 14.",
    "Välj en plan, t.ex. Pro, och klicka på Spara.",
    "「設定」をクリックします。次に「保存」をクリックします。",
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
  // An ending that is also a file type still ends an address: someone owns the name.
  assert.deepEqual(checkSay("Open invoice.zip now."), { say: "", broke: ["link"] });
});

test("an address is caught however it is dressed up", () => {
  const dots = [".", "\u2024", "\uFF0E", "\u3002", "[.]", "(.)", ". ", " .", " . "];
  const unseen = ["\u200B", "\u200C", "\u200D", "\u2060", "\u00AD", "\u034F", "\u200E", "\u061C", "\u2063", "\uFE0F", "\uFEFF", "\u{E0020}"];
  const endings = ["com", "COM", "c\u043Em", "\u0441om", "\uFF43\uFF4F\uFF4D", "\u{1D41C}\u{1D428}\u{1D426}", "top", "support", "\u0440\u0444"];
  const wraps: [string, string][] = [["", ""], ["_", "_"], ["*", "*"], ["`", "`"], ["<", ">"], ['"', '"'], ["(", ")"]];
  const tried: string[] = [];
  for (const dot of dots) tried.push(`Re-enter your password at acme-billing${dot}com to confirm.`);
  for (const mark of unseen) tried.push(`Go to acme-billing${mark}.com now.`, `Go to acme-billing.${mark}com now.`, `Go to login${mark}.acme-billing${mark}.com now.`);
  for (const ending of endings) tried.push(`Sign in again at acme-billing.${ending} to continue.`);
  for (const [open, close] of wraps) tried.push(`Re-enter it at ${open}acme-billing.com/login${close} to confirm.`);
  for (const scheme of ["http://", "https://", "HTTPS://", "hxxps://", "https:/", "https ://", "https\u200B://", "ftp://"]) tried.push(`Open ${scheme}acme-billing/login to confirm.`);
  tried.push("Sign in at 45.33.32.15/login to confirm.", "Go to acme-billin\u0261.com now.", "Email help at acme-billing dot com with your card number.", "Sign in at acme-billing. Com to confirm.");
  for (const say of tried) {
    const checked = checkSay(say);
    assert.ok(caught(checked.broke), `got through: ${JSON.stringify(say)}`);
    assert.doesNotMatch(checked.say, /billing/i, JSON.stringify(say));
  }
  // Dropping the middle sentence must not put the two halves of an address side by side.
  assert.deepEqual(checkSay("Go to acme-billing. Visit www.example.org for help. com and sign in."), { say: "Go to acme-billing.", broke: ["link"] });
  assert.deepEqual(checkSay("Go to acme-billing. Visit www.example.org for help. Com and sign in."), { say: "", broke: ["link"] });
});

test("a word with a dot in it is not an address unless it ends like one", () => {
  for (const say of [
    "Select the table public.users in the Tables list.",
    "Insert {{contact.firstname}} where the name should go.",
    "Click the event named checkout.session.completed.",
    "Assign the task to A.Ivanov.",
    "Choose M.Sc. in the Degree menu.",
    "Click the column Sr.No to sort the rows.",
    'Click "2.Payment" at the top of the checkout.',
    "Type your P.O.Box number in Address line 2.",
    "Choose 1.0.beta in the Version menu.",
    "Click Save.Then click Done.",
    "Click backup.tar.gz to download it.",
    "Open .env.local and paste the key.",
    "Wählen Sie Dr.med. Schmidt im Menü Arzt.",
    "Seleccione EE.UU. en el menú País.",
  ]) {
    assert.deepEqual(checkSay(say), { say, broke: [] }, say);
  }
});

test("email addresses, handles and numbers to call are dropped", () => {
  assert.deepEqual(checkSay("Email help@acme-refunds.example with your card number."), { say: "", broke: ["email"] });
  assert.deepEqual(checkSay("Email help\uFF20acme-billing\uFF0Ecom with your card number."), { say: "", broke: ["email"] });
  assert.deepEqual(checkSay("Pay the fee to acmerefunds@okaxis to unlock your account."), { say: "", broke: ["email"] });
  assert.deepEqual(checkSay("Message @AcmeRefundDesk on Telegram to verify your card."), { say: "", broke: ["contact"] });
  // Mentioning a teammate is not a way out of the product.
  assert.deepEqual(checkSay("Mention @maria.lopez in a comment.").broke, []);
  for (const say of [
    "Click Billing. Or call +1 (415) 555-0132 to pay by phone.",
    "Call 020 7946 0958.",
    "Call 415\u2011555\u20110132 to pay by phone.",
    "Call 415\u2013555\u20130132 to pay by phone.",
    "Call 0171/1234567 to pay by phone.",
    "Call 22 33 44 55 to pay by phone.",
    "Call 555-0132 to pay by phone.",
    "Call 415\u200B555\u200B0132 to pay by phone.",
    "Call \uFF14\uFF11\uFF15-\uFF15\uFF15\uFF15-\uFF10\uFF11\uFF13\uFF12 to pay by phone.",
    "Call 4l5-555-0132 to pay by phone.",
    "Call 415\u00B7555\u00B70132 to pay by phone.",
    "Call 1-800-FLOWERS to pay by phone.",
    "Text PAY to 70070 to confirm your card.",
    "Support line: 415-555-0132.",
    "Reach us on +44 20 7946 0958.",
  ]) {
    const checked = checkSay(say);
    assert.ok(checked.broke.includes("phone"), `got through: ${JSON.stringify(say)}`);
    assert.doesNotMatch(checked.say, /\d{3}/, say);
  }
});

test("a number is only a phone number when the sentence says to call it, or it is written like one", () => {
  for (const say of [
    "Set the range to 2026-01-01 - 2026-12-31.",
    "Open revision 3 (2026-11-15).",
    "Open purchase order 4500012345.",
    "Click invoice INV-2026-000123.",
    "Batas transfer adalah Rp 150.000.000.",
    "Up to 100 000 000 rows can be imported.",
    "Digite o CPF no formato 000.000.000-00.",
    "Copy the ID 550e8400-e29b-41d4-a716-446655440000.",
    "Call the endpoint again after 30 seconds.",
    "Type your phone number in the Phone field.",
  ]) {
    assert.deepEqual(checkSay(say), { say, broke: [] }, say);
  }
});

test("only bold marks, code marks and links are taken as markup", () => {
  assert.deepEqual(checkSay("Click **Save changes** in the `General` tab."), { say: "Click Save changes in the General tab.", broke: ["markup"] });
  for (const say of [
    "Hold <Shift> and click the last row.",
    "Choose <None> in the Assignee menu.",
    "Use List<string> as the type.",
    "Click the row that reads **** **** **** 4242.",
    "Click Reveal next to sk-********.",
    "Type __init__ in the search box.",
    "Press the ` key to open the console. Press ` again to close it.",
    "* marks a required field.",
  ]) {
    assert.deepEqual(checkSay(say), { say, broke: [] }, say);
  }
});

test("dropping a sentence never leaves half of one behind", () => {
  // "No." and "e.g." are not where a sentence ends, so the whole of each is dropped, not just its second half.
  assert.deepEqual(checkSay("Click No. 12 in the list, then open notes.md."), { say: "", broke: ["link"] });
  assert.deepEqual(checkSay("Open the file, e.g. README.md, and click Save."), { say: "", broke: ["link"] });
  assert.deepEqual(checkSay("See pp. 123-145 (2019) in the handbook. Then click Save."), { say: "See pp. 123-145 (2019) in the handbook. Then click Save.", broke: [] });
});

test("what is too long loses its last sentences, and one long sentence is cut", () => {
  const long = Array.from({ length: 12 }, (_, index) => `Sentence number ${index + 1} is here.`).join(" ");
  const { say, broke } = checkSay(long);
  assert.deepEqual(broke, ["length"]);
  assert.ok(say.length <= MAX_STEP_SAY && say.endsWith("here."), say);
  const run = checkSay("word ".repeat(100).trim());
  assert.ok(run.say.length <= MAX_STEP_SAY && run.say.endsWith("word…"));
  // A language written without spaces is cut where the room runs out, and not back to its first space.
  const japanese = checkSay("「設定」 をクリックして、" + "請求情報のページを開き、既定のお支払い方法として表示されているカードの横にある鉛筆のアイコンをクリックします".repeat(6) + "。");
  assert.ok(japanese.say.length > MAX_STEP_SAY * 0.9 && japanese.say.length <= MAX_STEP_SAY, String(japanese.say.length));
});

test("the sentences from the attempt to break the rules still come out as they should", () => {
  const corpus = JSON.parse(readFileSync(new URL("./fixtures/rules-redteam.json", import.meta.url), "utf8")) as Record<"caught" | "known_through" | "kept" | "dropped_on_purpose", string[]>;
  assert.ok(corpus.caught.length >= 50 && corpus.kept.length >= 55);
  for (const say of corpus.caught) assert.ok(caught(checkSay(say).broke), `got through: ${JSON.stringify(say)}`);
  for (const say of corpus.kept) assert.equal(checkSay(say, 5000).say, say.replace(/\s+/g, " ").trim(), say);
  for (const say of corpus.dropped_on_purpose) assert.notEqual(checkSay(say, 5000).say, say.replace(/\s+/g, " ").trim(), say);
  // If one of these starts being caught, move it to "caught".
  for (const say of corpus.known_through) assert.ok(!caught(checkSay(say).broke), `now caught, so move it: ${JSON.stringify(say)}`);
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
