import assert from "node:assert/strict";
import { test } from "node:test";
import { asksForAFact, judgeNamed, namedButNotPointed, namedButNotPointedNote, wantsTheWay } from "../src/server/check.ts";
import type { SnapElement, Snapshot, TurnReply, TurnRequest } from "../src/shared/types.ts";

// A guide's reply that tells the visitor to use a listed control and points
// at nothing, after the first step: pointed at in code, left as an aside, or
// asked about again (check.ts, judgeNamed). Every sentence here is one a model
// wrote, on Northpine or on a benchmark app, unless it says otherwise.

const page = (path: string, ...controls: [role: string, label: string][]): Snapshot => ({
  path,
  title: "",
  headings: [],
  text: [],
  truncated: false,
  elements: controls.map(([role, label], index): SnapElement => ({ id: `e${index + 1}`, role, label })),
});

/** The verdict on a reply of "done" with nothing pointed at, a step after the first. */
function verdict(goal: string, snapshot: Snapshot, say: string, status: TurnReply["status"] = "done", step = 2): string {
  const reply: TurnReply = { target: null, status, say };
  const request: Pick<TurnRequest, "goal" | "step" | "event" | "snapshot"> = { goal, step, event: step ? 'The user clicked link "Budgets".' : undefined, snapshot };
  const named = namedButNotPointed(snapshot, reply);
  return named ? `${judgeNamed(request, reply, named)} ${named.label}` : "nothing named";
}

// Northpine's Budgets page as the widget lists it, cut to what matters here.
const budgets = page("/budgets", ["link", "Home"], ["link", "Budgets"], ["link", "People"], ["button", "New budget"], ["radio", "This quarter"], ["button", "Show only these"]);
/** What the owner was told on Northpine, with the guide ended there. */
const ownersStop = "You're on the Budgets page now, where every team's budget is listed. To add one, use New budget at the top.";

test("the owner's stop on Northpine's Budgets page is pointed at, whatever way the visitor asked", () => {
  for (const goal of ["add a budget", "how do I add a budget", "I want to add a budget for marketing", "set a budget for marketing, $50,000 a month", "where do I add a budget"]) {
    assert.equal(verdict(goal, budgets, ownersStop), "point New budget", goal);
    assert.equal(verdict(goal, budgets, ownersStop, "continue"), "point New budget", goal);
  }
  // Written as a plain instruction, with what comes after it.
  assert.equal(verdict("how do I add a budget", budgets, "Click New budget at the top to add one."), "point New budget");
  assert.equal(verdict("how do I add a budget", budgets, "Budgets lists each team's budget. Use New budget to add one, then fill in the name and amount."), "point New budget");
});

test("a control is pointed at only when it shares a word with the goal, not a word every goal has", () => {
  // "New budget" and "add a person" share only "add" and "new".
  assert.equal(verdict("how do I add a new person", budgets, ownersStop), "ask New budget");
  // A plural is the same word.
  const people = page("/people", ["button", "Invite people"], ["link", "Departments"]);
  assert.equal(verdict("how do I add someone to the team", people, "This is the directory. Click Invite people to send them an invite."), "ask Invite people");
  assert.equal(verdict("how do I invite people", people, "This is the directory. Click Invite people to send them an invite."), "point Invite people");
  assert.equal(verdict("set up two departments", people, "Departments have their own page: open Departments in the tabs."), "point Departments");
});

// What would be wrong to point at: the false positives found by replaying the
// recorded replies. Each was right as it was.

test("a control named as something optional or for later is left as it is", () => {
  // grafana, after the menu was hidden. Pointing at Main menu would undo the goal.
  const grafana = page("/d/x", ["button", "Main menu"], ["button", "Search"]);
  assert.equal(verdict("the menu down the left is eating half my screen, how do i hide it", grafana, "The left menu is now hidden. To bring it back, click Main menu in the top bar."), "aside Main menu");
  assert.equal(verdict("the menu down the left is eating half my screen, how do i hide it", grafana, "The left menu is now hidden. Click Main menu in the top bar whenever you want it back."), "aside Main menu");
  // jira, once the cheat sheet was open.
  const jira = page("/browse/KAFKA", ["link", "Close"], ["link", "Help"]);
  assert.equal(verdict("is there a cheat sheet of hotkeys?", jira, "Yes, the Keyboard Shortcuts cheat sheet is now open, listing Global Shortcuts, Navigating Issues and Issue Actions. Click Close when you're finished with it."), "aside Close");
  // ui5, once the laptop was in the cart.
  const ui5 = page("/cart", ["button", "Show Shopping Cart"], ["link", "Laptops"]);
  assert.equal(verdict("I want the Notebook Basic 17. How do I put it in my basket?", ui5, "Done. The page confirms Notebook Basic 17 was added to your shopping cart. Click Show Shopping Cart in the top bar whenever you want to review it."), "aside Show Shopping Cart");
  assert.equal(verdict("I want the Notebook Basic 17. How do I put it in my basket?", ui5, "Notebook Basic 17 is now in your shopping cart. You can click Show Shopping Cart at the top to review it."), "aside Show Shopping Cart");
  // wikipedia, with the list filtered as asked.
  const wiki = page("/wiki/Special:WhatLinksHere", ["link", "next 50"], ["button", "Live updates"]);
  assert.equal(verdict("Which other Wikipedia articles mention this one? I only want proper articles.", wiki, "The list is now filtered to the Article namespace, starting with Video game, Computer mouse and Joystick. Use next 50 at the bottom to see more."), "aside next 50");
  assert.equal(verdict("Where can I watch edits coming in across the whole site? Only from people who aren't logged in.", wiki, "Recent changes now shows only edits by unregistered users, with the Unregistered filter active. To see new edits as they come in, use the Live updates button."), "aside Live updates");
  // demo, after the project was created: the way to do it again.
  const projects = page("/projects", ["button", "New project"], ["link", "Settings"]);
  assert.equal(verdict("create a new project", projects, "The New project dialog closed after you clicked Create project, so your project should now be created. If you don't see it in the list, click New project to try again."), "aside New project");
  // ParaBank down: a way round for later, not a step.
  const bank = page("/parabank/transfer.htm", ["link", "Transfer Funds"], ["link", "Accounts Overview"]);
  assert.equal(verdict("move $25 from account 12456 to 13344", bank, "The Transfer Funds page still shows an internal error, so the form won't load right now. Try again later, or log out and back in, then open Transfer Funds."), "aside Transfer Funds");
  // Written for this test: the visitor's own call.
  assert.equal(verdict("how do I add a budget", budgets, "Your budget is saved. If you ever need another, use New budget."), "aside New budget");
});

test("a question about what the site has, answered in words after the first step, is left as it is", () => {
  // jira: "go to" read as an instruction, in an answer about who leads each component.
  const components = page("/projects/KAFKA/components", ["link", "Neha Narkhede"], ["link", "Jun Rao"]);
  const answer = "The Components list shows Kafka's areas with their leads: admin, consumer, controller and config go to Neha Narkhede, build to Jun Rao.";
  assert.equal(verdict("What areas is the Kafka project split into, and who looks after each one?", components, answer), "aside Neha Narkhede");
  // The owner's rule of 15 November: whether something can be done is answered in words.
  assert.equal(verdict("can I add a budget?", budgets, ownersStop), "aside New budget");
  assert.equal(asksForAFact("which budgets are over"), true);
  assert.equal(asksForAFact("Does Wikipedia have some kind of disclaimer about medical advice? Where would I find it?"), false);
  assert.equal(asksForAFact("how do I add a budget"), false);
  assert.equal(asksForAFact("add a budget"), false);
});

test("a goal wants the way unless it asks a fact or how something works", () => {
  for (const goal of ["how do I add a budget", "add a budget", "where do I get an API key", "I lost the receipt for this, what do I do", "what should I click to add one", "set a budget for marketing, $50,000 a month", "freeze card"]) {
    assert.equal(wantsTheWay(goal), true, goal);
  }
  for (const goal of ["what does freezing a card do", "which budgets are over", "who approves meals over $150?", "how does freezing work", "how do approvals work", "how is mileage paid back", "explain per diems", "can I add a budget?", "why was this declined"]) {
    assert.equal(wantsTheWay(goal), false, goal);
  }
});

test("a sentence that does not tell the visitor to use the control is not caught at all", () => {
  assert.equal(verdict("how do I add a budget", budgets, "Don't press New budget again: your budget is already saved."), "nothing named");
  assert.equal(verdict("how do I add a budget", budgets, "Never click New budget twice, it makes two."), "nothing named");
  assert.equal(verdict("how do I add a budget", budgets, "Budgets shows each team's budget, and New budget is at the top."), "nothing named");
});

test("anything less plain is asked about again, not pointed at", () => {
  // The goal is done by the sentence's own account, though the control is the goal's.
  assert.equal(verdict("how do I add a budget", budgets, "The Budgets page is now open. To add one, use New budget at the top."), "ask New budget");
  // Something is missing, and the control is a way round it (toolshop: the right control was the Excavator entry).
  const rentals = page("/rentals", ["menuitem", "Contact"], ["link", "Excavator"]);
  assert.equal(verdict("I need to hire an excavator for three hours. How do I book that?", rentals, "This Rentals page lists Excavator, Bulldozer and Crane, but I can't see a booking button or form for them here. Use Contact in the top bar to ask about a three-hour hire."), "ask Contact");
  // Something else comes first.
  assert.equal(verdict("how do I add a budget", budgets, "Fill in the form, then click New budget."), "ask New budget");
  // Two controls.
  assert.equal(verdict("how do I add a budget", budgets, "Open People, or use New budget at the top."), "ask New budget");
  // "stuck" is never made a step.
  assert.equal(verdict("how do I add a budget", budgets, ownersStop, "stuck"), "ask New budget");
  // A control that only closes something.
  const dialog = page("/budgets", ["button", "Close"], ["button", "Budget settings"]);
  assert.equal(verdict("close the budget settings", dialog, "Click Close to shut the budget settings."), "ask Close");
});

test("on the first question nothing is an aside: it is pointed at or asked about, as before", () => {
  const home = page("/", ["link", "FAQ"], ["link", "Pricing"]);
  // joinhaptic, 3 runs in 3: the first reply named FAQ and pointed at nothing.
  assert.equal(verdict("What does Haptic see on my page?", home, 'The FAQ on the home page has an entry called "What does Haptic see on the page?". Click FAQ in the top bar to find it.', "done", 0), "ask FAQ");
  assert.equal(verdict("how do I add a budget", budgets, "If you want one, click New budget.", "done", 0), "ask New budget");
  assert.equal(verdict("how do I add a budget", budgets, "Click New budget at the top to add one.", "done", 0), "point New budget");
});

// Northpine's expenses, 16 November, two runs in three of "where do I upload a receipt for the
// Skyline Air charge": the first reply was "stuck", told the visitor to type into the search
// field, and the guide ended. One of them even had a target, on the "All" tab, which a "stuck"
// reply never shows.
const expenses = page("/expenses", ["button", "Search… ⌘K"], ["tab", "All"], ["tab", "Missing receipts 1091"], ["textbox", "Search expenses"]);
const receiptGoal = "where do I upload a receipt for the Skyline Air charge";

test("a field the sentence tells the visitor to type into is found by its name or as the page's one search box, and a stuck reply's target is no pointer", () => {
  const typing = "I don't see a Skyline Air charge in this list. Try typing Skyline Air in the Search expenses box, then open that charge to find the receipt upload area.";
  const searchBox = "I don't see a Skyline Air charge in the rows listed here. Click the search box above the table and type Skyline Air to find it, then open it to add the receipt.";
  assert.equal(namedButNotPointed(expenses, { target: null, status: "stuck", say: typing })?.label, "Search expenses");
  assert.equal(namedButNotPointed(expenses, { target: "e2", status: "stuck", say: searchBox })?.label, "Search expenses");
  // On the first question a stuck reply is asked about again, never pointed at in code.
  assert.equal(verdict(receiptGoal, expenses, typing, "stuck", 0), "ask Search expenses");
  assert.equal(verdict(receiptGoal, expenses, searchBox, "stuck", 0), "ask Search expenses");
  // A reply that points, and is not stuck, is not caught.
  assert.equal(namedButNotPointed(expenses, { target: "e4", status: "continue", say: searchBox }), undefined);
  // Pressing the key is not typing into the field (ui5: "press Enter in the Search box to apply the search").
  assert.equal(namedButNotPointed(expenses, { target: null, status: "done", say: "The list still shows all 10 orders, so press Enter in the Search expenses box to apply it." }), undefined);
  // With two fields whose names say they search, "the search box" is neither.
  const two = page("/expenses", ["textbox", "Search expenses"], ["searchbox", "Search people"]);
  assert.equal(namedButNotPointed(two, { target: null, status: "stuck", say: searchBox }), undefined);
  // Asked again, the model is told why nothing was pointed at.
  const field = expenses.elements[3]!;
  assert.match(namedButNotPointedNote(field, "stuck"), /^Your reply tells the visitor to use textbox "Search expenses" \(e4\), but its status is "stuck", so nothing is pointed at\./);
  assert.match(namedButNotPointedNote(field, "done"), /but its target is null, so nothing is pointed at\./);
  // Typing as an aside, once something is done, is left as it is.
  assert.equal(verdict(receiptGoal, expenses, "The receipt is attached. If you need another charge, type its name in the Search expenses box."), "aside Search expenses");
});
