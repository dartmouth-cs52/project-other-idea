# Northpine, the Haptic test app

Northpine is a made-up spend management product, built to test Haptic on the kind of dashboard our buyers run. It has corporate cards, expenses, reimbursements, approvals, bill pay, vendors, accounting, reports, budgets, people, settings, a help center, and sign-in and onboarding pages, across about 60 routes. It's meant to look and behave like a real B2B app. It also includes, on purpose, every UI pattern we know of that makes a pointing guide fail.

It runs entirely in the browser. There's no backend:

- **Data.** A seeded generator builds 240 people, 320 cards, 10,000 transactions, 140 bills and the rest.
- **Changes.** Edits are kept in localStorage.
- **Network.** Delays and failures come from a test panel.

That makes it safe to put online as the live demo, because every visitor gets their own copy.

## Run it

```bash
cd testbed
npm install
npm run dev              # http://localhost:4200
```

## Try Haptic on it

The app adds Haptic the way a customer would, with one script tag pointing at `http://localhost:4000/widget.js` with site `site_testbed`. From the repo root:

```bash
npm run help:export --prefix testbed   # Northpine's help center as Markdown, in testbed/help-docs
npm run dev                            # the Haptic server on :4000
npm run tag -- --url http://localhost:4200 --id site_testbed --name Northpine \
  --notes testbed/haptic-notes.md --docs testbed/help-docs --allow http://localhost:4200 \
  --handoff-url http://localhost:4200/help/contact
```

Then reload the app and press Ask. The crawl only sees the empty HTML shell, because Northpine is a single-page app, like most dashboards. Haptic still reads each page live, and it gets the rest from three places, the way it would at a real customer:

- `haptic-notes.md` is the company's own map of the app, written the way a customer would describe it: every page, and what the top bar's menus hold.
- The help center's articles are in the app's code, where the crawl can't read them, so `help:export` writes them out as files to pass with `--docs`. With help docs, Answers is on, so a question like "what does freezing a card do" gets an answer in the panel with the article it came from.
- Real visits. The widget sends the labels of each page it loads on and what each menu, tab and accordion shows when opened, and on your machine one visitor is enough for them to count. They are kept in `data/learned.json` at the repo root, so they last across restarts. The quickest way to teach it the whole app is to replay the tasks with the widget on and the server running, `WITH_HAPTIC=1 npm run tasks:replay --prefix testbed`, which visits most pages and opens most menus. Delete `data/learned.json` to start again.

To load the app without Haptic, add `?lab.widget=0`.

## Online

Northpine runs at https://demo.joinhaptic.com with Haptic on, so anyone can open it and press Ask. Its site is `site_5a6c4cb3e840`, on the Haptic company's account in the dashboard, with `haptic-notes.md` as its notes and a limit of 60 steps per visitor a day. It was built with `npm run tag -- --url https://demo.joinhaptic.com --name Northpine --notes testbed/haptic-notes.md --visitor-steps 60` and made live with `npm run site:publish -- site_5a6c4cb3e840`. To change what Haptic knows, edit the notes and run both again with `--id site_5a6c4cb3e840`. The notes are Haptic's, not the app's, so changing them does not redeploy the app.

The app itself goes live on its own: every change to `testbed/` that lands on main is built, packed into the `northpine` Worker and deployed by `.github/workflows/deploy-demo.yml`, which then checks the demo serves the new build. A change to Markdown alone is skipped. `wrangler.jsonc` says how to deploy by hand.

## The test panel

The flask button at the bottom left, or Ctrl+Shift+L, opens the test panel. Every setting can also be set from the URL with `?lab.<name>=<value>`, which is how tasks open a page in a known state.

| Setting | Values | What it changes |
|---|---|---|
| `role` | admin, finance, manager, employee, auditor | Buttons turn disabled with a reason, and pages show less |
| `plan` | starter, growth, enterprise | Features show an upgrade prompt |
| `latency` | none, fast, slow, random | How long every load and save takes |
| `failureRate` | 0 to 0.5 | How often a load or save fails, to show error states |
| `nav` | classic, renamed, rail | Sidebar labels: "Expenses" becomes "Spend". In rail mode, the sidebar shows icons only |
| `locale` | en, es | The shell in Spanish |
| `theme` | light, dark, system | |
| `nativeDialogs` | 1 | Modals use `<dialog>.showModal()`, which makes the rest of the page inert |
| `liveFeed` | 1 | The home page keeps changing, so it never settles |
| `chatBubble` | 1 | Another company's support chat in the bottom right corner |
| `banner` | 1 | A fixed banner that covers the top of the header |
| `widget` | 0 | Load the app without Haptic |
| `seed` | any number | A different company |

"Reset data" forgets your changes. A few areas keep extra state of their own in localStorage, such as handbook versions and the close checklist, and the reset leaves those alone.

## Tasks

`src/tasks/` holds 179 benchmark tasks, one file per area. Each is a question a user would type, the page to start on, and for each step the controls that are right and what a visitor does next. They use the same shape as `eval/guide.ts`, so `eval/record.ts` can walk them once it's pointed at this app.

- 36 tasks open the app with a role, plan or layout setting.
- 27 tasks have "I can't do that here" as the right answer.
- Each task lists the traps it exercises in `covers`. `AGENTS.md` has the list of trap names.

To check that every task still plays against the current UI, run this with `npm run dev` going in another terminal:

```bash
npx playwright install chromium   # once
npm run tasks:replay              # every task
npm run tasks:replay -- cards     # tasks whose id contains "cards"
```

This doesn't involve Haptic. It only proves the tasks are playable. Clicks move the mouse in steps. Radix submenus close when the pointer jumps straight from the trigger to an item, so a plain `page.click()` can't reach "Theme > Dark". `eval/record.ts` will need the same treatment.

Some tasks depend on the default seed, 52. They name records by id, such as `card_0006q` for Avery's Team offsite card and `bill_000pi` for an overdue Brightdesk bill. Each task file says which records it uses.

## What's not covered yet

- `data-infinite`: no list scrolls infinitely yet.
- `data-empty`: lists have empty states, but no task asks about one yet.
- `layout-mobile`: the app works on a phone, but tasks can't set a viewport yet.
- `overlay-context-menu`: the approvals board and the card grid have right-click menus, but a task can't right-click. The act format only has click, fill, select and check.
- `nav-collapsed-group`: sidebar groups fold. That state lives in localStorage, and no URL setting controls it.
- **Bundle size.** The build is 823 KB gzipped, mostly the data generator and the chart and editor libraries. Splitting it by route would make the live demo load faster.

## Working on it

Read `AGENTS.md` first. It covers the layout, the component kit, the rules, and the full list of traps with their names.
