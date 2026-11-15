import assert from "node:assert/strict";
import { test } from "node:test";
import { nameOfClicked } from "../src/widget/guide.ts";

// When a visitor clicks something other than the control Haptic pointed at,
// the widget names what they clicked so the model can say "Not that one".
// That name goes to the server, so it must never carry what a person wrote,
// and it is masked like the rest of the page. These stand-ins model only what
// nameOfClicked reads from an element; the selector test is reduced to "is it
// a control whose caption says what it is".

interface Shape {
  ariaLabel?: string;
  text?: string;
  control?: boolean;
  editable?: boolean;
  holdsField?: boolean;
}

function element(shape: Shape): Element {
  return {
    getAttribute: (name: string) => (name === "aria-label" ? (shape.ariaLabel ?? null) : null),
    matches: () => shape.control ?? false,
    isContentEditable: shape.editable ?? false,
    querySelector: () => (shape.holdsField ? {} : null),
    textContent: shape.text ?? "",
  } as unknown as Element;
}

test("a button or link is named by its caption", () => {
  assert.equal(nameOfClicked(element({ control: true, text: "  Export   report " })), "Export report");
});

test("emails and long numbers in a caption are masked", () => {
  assert.equal(
    nameOfClicked(element({ control: true, text: "Contact jane.doe@acme.com about card 4111111111111111" })),
    "Contact [email] about card [number]",
  );
});

test("an aria-label is used, and masked", () => {
  assert.equal(nameOfClicked(element({ ariaLabel: "Email sam@corp.example", text: "@" })), "Email [email]");
});

test("an editor's text is never sent", () => {
  assert.equal(nameOfClicked(element({ control: true, editable: true, text: "My private draft about the merger" })), "");
});

test("a box that holds a field or an editor is never named by its text", () => {
  assert.equal(nameOfClicked(element({ control: true, holdsField: true, text: "Patient note: John Smith has diabetes" })), "");
});

test("a region of the page that can be clicked is not named by its text", () => {
  assert.equal(nameOfClicked(element({ control: false, text: "Private message: salary is 185000 dollars" })), "");
});

test("a long caption is cut", () => {
  assert.ok(nameOfClicked(element({ control: true, text: "word ".repeat(40) })).length <= 60);
});
