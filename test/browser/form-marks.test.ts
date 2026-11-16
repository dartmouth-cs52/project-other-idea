import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { BROWSERS, launch, statesOf } from "./harness.ts";

// A field carries what the page itself marks on it: that it must be filled in,
// that it may be left empty, or that it failed the page's check. The model
// needs these to know what a form asks for before it points at Submit. They
// come from attributes and labels, never from what is in the field.

for (const name of BROWSERS) {
  describe(`form marks in ${name}`, () => {
    let browser: Browser;
    let tab: Page;
    before(async () => {
      browser = await launch(name);
      tab = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    });
    after(() => browser.close());

    test("reads required from the attribute, from aria-required and from a required radio group", async () => {
      const states = await statesOf(tab, `
        <label>Email <input type="email" required></label>
        <label>Team <select required><option>Sales</option></select></label>
        <button role="combobox" aria-expanded="false" aria-label="Department" aria-required="true">Choose a department</button>
        <div role="radiogroup" aria-required="true">
          <span role="radio" aria-checked="false" tabindex="0">Monthly</span>
        </div>
        <label>Nickname <input></label>`);
      assert.deepEqual(states, { Email: ["required"], Team: ["required"], Department: ["collapsed", "required"], Monthly: ["required"], Nickname: [] });
    });

    test("reads the star on a label, written out, hidden from screen readers or drawn by the stylesheet", async () => {
      const states = await statesOf(
        tab,
        `
        <label for="a">Company *</label><input id="a">
        <label for="b">First name<span aria-hidden="true">*</span></label><input id="b">
        <label for="c" class="needed">Last name</label><input id="c">
        <span id="d-label">* Phone</span><input aria-labelledby="d-label">
        <label for="e">Budget (required)</label><input id="e">
        <label for="f">Cost centre</label><button id="f" role="combobox" aria-expanded="false" aria-label="Cost centre">Choose one</button>
        <label for="g">Owner<abbr title="required">*</abbr></label><button id="g" role="combobox" aria-expanded="false" aria-label="Owner">Choose one</button>`,
        `<style>.needed::after { content: " *"; color: red }</style>`,
      );
      assert.deepEqual(states, {
        "Company *": ["required"],
        // The hidden star marks the field and stays out of its name.
        "First name": ["required"],
        "Last name": ["required"],
        "* Phone": ["required"],
        "Budget (required)": ["required"],
        "Cost centre": ["collapsed"],
        // A button the page draws as a list takes its label's star too.
        Owner: ["collapsed", "required"],
      });
    });

    test("reads optional from the label or the placeholder, and required wins over it", async () => {
      const states = await statesOf(tab, `
        <label for="a">Personal note<span>(optional)</span></label><textarea id="a"></textarea>
        <label>Middle name <input placeholder="Optional"></label>
        <label>Tax ID (optional) <input required></label>
        <label>Optional extras <input type="checkbox"></label>`);
      assert.deepEqual(states, {
        "Personal note(optional)": ["optional"],
        "Middle name": ["optional"],
        "Tax ID (optional)": ["required"],
        // The word has to close the label or sit in brackets. Here it does neither.
        "Optional extras": [],
      });
    });

    test("reads invalid from aria-invalid, on the field or its radio group, and not from aria-invalid=false", async () => {
      const states = await statesOf(tab, `
        <input aria-label="Email address 1" aria-invalid="true">
        <input aria-label="Email address 2" aria-invalid="false">
        <label>Amount <input required aria-invalid="true"></label>
        <div role="radiogroup" aria-invalid="true"><span role="radio" aria-checked="true" tabindex="0">Card</span></div>`);
      assert.deepEqual(states, { "Email address 1": ["invalid"], "Email address 2": [], Amount: ["required", "invalid"], Card: ["checked", "invalid"] });
    });

    test("says the same for a filled field as for an empty one, because it never looks inside", async () => {
      const states = await statesOf(tab, `
        <label>Empty <input required></label>
        <label>Filled <input required value="sam@example.com"></label>
        <label>Wrong <input type="email" required value="not an email"></label>`);
      assert.deepEqual(states, { Empty: ["required"], Filled: ["required"], Wrong: ["required"] });
    });

    test("marks fields only, so a button or link with a star in its words is left alone", async () => {
      const states = await statesOf(tab, `
        <button>Save *</button>
        <a href="/terms">Terms (required)</a>
        <button aria-required="true">Continue</button>`);
      assert.deepEqual(states, { "Save *": [], "Terms (required)": [], Continue: [] });
    });
  });
}
