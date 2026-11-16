import assert from "node:assert/strict";
import { test } from "node:test";
import type { Snapshot } from "../src/shared/types.ts";
import { describeChange, elementKey } from "../src/widget/snapshot.ts";

// The parts of the widget's page reading that need no browser: comparing two readings.

const page = (elements: Snapshot["elements"], text: string[] = []): Snapshot => ({ path: "/", title: "", headings: [], text, elements, truncated: false });

test("a control is the same control whatever its place among its like", () => {
  const first = elementKey({ role: "button", label: "Remove", context: "main › row: Priya › 1 of 3" });
  assert.equal(first, elementKey({ role: "button", label: "Remove", context: "main › row: Priya" }));
  assert.equal(first, elementKey({ role: "button", label: "Remove", context: "main › row: Priya › 2 of 2" }));
  assert.notEqual(first, elementKey({ role: "button", label: "Remove", context: "main › row: Sam › 1 of 3" }));
});

test("one of three same-named fields going away is reported as one gone, not as all of them renumbered", () => {
  const field = (place: string) => ({ id: "e1", role: "textbox", label: "Please enter", context: `form › ${place}` });
  const change = describeChange(page([field("1 of 3"), field("2 of 3"), field("3 of 3")]), page([field("1 of 2"), field("2 of 2")]));
  assert.equal(change, 'Gone: textbox "Please enter".');
});
