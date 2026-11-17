import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { BROWSERS, launch, statesOf } from "./harness.ts";

// A field carries what the page itself marks on it: that it must be filled in,
// or that what it holds will not be accepted. The model needs these to know
// what a form asks for before it points at Submit. "required" comes from
// attributes and labels, never from what is in the field (isRequired in
// src/widget/snapshot.ts). A form that marks only its optional fields, and the
// browser's own check behind "invalid", are covered in snapshot.test.ts.

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
      assert.deepEqual(states, { Email: ["required"], Team: ["required"], Department: ["required", "collapsed"], Monthly: ["required"], Nickname: [] });
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
        Owner: ["required", "collapsed"],
      });
    });

    test("reads invalid from aria-invalid, and not from aria-invalid=false", async () => {
      const states = await statesOf(tab, `
        <input aria-label="Email address 1" aria-invalid="true">
        <input aria-label="Email address 2" aria-invalid="false">
        <label>Amount <input required aria-invalid="true"></label>`);
      assert.deepEqual(states, { "Email address 1": ["invalid"], "Email address 2": [], Amount: ["required", "invalid"] });
    });

    test("lists a required field the same whether it is empty or filled in", async () => {
      const states = await statesOf(tab, `
        <label>Empty <input required></label>
        <label>Filled <input required value="sam@example.com"></label>`);
      assert.deepEqual(states, { Empty: ["required"], Filled: ["required"] });
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
