import { describe, expect, it } from "vitest";
import { describeChange } from "../src/change.ts";
import { buildPrompt } from "../src/prompt.ts";
import type { PageSnapshot, SnapshotElement, TurnRequest } from "../src/types.ts";

function page(elements: Partial<SnapshotElement>[], extra: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    path: "/settings",
    title: "Acme",
    viewport: { width: 1280, height: 800, scrollY: 0, scrollHeight: 800 },
    headings: ["Settings"],
    alerts: [],
    elements: elements.map((element, index) => ({ id: `e${index + 1}`, role: "button", label: "", position: "visible", ...element })),
    truncated: false,
    ...extra,
  };
}

describe("describeChange", () => {
  it("reports nothing when only ids and scroll position differ", () => {
    const before = page([{ label: "Save" }, { label: "Cancel" }]);
    const after = page([{ label: "Cancel" }, { label: "Save", position: "below" }], { viewport: { ...before.viewport, scrollY: 300 } });
    expect(describeChange(before, after)).toEqual({ none: true });
  });

  it("lists new and removed controls and flipped states on the same page", () => {
    const before = page([{ label: "More actions", state: ["collapsed"] }, { role: "checkbox", label: "Require 2FA" }]);
    const after = page([
      { label: "More actions", state: ["expanded"] },
      { role: "checkbox", label: "Require 2FA", state: ["checked"] },
      { role: "menuitem", label: "Invite member" },
      { role: "menuitem", label: "Export list" },
    ]);
    expect(describeChange(before, after)).toEqual({
      none: false,
      added: ['menuitem "Invite member"', 'menuitem "Export list"'],
      states: ['button "More actions" is now expanded and is no longer collapsed', 'checkbox "Require 2FA" is now checked'],
    });
  });

  it("counts duplicate labels, so a third Delete button is new", () => {
    const before = page([{ label: "Delete" }, { label: "Delete" }]);
    const after = page([{ label: "Delete" }, { label: "Delete" }, { label: "Delete" }]);
    expect(describeChange(before, after).added).toEqual(['button "Delete"']);
  });

  it("names the dialog instead of listing every element when one opens", () => {
    const before = page([{ label: "Create key" }]);
    const after = page([{ role: "textbox", label: "Name" }, { label: "Create" }], { dialog: "Create API key" });
    expect(describeChange(before, after)).toEqual({ none: false, dialogOpened: "Create API key" });
  });

  it("reports a route change and new text", () => {
    const before = page([{ label: "Next" }], { text: ["Step 1 of 3"] });
    const after = page([{ label: "Next" }], { path: "/projects/new", text: ["Step 2 of 3"] });
    expect(describeChange(before, after)).toEqual({ none: false, path: { from: "/settings", to: "/projects/new" }, text: ["Step 2 of 3"] });
  });

  it("caps long lists", () => {
    const before = page([]);
    const after = page(Array.from({ length: 11 }, (_, i) => ({ label: `Row ${i}` })));
    const change = describeChange(before, after);
    expect(change.added).toHaveLength(8);
    expect(change.addedMore).toBe(3);
  });
});

describe("progress in the prompt", () => {
  const request = (extra: Partial<TurnRequest>): TurnRequest => ({
    kind: "continue",
    goal: "change my plan",
    step: 2,
    event: { type: "clicked", id: "e3", label: "Team" },
    snapshot: page([{ label: "Team" }]),
    history: [],
    ...extra,
  });
  const lastMessage = (turn: TurnRequest) => buildPrompt({ siteName: "Acme" }, turn).messages.at(-1)!.text;

  it("says when nothing changed", () => {
    expect(lastMessage(request({ change: { none: true } }))).toContain('The user clicked "Team". Here is the page now.\nNothing visible on the page changed.');
  });

  it("lists what changed", () => {
    const text = lastMessage(request({ change: { none: false, dialogOpened: "Choose a plan", added: ['button "Starter"'], addedMore: 2 } }));
    expect(text).toContain('What changed:\n- Dialog "Choose a plan" opened.\n- New: button "Starter" and 2 more.');
  });

  it("explains a held-back repeat", () => {
    const text = lastMessage(request({ change: { none: true }, nudge: { reason: "unchanged", label: 'button "Team"' } }));
    expect(text).toContain('pointed at button "Team" again, but the user already used it and nothing changed');
  });

  it("tells the model it can't see what was typed", () => {
    expect(lastMessage(request({ event: { type: "filled", id: "e2", label: "Name" } }))).toContain(`The user filled in "Name". You can't see what they entered.`);
  });

  it("says when the user clicked something other than the pointed element", () => {
    expect(lastMessage(request({ event: { type: "clicked", id: "", label: "Billing" } }))).toContain('clicked "Billing" instead of the element you pointed at');
  });
});
