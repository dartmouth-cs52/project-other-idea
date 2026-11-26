# Northpine for Mac, the Haptic test app

Northpine for Mac is a made-up spend management app, the native cousin of the [Northpine web app](../testbed/README.md). Acme Desk shows that HapticKit works on a small app. Northpine is here to show it still works on the kind of app a real company ships, so it is large on purpose, and it has every piece of Mac interface we know of that makes a pointing guide fail.

It has no server of its own. A seeded generator makes up a company of 60 people, 84 cards, 1,200 purchases, 96 bills and the rest when the app opens, and changes are kept in memory only. The same seed makes the same company to the cent and "today" is fixed at 1 June 2026, so a guide tried twice sees the same screens.

## Run it

```sh
# 1. The site for Northpine, and the Haptic server
mkdir -p data/sites && cp mac/northpine-site.json data/sites/site_northpine_mac.json
npm run build && npm run dev

# 2. The app, in another terminal
cd mac && swift run Northpine
```

Press **Ask** in the corner of the window and try "Why can't I pay Juniper Office Leasing?", "Export a trial balance" or "Where do I create an API key?". Or open the Help Center and press **Show me how** in any article.

The app asks `http://localhost:4000` unless `HAPTIC_SERVER` says otherwise.

## What is in it

Fourteen screens in five groups in the sidebar, a Settings window, sign-in and company setup, and a menu bar.

| Where | What makes it hard to point through |
|---|---|
| Home | Two boxes side by side, six View buttons with the same title, a feed that can be made to move |
| Cards, Expenses, Bills, People | Tables: many rows that look alike, buttons under the table that are off until a row is chosen, right-click menus |
| A card, an expense | A screen behind a row, with sliders, steppers, popovers and controls that only appear once another is switched on |
| Issue a card | A sheet of three steps, or four when the card is a physical one. Next is off until the step is filled in |
| Split an expense, New reimbursement | Rows that are added and removed, all with the same controls |
| Reimbursements, Budgets | Groups that fold. What is in a shut group is not on screen |
| Approvals, Vendors, Inbox, Help Center | A list beside what was chosen. The right side is empty until something is |
| Bills | Pay bill is off when the vendor is on hold, and the hold is a checkbox on another screen |
| Accounting | Four sections on segments, a tree that opens, ten pop-ups with no visible labels, a sync that takes a while, a button with six preconditions |
| Policies | Changes do nothing until Publish, at the other end of the screen |
| People | A grid of 28 checkboxes with no visible labels |
| The toolbar | Buttons that are only icons, a bell with a popover, a menu under the person's name |
| The menu bar | Go, Card and Help menus, and exports three menus deep under File |
| Settings | A second window with five panes |
| Command palette | A second way to reach everything |

## The Lab

A small window of switches (Window menu, or ⌥⌘L). Each changes the app in a way that has tripped up a pointing guide somewhere, so the same task can be tried against a different screen each time.

| Switch | What it does |
|---|---|
| Role | Admin, Finance, Manager or Employee. An employee is shown six screens of fourteen |
| Plan | Starter has no approvals, budgets or accounting |
| Rename the screens | Cards becomes Wallet, Bills becomes Payables, in the sidebar, the Go menu and the title bar. The screen's own heading and its path to Haptic stay as they were |
| Icons only | The sidebar is a strip of icons with no words on screen |
| A banner across the top | A strip with two buttons of its own on every screen |
| A live feed on Home | A box that adds a row every three seconds |
| Slow loading | A spinner for a moment between screens |

`LAB=renamed,icons,employee swift run Northpine` starts with switches on.

## Seeing what Haptic sees

```sh
swift run Northpine --dump              # every screen, one line for each control
swift run Northpine --dump cards        # one screen
swift run Northpine --dump issue-card   # a state behind a click: a sheet, a card, a pane of Settings
swift run Northpine --dump --json       # the snapshot that is sent, in full
```

A control with nothing between its quotes is one that needs an accessibility label.

## The site file

A website's outline is made by crawling it. Nothing crawls a Mac app, so Northpine does it to itself:

```sh
swift run Northpine --site > northpine-site.json
```

It walks every screen and every state behind a click, reads each as Haptic would, and writes the headings, buttons and fields. Rows of tables are never written down. The Help Center's articles become the site's docs, and the notes in `Site.swift` say how the app is laid out. Run it again after changing a screen and commit what it writes.

## Trying whole guides

`Tasks.swift` lists sixteen things a person might ask, each with a check read from the app's own state. `Autopilot.swift` follows the pointer by itself: it does what each step says and nothing more, so a guide that points at the wrong thing fails as it would with a person who trusts it. Every click is made inside the app, and the real mouse and keyboard are left alone.

```sh
HAPTIC_TASK=freeze-card swift run Northpine   # one task: prints each step, then PASS or FAIL
mac/scripts/replay-tasks.sh                   # all sixteen, with the server running
VERBOSE=1 mac/scripts/replay-tasks.sh hold-vendor
```

A task passes when the app ends in the right state and Haptic ended with "finished" or "shown". These call the model, so they are run by hand and not in CI. Keep the app in front while they run: the menu bar belongs to whichever app is in front.

With `claude-sonnet-5-5` on 25 November 2026, all sixteen passed in one run:

| Task | Asked | Steps |
|---|---|---|
| `go-budgets` | Where do I see how much of each budget is used? | 1 |
| `open-policies` | Show me our spending rules | 1 |
| `issue-card` | Start issuing a new card | 1 |
| `freeze-card` | Freeze the first card in the list | 3 |
| `missing-receipts` | Show me only the expenses that are missing a receipt | 2 |
| `close-books` | Take me to where I close the books for May | 2 |
| `mappings` | Where do I change which account travel is booked to? | 4 |
| `export-trial-balance` | Export a trial balance | 1 |
| `export-expenses` | Export all expenses as a CSV from the menu bar | 1 |
| `hold-vendor` | Why can't I pay Juniper Office Leasing? | 3 |
| `contact-support` | I want to message support | 5 |
| `api-keys` | Where do I create an API key? | 5 |
| `change-plan` | How do I see what plan we're on? | 3 |
| `renamed-cards` | Take me to our company cards (sidebar renamed) | 1 |
| `icons-people` | Where is the list of everyone in the company? (icons only) | 1 |
| `employee-approvals` | Where do I approve requests? (as an employee) | 0 |

These sixteen are not the benchmark. The benchmark in `eval/` has 565 frozen steps with known right answers and whole guides on real apps, all of it web, and HapticKit has not been through anything like it. Sixteen tasks on an app we wrote ourselves show that it works, not how often.

The last one takes no steps because the right answer is words: approvals are not part of an employee's role. One run is one run. The model's answers vary, and a task that passed here can fail on another day.

## What trying it found

Building Northpine was also the test. Each of these was found by reading a new screen with `--dump` or by running a task, and fixed in HapticKit:

- A sidebar's group titles ("Spend", "Payables") were listed as things to click.
- Every scrolling screen listed the scroll bar's own nameless buttons.
- Controls in two boxes side by side were all said to be under the second box's heading.
- Segments did not say what they choose between.
- A screen named `cards/card` reached the server as `/cards-card`.
- A tree's rows were read as headings, and the arrow that opens each had no name.
- Menu items three menus down were missing.
- Nineteen items macOS adds to the Edit menu were read on every step.
- A sidebar of icons with no words disappeared whole.
- A button that opens a menu left the person alone in the menu.
- A menu's titles were read as they were at launch, not as they are.

And two in Northpine itself that a guide could do nothing about: a checkbox squeezed until it reported a frame 19 points wide and 288 tall, and shortcuts on Home to screens the person's role cannot open.
