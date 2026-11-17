import assert from "node:assert/strict";
import { test } from "node:test";
import { hear, isOwn, keysAsked, markOwn, nothingHeard, OWN_TYPING_PAUSE_MS, waiting, type Fate, type Heard, type Pointed, type Seen, type Verdict, type Where } from "../src/widget/observe.ts";

// "Was that the step?" decided from sequences of plain events, with no page.
// The sequences are the ones real apps produced: a list that acts as the mouse
// goes down (Wikipedia's options, Backstage's menus), a press held for half a
// second, a control the page draws again, a page that changes by itself.

const BUTTON: Pointed = { typed: false, select: false, ticked: false, keys: [], anyClick: false };
const FIELD: Pointed = { ...BUTTON, typed: true };
const SELECT: Pointed = { ...BUTTON, select: true };

const SAME: Fate = { gone: false, changed: false, dialog: false, path: false, address: false, pressGone: false, popupOpen: false, listOpen: false, leaving: false };
const where = (over: Partial<Where> = {}): Where => ({ onTarget: false, controls: [], name: "", known: true, inPopup: false, aroundTarget: false, ...over });
const TARGET = where({ onTarget: true, controls: [1], name: "Save" });
const OTHER = where({ controls: [2], name: "Cancel" });
const BLANK = where();

/** Feeds a run of events and gives back the verdict, if one was reached, and when. */
function run(pointed: Pointed, events: Seen[]): { verdict?: Verdict; at?: number; heard: Heard } {
  let heard = nothingHeard();
  for (const seen of events) {
    heard = hear(heard, seen, pointed);
    if (heard.verdict) return { verdict: heard.verdict, at: seen.at, heard };
  }
  return { heard };
}
const tick = (at: number, fate: Partial<Fate> = {}): Seen => ({ type: "tick", at, fate: { ...SAME, ...fate } });
const press = (at: number, w: Where): Seen => ({ type: "press", at, where: w });
const click = (at: number, w: Where): Seen => ({ type: "click", at, where: w });
const release = (at: number): Seen => ({ type: "release", at });

test("a click on the pointed button is the step, at once", () => {
  const { verdict, at } = run(BUTTON, [press(0, TARGET), release(60), click(61, TARGET)]);
  assert.deepEqual(verdict, { how: "clicked", onTarget: true, strayed: false });
  assert.equal(at, 61);
});

test("a click on another control is a wrong click and names it", () => {
  assert.deepEqual(run(BUTTON, [press(0, OTHER), release(50), click(51, OTHER)]).verdict, { how: "other", name: "Cancel", onTarget: false, strayed: true });
});

test("a click on blank space is nothing, unless the pointer was the last word", () => {
  assert.equal(run(BUTTON, [press(0, BLANK), release(50), click(51, BLANK), tick(200), tick(2500)]).verdict, undefined);
  assert.equal(run({ ...BUTTON, anyClick: true }, [press(0, BLANK), release(50), click(51, BLANK)]).verdict?.how, "elsewhere");
});

test("clicking into a field is not the step: typing is, once it pauses", () => {
  const events: Seen[] = [press(0, TARGET), release(40), click(41, TARGET), tick(300), { type: "input", at: 500, inTarget: true }, { type: "input", at: 900, inTarget: true }, tick(1500), tick(2000)];
  assert.equal(run(FIELD, events).verdict, undefined);
  const { verdict, at } = run(FIELD, [...events, tick(2100)]);
  assert.equal(verdict?.how, "filled");
  assert.equal(at, 2100);
});

test("Haptic's own typing is done once it pauses briefly; a visitor's needs the longer pause", () => {
  const typing: Seen[] = [{ type: "input", at: 0, inTarget: true }, { type: "input", at: 35, inTarget: true }, { type: "input", at: 70, inTarget: true }];
  const own = run({ ...FIELD, typingPauseMs: OWN_TYPING_PAUSE_MS }, [...typing, tick(300), tick(400)]);
  assert.equal(own.verdict?.how, "filled");
  assert.equal(own.at, 400);
  assert.equal(run(FIELD, [...typing, tick(300), tick(400), tick(1200)]).verdict, undefined, "a visitor who stops for half a second is still typing");
});

test("an event is Haptic's own only when Haptic marked it", () => {
  const ours = markOwn(new Event("click"));
  assert.equal(isOwn(ours), true);
  assert.equal(isOwn(new Event("click")), false);
});

test("Enter in the pointed field ends the typing, and is its own step when the sentence asks for it", () => {
  const enter: Seen = { type: "key", at: 700, key: "Enter", inTarget: true, inTyped: true };
  assert.equal(run(FIELD, [{ type: "input", at: 500, inTarget: true }, enter]).verdict?.how, "filled");
  assert.deepEqual(run({ ...FIELD, keys: ["enter"] }, [enter]).verdict, { how: "key", key: "enter", onTarget: true, strayed: false });
  assert.equal(run({ ...FIELD, keys: ["enter"] }, [{ type: "input", at: 500, inTarget: true }, enter]).verdict?.how, "filled");
});

test("a press whose click never comes counts when what was pressed is gone, hidden or moved", () => {
  // Wikipedia's option: the list acts on the press, and the option is clipped and moved, not removed.
  const { verdict } = run(BUTTON, [press(0, TARGET), release(70), tick(100), tick(160, { pressGone: true })]);
  assert.equal(verdict?.how, "clicked");
  // The same press on something that stays put was a drag or a change of mind.
  assert.equal(run(BUTTON, [press(0, TARGET), release(70), tick(160), tick(400)]).verdict, undefined);
  // On another control it is that control that was used.
  assert.equal(run(BUTTON, [press(0, OTHER), release(70), tick(160, { pressGone: true })]).verdict?.how, "other");
});

test("a press is kept until the mouse comes up, however long it is held", () => {
  const held = [press(0, TARGET), tick(300), tick(450), tick(502), tick(900)];
  assert.equal(run(BUTTON, held).verdict, undefined);
  assert.equal(run(BUTTON, [...held, release(950), tick(1040, { pressGone: true })]).verdict?.how, "clicked");
  assert.equal(run(BUTTON, [...held, release(950), click(951, TARGET)]).verdict?.how, "clicked");
});

test("a list that slides under the mouse as it goes down: the click lands elsewhere, and what was pressed is what was used", () => {
  const backdrop = where({ controls: [], name: "" });
  assert.equal(run(BUTTON, [press(0, TARGET), release(50), click(51, backdrop)]).verdict?.how, "clicked");
  assert.equal(run(BUTTON, [press(0, OTHER), release(50), click(51, backdrop)]).verdict?.how, "other");
  // A click on a box around what was pressed is the same click.
  assert.equal(run(BUTTON, [press(0, where({ onTarget: true, controls: [1, 9] })), release(50), click(51, where({ onTarget: true, controls: [1, 9] }))]).verdict?.how, "clicked");
});

test("a pick in the pointed control's own popup is never a wrong click, and is heard when the popup closes or goes quiet", () => {
  const day = (name: string) => where({ controls: [7], name, known: false, inPopup: true });
  // A range in a calendar: two picks, and the calendar closes after the second.
  const range: Seen[] = [press(0, TARGET), release(30), click(31, TARGET), press(900, day("12")), release(950), click(951, day("12")), tick(1100, { popupOpen: true }), tick(2000, { popupOpen: true })];
  assert.equal(run(FIELD, range).verdict, undefined);
  const done = run(FIELD, [...range, press(2600, day("19")), release(2650), click(2651, day("19")), tick(2700, { popupOpen: true }), tick(2900)]);
  assert.deepEqual(done.verdict, { how: "chose", names: ["12", "19"], onTarget: true, strayed: false });
  // A list that stays open, with tick boxes in it, is done with once it has been quiet.
  assert.equal(run(FIELD, [...range, tick(3400, { popupOpen: true })]).verdict, undefined);
  assert.equal(run(FIELD, [...range, tick(3500, { popupOpen: true })]).verdict?.how, "chose");
  // With no sign of what the popup is, something new that is clicked after going into the field is still the field's list.
  assert.equal(run(FIELD, [press(0, TARGET), release(30), click(31, TARGET), click(900, where({ controls: [7], name: "Blue", known: false })), tick(1000)]).verdict?.how, "chose");
});

test("a field whose list of choices opens, and a visitor who stops, is a step so the pointer can move to the choice", () => {
  const into: Seen[] = [press(0, TARGET), release(30), click(31, TARGET)];
  assert.equal(run(FIELD, [...into, tick(600, { listOpen: true, changed: true }), tick(1200, { listOpen: true, changed: true })]).verdict, undefined);
  assert.equal(run(FIELD, [...into, tick(1300, { listOpen: true, changed: true })]).verdict?.how, "opened");
  // Typing means they have not stopped.
  assert.equal(run(FIELD, [...into, { type: "input", at: 800, inTarget: true }, tick(1300, { listOpen: true })]).verdict, undefined);
});

test("what the page did after a press finishes the step when nothing else made sense of it", () => {
  // A press on the control that no click followed, and the control is gone.
  assert.equal(run(BUTTON, [press(0, TARGET), tick(100), release(700), tick(800, { gone: true })]).verdict?.how, "clicked");
  // A press on something that could not be identified, and a dialog opened: a step, and not a wrong click.
  assert.deepEqual(run(BUTTON, [press(0, BLANK), release(40), click(41, BLANK), tick(300, { dialog: true })]).verdict, { how: "unknown", onTarget: false, strayed: false });
  assert.equal(run(BUTTON, [press(0, BLANK), release(40), click(41, BLANK), tick(300, { path: true })]).verdict?.how, "unknown");
  assert.equal(run(BUTTON, [{ type: "key", at: 0, key: "Escape", inTarget: false, inTyped: false }, tick(200, { dialog: true })]).verdict?.how, "unknown");
  assert.deepEqual(run(BUTTON, [{ type: "key", at: 0, key: "ArrowDown", inTarget: true, inTyped: false }, tick(200, { changed: true })]).verdict, { how: "key", key: "arrowdown", onTarget: true, strayed: false });
});

test("no press, no question: a page that changes by itself is not a step", () => {
  const live = [tick(500, { changed: true }), tick(1000, { dialog: true }), tick(1500, { changed: true, address: true })];
  assert.equal(run(BUTTON, live).verdict, undefined);
  // Nor is a change that comes long after the last press.
  assert.equal(run(BUTTON, [press(0, BLANK), release(40), click(41, BLANK), tick(2200, { dialog: true })]).verdict, undefined);
  // Nor is a letter typed somewhere, or an arrow key inside a field.
  assert.equal(run(BUTTON, [{ type: "key", at: 0, key: "a", inTarget: false, inTyped: false }, tick(200, { dialog: true })]).verdict, undefined);
  assert.equal(run(BUTTON, [{ type: "key", at: 0, key: "ArrowDown", inTarget: false, inTyped: true }, tick(200, { changed: true })]).verdict, undefined);
});

test("an address that moves by itself is leaving, but not when only what follows ? or # moved, and not just after the control was used", () => {
  assert.deepEqual(run(BUTTON, [tick(500, { path: true, address: true })]).verdict, { how: "left", onTarget: false, strayed: true });
  assert.equal(run(FIELD, [tick(500, { address: true })]).verdict, undefined);
  // Typing in a search box that writes the search into the address, even into its path.
  const typing: Seen[] = [{ type: "input", at: 0, inTarget: true }, { type: "input", at: 300, inTarget: true }];
  assert.equal(run(FIELD, [...typing, tick(500, { address: true })]).verdict, undefined);
  assert.equal(run(FIELD, [...typing, tick(500, { path: true, address: true })]).verdict?.how, "filled");
  assert.equal(run(FIELD, [...typing, tick(1500, { address: true })]).verdict?.how, "filled");
});

test("a control the page drew again, with nothing done, is found again and not asked about", () => {
  assert.deepEqual(run(BUTTON, [tick(500, { gone: true })]).verdict, { how: "redrawn", onTarget: false, strayed: false });
  // After a press it is the press that made it go.
  assert.equal(run(BUTTON, [press(0, OTHER), release(30), tick(60), tick(300, { gone: true })]).verdict?.how, "unknown");
});

test("Escape that takes the control away dismissed it, even with the keyboard on the control, unless the sentence asked for Escape", () => {
  const escape: Seen = { type: "key", at: 0, key: "Escape", inTarget: true, inTyped: false };
  // The dialog Continue was in closed: not the step, and not a wrong click either.
  assert.deepEqual(run(BUTTON, [escape, tick(150, { gone: true, dialog: true })]).verdict, { how: "unknown", onTarget: false, strayed: false });
  // A sentence that said "Press Escape" heard it at once.
  assert.deepEqual(run({ ...BUTTON, keys: ["escape"] }, [escape]).verdict, { how: "key", key: "escape", onTarget: true, strayed: false });
  // Escape in a field that closes only its own list leaves the field where it was: that is not a step at all.
  assert.equal(run(FIELD, [escape, tick(150, { changed: true })]).verdict, undefined);
  // Another key on the control that takes it away is still the control's own doing.
  assert.equal(run(BUTTON, [{ ...escape, key: "ArrowRight" } as Seen, tick(150, { gone: true })]).verdict?.how, "key");
});

test("a dialog the page opens over the control, with nothing done, ends the step once it has stayed a moment", () => {
  // A dialog that flickers up and away has not covered it.
  assert.equal(run(BUTTON, [tick(500, { covered: true, dialog: true }), tick(600, { dialog: false })]).verdict, undefined);
  const covered = run(BUTTON, [tick(500, { covered: true, dialog: true }), tick(600, { covered: true, dialog: true }), tick(750, { covered: true, dialog: true })]);
  assert.deepEqual(covered.verdict, { how: "covered", onTarget: false, strayed: false });
  assert.equal(covered.at, 750);
  // While it is over the control, the control is looked at often, so the verdict comes soon.
  assert.equal(waiting(run(BUTTON, [tick(500, { covered: true, dialog: true })]).heard, 1500), true);
  // One the visitor's own press opened is the press's doing, heard as before.
  assert.equal(run(BUTTON, [press(0, BLANK), release(40), click(41, BLANK), tick(300, { covered: true, dialog: true })]).verdict?.how, "unknown");
});

test("a real dropdown is heard by its change, by its second click, or by leaving it once opened", () => {
  assert.equal(run(SELECT, [{ type: "input", at: 10, inTarget: true }]).verdict?.how, "filled");
  assert.equal(run(SELECT, [click(0, TARGET), click(900, TARGET)]).verdict?.how, "filled");
  assert.equal(run(SELECT, [click(0, TARGET), { type: "left", at: 900 }]).verdict?.how, "filled");
  assert.equal(run(SELECT, [{ type: "left", at: 900 }]).verdict, undefined);
});

test("a tick box is heard by its change, and a click into a frame inside the control by the window losing the keyboard", () => {
  assert.equal(run({ ...BUTTON, ticked: true }, [{ type: "input", at: 10, inTarget: true }]).verdict?.how, "clicked");
  assert.equal(run(BUTTON, [{ type: "frame", at: 10 }]).verdict?.how, "clicked");
});

test("nothing is heard while the page is leaving, and nothing after a verdict", () => {
  assert.equal(run(BUTTON, [tick(500, { path: true, leaving: true })]).verdict, undefined);
  const { heard } = run(BUTTON, [click(0, TARGET)]);
  assert.equal(hear(heard, click(10, OTHER), BUTTON).verdict?.how, "clicked");
});

test("ticks come often only while something is pending", () => {
  assert.equal(waiting(nothingHeard(), 0), false);
  assert.equal(waiting(hear(nothingHeard(), press(0, BLANK), BUTTON), 100), true);
  const after = hear(hear(hear(nothingHeard(), press(0, BLANK), BUTTON), release(50), BUTTON), click(51, BLANK), BUTTON);
  assert.equal(waiting(after, 1000), true);
  assert.equal(waiting(after, 2100), false);
});

test("the keys a sentence asks for are read from it", () => {
  assert.deepEqual(keysAsked("Press Enter to search."), ["enter"]);
  assert.deepEqual(keysAsked("Type the order number, then press the Return key."), ["enter"]);
  assert.deepEqual(keysAsked("Press Tab to leave the field."), ["tab"]);
  assert.deepEqual(keysAsked("Hit Esc to close the menu, then press the down arrow."), ["escape", "arrowdown"]);
  assert.deepEqual(keysAsked("Click Save. Press it once."), []);
  assert.deepEqual(keysAsked("Click the Enter button."), []);
});

test("a press that began on the control and came up on a box around it, as a drag does, is the step", () => {
  // Material UI's slider: the press is on the thumb, and the click goes to the slider that holds the thumb and the rail.
  const around = where({ controls: [3], name: "", aroundTarget: true });
  assert.deepEqual(run(BUTTON, [press(0, TARGET), release(400), click(401, around)]).verdict, { how: "clicked", onTarget: true, strayed: false });
  // A press that began elsewhere and came up there is still nothing.
  assert.equal(run(BUTTON, [press(0, BLANK), release(400), click(401, around)]).verdict, undefined);
});

test("the page writing into the pointed field by script is not the visitor typing, but a pick it reflects is still heard", () => {
  const written: Seen = { type: "input", at: 500, inTarget: true, byPage: true };
  assert.equal(run(FIELD, [written, tick(2000), tick(3000)]).verdict, undefined);
  assert.equal(run(SELECT, [written]).verdict?.how, "filled");
});

// Chrome's autofill, as it was seen on the request access form: the visitor picked one of the browser's suggestions in
// First name, the pointed field, and the browser wrote First name and Last name at once. Moments later, before typing
// would have paused, they clicked Additional details, and that click was heard as a wrong one: "Not that one".
const DETAILS = where({ controls: [3], name: "Additional details" });

test("the browser's autofill in the pointed field fills it in at once, with no pause to wait for", () => {
  const { verdict, at } = run(FIELD, [press(0, TARGET), release(40), click(41, TARGET), { type: "input", at: 900, inTarget: true, autofill: true }]);
  assert.deepEqual(verdict, { how: "filled", onTarget: true, strayed: false, autofill: true });
  assert.equal(at, 900);
  // A real dropdown the browser fills in says so too.
  assert.deepEqual(run(SELECT, [{ type: "input", at: 10, inTarget: true, autofill: true }]).verdict, { how: "filled", onTarget: true, strayed: false, autofill: true });
  // Autofill that reaches only the other fields of the form is not this step.
  assert.equal(run(FIELD, [{ type: "input", at: 10, inTarget: false, autofill: true }, tick(2000)]).verdict, undefined);
});

test("a field typed in and then left for another control before the pause is filled in, and says what was clicked", () => {
  const typed: Seen[] = [press(0, TARGET), release(40), click(41, TARGET), { type: "input", at: 400, inTarget: true }, { type: "input", at: 520, inTarget: true }];
  // Into the next field, well inside the pause.
  const next = run(FIELD, [...typed, press(900, DETAILS), release(950), click(951, DETAILS)]);
  assert.deepEqual(next.verdict, { how: "filled", onTarget: true, strayed: false, then: "Additional details" });
  assert.equal(next.at, 951);
  // A press that no click followed, on a control that went: the same.
  assert.equal(run(FIELD, [...typed, press(900, OTHER), release(950), tick(1040, { pressGone: true })]).verdict?.how, "filled");
  // A control with no name that is safe to send is still named as clicked.
  assert.deepEqual(run(FIELD, [...typed, press(900, where({ controls: [4] })), release(950), click(951, where({ controls: [4] }))]).verdict, { how: "filled", onTarget: true, strayed: false, then: "" });
});

test("another control clicked before anything was typed in the pointed field is still a wrong click", () => {
  assert.deepEqual(run(FIELD, [press(0, DETAILS), release(50), click(51, DETAILS)]).verdict, { how: "other", name: "Additional details", onTarget: false, strayed: true });
  // Clicking into the field first is not typing in it.
  assert.equal(run(FIELD, [press(0, TARGET), release(40), click(41, TARGET), press(600, DETAILS), release(650), click(651, DETAILS)]).verdict?.how, "other");
  // Nor is a value the page's script wrote there.
  assert.equal(run(FIELD, [{ type: "input", at: 10, inTarget: true, byPage: true }, press(600, DETAILS), release(650), click(651, DETAILS)]).verdict?.how, "other");
});
