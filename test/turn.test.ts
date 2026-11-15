import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt, buildUserMessage } from "../src/server/prompt.ts";
import { DEFAULT_APPEARANCE, type SiteContext, type SnapElement, type TurnRequest } from "../src/shared/types.ts";

// These use the stand-in model, so they run with no API key. The model is
// chosen when model.ts loads, so the setting has to come before the import.
process.env.HAPTIC_MODEL = "mock";
const { runTurn } = await import("../src/server/model.ts");

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

const elements: SnapElement[] = [
  { id: "e1", role: "link", label: "Billing" },
  { id: "e2", role: "link", label: "Team" },
  { id: "e3", role: "button", label: "Update card" },
];

function request(event: string): TurnRequest {
  return {
    site: site.id,
    goal: "update my billing card",
    step: 1,
    history: [
      { role: "user", text: "update my billing card" },
      { role: "assistant", text: "Click Billing." },
    ],
    event,
    snapshot: { path: "/", title: "Home", headings: [], text: [], elements, truncated: false },
  };
}

test("a wrong click is called out, and the pointer goes back to the control it meant", async () => {
  const reply = await runTurn(site, request('The user clicked "Team" instead of link "Billing".'));
  assert.equal(reply.target, "e1");
  assert.equal(reply.say, "Not that one. Click Billing.");
});

test("leaving the page without using the control is called out too", async () => {
  const reply = await runTurn(site, request('The user went to /team without using link "Billing".'));
  assert.equal(reply.say, "Not that one. Click Billing.");
});

test("a click on the control it pointed at is not called out", async () => {
  const reply = await runTurn(site, request('The user clicked link "Billing".'));
  assert.equal(reply.target, "e3");
  assert.equal(reply.say, "Click Update card.");
});

test("the model is told to say so when a click goes off the way", () => {
  assert.match(buildSystemPrompt(site), /start "say" with "Not that one\."/);
});

// What the model is told. No model can be asked here, so these check that each
// rule is in the prompt, and name the failure that was seen and that it answers.

const rules = buildSystemPrompt(site);

test("the model is told it sees the page after the last click too (jira 13 of 13: 'done' while pointing at a control nobody had used yet)", () => {
  assert.match(rules, /You see the page again after every click, including the last/);
  assert.match(rules, /a control the visitor still has to use is "continue", never "done"/);
  assert.match(rules, /"say" must not describe as done what a click has not yet done/);
});

test("the model is told to point at nothing more once the goal is reached (10 single steps, and 28 of 177 finished guides, pointed at an extra)", () => {
  assert.match(rules, /the goal is complete: reply "done" with target null, and never point at an optional extra/);
});

test("the model is told to say what to type and stop (jira and ui5: 'type it, then press Enter', which on Jira sends a signed-out visitor to sign in)", () => {
  assert.match(rules, /For a text field, say what to type and stop there, without "then press Enter": you're asked again when they pause\./);
  assert.match(rules, /point at what comes next, usually the search, save or submit button\. Ask for Enter only if no button does it\./);
});

test("the model is told what a step with nothing to point at means (ui5 and grafana: 'Press Enter' with no target ended the guide)", () => {
  assert.match(rules, /"continue" with target null means "do this, I'm watching": use it only when the step has nothing that can be pointed at, like pressing a key\./);
});

test("the model is told today's date, outside the part of the prompt that is kept (parabank: asked about October, it offered 2024)", () => {
  const first = { ...request(""), step: 0, history: [] };
  delete (first as { event?: string }).event;
  const serverClock = new Date("2026-11-15T23:30:00Z");
  // The visitor's own date when the widget sent one. Here it is already Monday where they are.
  const theirs = buildUserMessage({ ...first, today: "2026-11-16" }, serverClock);
  assert.match(theirs, /<\/page>\n\nToday is Monday 16 November 2026\.\n\nThe visitor asks: update my billing card$/);
  // The server's date otherwise, and when what was sent is not a date.
  assert.match(buildUserMessage(first, serverClock), /\n\nToday is Sunday 15 November 2026\.\n\n/);
  assert.match(buildUserMessage({ ...first, today: "soon" }, serverClock), /\n\nToday is Sunday 15 November 2026\.\n\n/);
  // Later questions carry it too, before what has happened so far.
  assert.match(buildUserMessage({ ...request('The user clicked link "Billing".'), today: "2026-11-16" }, serverClock), /<\/page>\n\nToday is Monday 16 November 2026\.\n\n<progress>/);
  // The rules and the site's knowledge are cached for every question on a site. A date there would throw the cache away each midnight.
  assert.doesNotMatch(rules, /Today is|20\d\d/);
});

test("the model is told not to answer what has nothing to do with the site (asked the capital of France it said Paris, and asked 17 times 23 it said 391, before declining)", () => {
  assert.match(rules, /You help with this website and what is on it, and with nothing else\./);
  assert.match(rules, /do not answer it, not even in passing: reply "done" with target null and say only that you can help with finding things on Test\./);
  // A real question asked badly must not be turned away: those pass 10 of 10 today.
  assert.match(rules, /A question that is vague, misspelled or in another language is still about the site unless it plainly is not\./);
  // It is part of who the guide is, so it comes before how a reply is shaped.
  assert.ok(rules.indexOf("with nothing else") < rules.indexOf("Each reply is one step"));
  // "The question only needed an explanation" read as leave to explain anything.
  assert.match(rules, /a question about the site only needed an explanation/);
  // The site's name is put in wherever it is used, exactly as its owner wrote it.
  const named = buildSystemPrompt({ ...site, name: "Cash $& Carry" });
  assert.match(named, /^You are Haptic, a guide built into Cash \$& Carry\./);
  assert.match(named, /finding things on Cash \$& Carry\./);
  assert.doesNotMatch(named, /\{site_name\}/);
  assert.match(buildSystemPrompt({ ...site, name: "" }), /finding things on this website\./);
});

test("the model is told to go where an action's options are when the visitor wants it done a particular way (grafana: asked for a link that keeps a relative time range, it pointed at Copy link)", () => {
  assert.match(rules, /When the visitor wants something done a particular way, like an export in a certain format or a link with certain settings, point at what opens that action's options, not at a button that does it in one click\./);
});

test("the model is told to state only what it was shown (grafana: 'the link will keep showing the last hour', and 'the list is now filtered' after the page reported the filter gone)", () => {
  assert.match(rules, /State as fact only what the page or the site's own notes and docs show\./);
  assert.match(rules, /Don't say what a control will do beyond what its name says\./);
  assert.match(rules, /When what changed doesn't show that the goal was reached, say what to check, not that it worked\./);
  // It is about the sentence, so it sits with the rules for writing it.
  assert.ok(rules.indexOf("State as fact only") > rules.indexOf('Writing "say"'));
});

test("the question asked after the last step is worded as a closing one", () => {
  const at = new Date("2026-11-15T12:00:00Z");
  const closing = buildUserMessage({ ...request('The user clicked link "Billing".'), closing: true }, at);
  const plain = buildUserMessage(request('The user clicked link "Billing".'), at);
  const NEXT = 'Give the next step, or confirm in one sentence with status "done" if the goal is complete.';
  assert.ok(plain.endsWith(NEXT));
  assert.ok(!closing.includes(NEXT));
  const wording = closing.slice(closing.lastIndexOf("</progress>") + "</progress>".length).trim();
  assert.match(wording, /^The visitor has done what you called the last step\./);
  assert.match(wording, /If what they asked for now shows, reply "done" with target null and say in one sentence what shows\./);
  assert.match(wording, /If the answer is a place on this page, you may point at it with "done"\./);
  assert.match(wording, /If the goal still needs a control, point at it with "continue"\./);
  assert.match(wording, /Never point at an optional extra\.$/);
  // No button is named as an example: the model would take it for the thing to look for.
  assert.doesNotMatch(wording, /save|submit|apply/i);
  // Everything before the wording is the same question.
  assert.equal(closing.slice(0, closing.lastIndexOf("</progress>")), plain.slice(0, plain.lastIndexOf("</progress>")));
  // A first question is never a closing one, whatever it is marked as.
  const first = { ...request(""), step: 0, history: [], closing: true as const };
  delete (first as { event?: string }).event;
  assert.ok(buildUserMessage(first).endsWith("The visitor asks: update my billing card"));
});

test("what the visitor reads is tidied, whatever the model wrote", async () => {
  const { tidySay } = await import("../src/server/model.ts");
  assert.equal(tidySay("Now fill in your Company name.}"), "Now fill in your Company name.");
  assert.equal(tidySay("Type your last name.\n\n"), "Type your last name.");
  assert.equal(tidySay("Click Component to switch the kind.</br>"), "Click Component to switch the kind.");
  assert.equal(tidySay("  Click Save.\n}\n"), "Click Save.");
  // A sentence that is already clean is left alone, brackets inside it included.
  assert.equal(tidySay('Click the link that reads "[email]".'), 'Click the link that reads "[email]".');
});

// Every sentence below is one the live model wrote during the whole-guide runs
// of 15 November 2026, character for character. About one in thirty carried
// something a visitor should not be shown.
const SEEN: [what: string, wrote: string, shown: string][] = [
  [
    "a line-break tag at the end",
    "Click Find Transactions in the left menu. There you can pick account 13344 and search by date range for October.</br>",
    "Click Find Transactions in the left menu. There you can pick account 13344 and search by date range for October.",
  ],
  [
    "the other spelling of the tag",
    "The list hasn't shown a Time series graphs result yet. If it doesn't appear, check that the search text is right. Otherwise, open a dashboard from the list, like Performance Testing (k6), to look for it.<br>",
    "The list hasn't shown a Time series graphs result yet. If it doesn't appear, check that the search text is right. Otherwise, open a dashboard from the list, like Performance Testing (k6), to look for it.",
  ],
  [
    "a tag between two sentences",
    "Type your teammate's email address in the Email address box.</br>Then press Send invite.</br>",
    "Type your teammate's email address in the Email address box. Then press Send invite.",
  ],
  [
    "a closing brace, a tag and a double space",
    "Type the starter's surname in Last Name.  Then you can click Save.}</br>",
    "Type the starter's surname in Last Name. Then you can click Save.",
  ],
  [
    "the end of the reply's own structure, written with the wrong quote mark",
    "Click the More actions button next to the component name to look for an option to unregister this entity.»}</br>",
    "Click the More actions button next to the component name to look for an option to unregister this entity.",
  ],
  [
    "the same after a sentence with quote marks of its own",
    'Click the Search Wikipedia box and type "Melting points of the elements (data page)", then press Enter. That page lists every element and can be sorted by melting point, lowest first.»}</br>',
    'Click the Search Wikipedia box and type "Melting points of the elements (data page)", then press Enter. That page lists every element and can be sorted by melting point, lowest first.',
  ],
  [
    "the same with a curly quote mark",
    "Your name is filled in, so click Next to go on to the Choose a location step.”}</br>",
    "Your name is filled in, so click Next to go on to the Choose a location step.",
  ],
  [
    "a quote mark and a scrap of code, a character with no width, and double spaces",
    "The docs are still loading, so use the Search docs box here and type Mermaid to find the diagrams page.  If the side navigation appears, you can pick it there instead.  \u200CClick Search docs to start.”.replace",
    "The docs are still loading, so use the Search docs box here and type Mermaid to find the diagrams page. If the side navigation appears, you can pick it there instead. Click Search docs to start.",
  ],
  [
    "a stray word stuck to the full stop",
    "Click the datacenter dropdown at the top of the dashboard, then choose B from the list.markdown",
    "Click the datacenter dropdown at the top of the dashboard, then choose B from the list.",
  ],
  [
    "a quote mark that closes nothing",
    'Click the "All series selected" button next to B-series in the Simple graph legend to show only that line. Then I\'ll show you how to view the panel full screen."',
    'Click the "All series selected" button next to B-series in the Simple graph legend to show only that line. Then I\'ll show you how to view the panel full screen.',
  ],
  [
    "a curly one",
    "Type MLlib starter tasks in this Search box, then click the Search button next to it to find the shared filter.”",
    "Type MLlib starter tasks in this Search box, then click the Search button next to it to find the shared filter.",
  ],
  [
    "a single one, in a sentence with an apostrophe",
    "Click Configure in the Leave menu to look for leave settings. Email notification options are usually in the Admin module, so we'll check here first.'",
    "Click Configure in the Leave menu to look for leave settings. Email notification options are usually in the Admin module, so we'll check here first.",
  ],
  [
    "a space with no width at the end",
    "Click the filter menu icon next to the filter box, then pick Unregistered under User registration and experience. Turn on Live updates after that to watch edits arrive.\u200B",
    "Click the filter menu icon next to the filter box, then pick Unregistered under User registration and experience. Turn on Live updates after that to watch edits arrive.",
  ],
  [
    "a picture between two sentences, and a tag",
    "Click New in the top bar, then choose New dashboard from the menu that opens.👇 Note you may need to sign in to save.</br>",
    "Click New in the top bar, then choose New dashboard from the menu that opens. Note you may need to sign in to save.",
  ],
  [
    "a blank line inside",
    "Click the Search box and type Tortuga Restaurante to narrow the list to that customer's orders.\n\nThen press Enter.",
    "Click the Search box and type Tortuga Restaurante to narrow the list to that customer's orders. Then press Enter.",
  ],
  [
    "a line break inside",
    "Click Save to create the new starter's record.\nYou can also add a Middle Name or Employee Id first if you need to.",
    "Click Save to create the new starter's record. You can also add a Middle Name or Employee Id first if you need to.",
  ],
  [
    "two sentences with no space between them",
    "Click Enter edit mode at the top of the dashboard. Then you can remove the The Basics panel using its menu.Step 1 of getting rid of it.</br>",
    "Click Enter edit mode at the top of the dashboard. Then you can remove the The Basics panel using its menu. Step 1 of getting rid of it.",
  ],
  [
    "the same, with nothing else wrong",
    "Click the Component button to change the kind of entity listed, then choose System.Next we'll filter by owner.",
    "Click the Component button to change the kind of entity listed, then choose System. Next we'll filter by owner.",
  ],
  [
    "a double space",
    "Choose 12456 in the From account # dropdown.  Then pick 13344 in the To account dropdown next to it.",
    "Choose 12456 in the From account # dropdown. Then pick 13344 in the To account dropdown next to it.",
  ],
  [
    "a sentence that ran away, with check marks",
    "Open the From account # dropdown and choose 12456.  Then pick 13344 in the To account dropdown.  ✓ Amount is done.  ✓ Next up is the account choice.  ✓ Last is the Transfer button.  ✓ Go on.  ✓ Choose the account.  ✓ Thanks.  ✓ Great.  ✓ Fine.  ✓ Continue.  ✓ Okay.  ✓ Done.  ✓ Yes.  ✓ Right.  ✓ Sure.  ✓ Good.  ✓ Alright.  ✓ Ready.",
    "Open the From account # dropdown and choose 12456. Then pick 13344 in the To account dropdown. Amount is done. Next up is the account choice.",
  ],
];

// These were written by the same model in the same runs and were fine. Each has something in it that a careless cleanup would damage.
const FINE: [what: string, wrote: string][] = [
  ["a quoted message at the end", 'Your payment method is updated. The page now shows the confirmation "Payment method updated."'],
  ["French quote marks", "Cliquez sur la liste déroulante « Status » (« -- Select -- ») du filtre pour choisir « Shortlisted »."],
  ["German quote marks", "Auf dieser Seite ist nur der Notebook Professional 17 als „Out of Stock“ (nicht auf Lager) markiert. Alle anderen Laptops in der Liste sind verfügbar."],
  ["a flag that is part of a control's name", "Haz clic en 🇧🇷 Português en la lista de idiomas."],
  ["square brackets", "Click the [3] citation marker right after the sentence about feeling virtual objects. It jumps down to the reference entry, where you can open the source link."],
  ["single quote marks round a title", "Click the title 'Haptic Perception, Mechanics, and Material Technologies for Virtual Reality' in the reference list. It is the third entry, so it should be source [3], and it opens the paper."],
  ["names in another script", "This is the 操作日志二 tab, now selected, in the tab bar below the user information section."],
  [
    "four sentences, two of them ending inside quote marks",
    'The login failed with "Incorrect username or password." Retype your username in the Username field, then re-enter your password and click Log in again. If you\'ve forgotten your details, use the "Can\'t log in?" link.',
  ],
  [
    "the longest sentence seen, 258 characters",
    "The phone section is near the bottom, under Applications, in the Electronic devices part that covers cellular devices. Click Toggle Applications subsection (or the 4 Applications link in Contents) to jump there; this arrow points to the last phone reference.",
  ],
  ["a question", "Did you mean the Billing page?"],
];

test("every kind of stray text seen in a live sentence is taken out", async () => {
  const { tidySay } = await import("../src/server/model.ts");
  for (const [what, wrote, shown] of SEEN) assert.equal(tidySay(wrote), shown, what);
});

test("a sentence that was fine is shown exactly as written", async () => {
  const { tidySay } = await import("../src/server/model.ts");
  for (const [what, wrote] of FINE) assert.equal(tidySay(wrote), wrote, what);
  // Tidying what is already tidy changes nothing.
  for (const [what, , shown] of SEEN) assert.equal(tidySay(shown), shown, what);
});

test("tidying leaves alone what only looks like stray text", async () => {
  const { tidySay } = await import("../src/server/model.ts");
  const kept = [
    // A key named in angle brackets is not a tag.
    "Press <Enter> to search.",
    // A file name or an address, with or without a full stop after it.
    "Open catalog-info.yaml.",
    "Open settings.json",
    "Go to example.com",
    "Select version 2.1",
    // Brackets and quote marks that have their partners.
    "Type {name} where the greeting goes",
    "Click “Save.”",
    "Klicken Sie auf »Speichern«.",
    "Tick 'Remember me.'",
    // A picture that is part of a control's name.
    "Click the 👍 button.",
    // Persian is written with a joiner that has no width between letters.
    "روی می" + String.fromCharCode(0x200c) + "خواهم کلیک کنید.",
    "点击保存。然后点击提交。",
  ];
  for (const sentence of kept) assert.equal(tidySay(sentence), sentence);
  // A dressing tag goes and its words stay. None has been seen in a live sentence yet.
  assert.equal(tidySay("Click <b>Save</b> in the top bar."), "Click Save in the top bar.");
  assert.equal(tidySay("</br>"), "");
});

test("a sentence is cut at a sentence end when it is too long to show", async () => {
  const { tidySay, SAY_MAX_CHARS, SAY_MAX_SENTENCES } = await import("../src/server/model.ts");
  const many = Array.from({ length: 9 }, (_, index) => `This is sentence number ${index + 1}.`);
  assert.equal(tidySay(many.join(" ")), many.slice(0, SAY_MAX_SENTENCES).join(" "));
  // Two long sentences: the second would go past the limit, so only the first is shown.
  const long = `Click Reports in the left menu, ${"then look down the list ".repeat(8)}for the one you want.`;
  assert.ok(long.length < SAY_MAX_CHARS && long.length * 2 > SAY_MAX_CHARS);
  assert.equal(tidySay(`${long} ${long}`), long);
  // One sentence with no end in reach is cut at a word, and says that it was.
  const endless = "Click " + "the next one and ".repeat(40) + "stop.";
  const cut = tidySay(endless);
  assert.ok(cut.length <= SAY_MAX_CHARS, `${cut.length} characters`);
  assert.match(cut, /^Click the next one and .* (and|one|next|the)…$/);
  // Short forms with full stops in them do not count as sentence ends.
  const short = "Pick a format, e.g. the CSV one. It opens in Excel, i.e. as a spreadsheet. Then save it.";
  assert.equal(tidySay(short), short);
});
