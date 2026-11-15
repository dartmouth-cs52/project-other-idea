# The benchmark

A fixed set of questions with known right answers, on Haptic's own demo and on real web apps, and commands that run any model against them. It answers three things:

- **Does Haptic work on software like our customers'?** Most of the cases come from real apps of the kinds large companies run. Where the widget cannot see the control a visitor needs, that is counted against Haptic and not left out.
- **Does a visitor get where they wanted to go?** Whole guides are run start to finish in a browser, with the model giving every step.
- **Which setup is best?** Several models and settings are compared on how often they point at the right control and how long a step takes.

## What is in it

181 guides and 565 steps. 448 of the steps are on twelve real apps.

| Case file | What it is | Stands for | Guides | Steps |
|---|---|---|---|---|
| `demo` | Haptic's own demo app | a ceiling, not a forecast | 14 | 56 |
| `joinhaptic` | joinhaptic.com | a simple public site | 6 | 17 |
| `hard` | The demo app again | off-topic and hostile questions, planted text, controls that delete, questions asked badly | 36 | 44 |
| `ui5` | SAP's OpenUI5 demo apps | SAP software | 11 | 40 |
| `antdpro` | Ant Design Pro's preview | internal admin consoles | 11 | 40 |
| `orangehrm` | OrangeHRM's demo | HR systems | 11 | 40 |
| `toolshop` | Practice Software Testing's Toolshop | stores and checkouts | 11 | 40 |
| `parabank` | ParaBank | banking and old-style forms | 9 | 40 |
| `grafana` | Grafana Play | dashboards | 11 | 40 |
| `backstage` | Backstage's demo | developer portals | 11 | 37 |
| `jira` | The Apache Software Foundation's Jira | issue tracking | 11 | 40 |
| `wikipedia` | English Wikipedia | very large pages | 11 | 35 |
| `espocrm` | EspoCRM's demo (held out) | CRM | 11 | 40 |
| `gitlab` | A public project on GitLab.com (held out, recorded in part) | DevOps platforms | 8 | 23 |
| `moodle` | Moodle's demo school (held out, recorded in part) | learning systems | 9 | 33 |

The real apps are public demos and public sites, used the way a visitor would. On a site other people use, no guide saves, sends or deletes anything. The case files hold what those public pages showed.

Several guide files carry workarounds for faults in the widget as it is today, most of them to do with when it asks for a step: `orangehrm`, `parabank`, `wikipedia`, `backstage`, `ui5` and `toolshop`. They are switched on only while recording. So the single-step cases for those apps show the widget at its best, and the whole-guide runs, which use none of them, show what a visitor gets. The workarounds come out when the widget is fixed.

## Results

Measured on 15 November 2026 against the live server: Claude Sonnet 5.5, thinking on, low effort. Every case and every guide was run once.

| | Single steps right | Whole guides that got there |
|---|---|---|
| `demo` | 56/56 | 13/13 |
| `joinhaptic` | 15/17 | 4/5 |
| `hard` | 39/44 | 3/3 |
| `ui5` | 31/40 | 5/10 |
| `antdpro` | 35/40 | 7/10 |
| `orangehrm` | 34/40 | 5/9 |
| `toolshop` | 32/40 | 5/10 |
| `parabank` | 38/40 | 3/8 |
| `grafana` | 33/40 | 7/10 |
| `backstage` | 32/37 | 4/9 |
| `jira` | 37/40 | 6/10 |
| `wikipedia` | 27/35 | 3/9 |
| **Nine real apps** | **299/352 (85%)** | **45/85 (53%)** |
| `espocrm` (held out) | 31/40 | 8/10 |
| `gitlab` (held out) | 23/23 | 8/10 |
| `moodle` (held out) | 29/33 | 5/9 |
| **Three held-out apps** | **83/96 (86%)** | **21/29 (72%)** |

On Haptic's own sites a step is right 97% of the time and nearly every guide finishes. On real apps a step is right about 85% of the time and about half the guides finish. That gap is the finding.

Of the 53 single steps missed on the nine apps:

- 17: the widget never listed the right control, so no model could have pointed at it.
- 17: it pointed at something when nothing should have been pointed at. Ten came after the goal was reached, and seven were for things the app cannot do.
- 19: it pointed at the wrong control. Four of those were between controls listed word for word the same.

Of the 40 guides that did not get there:

| Why | Guides |
|---|---|
| The model was shown an empty or half-drawn page | 7 |
| The widget never heard a pick or a click, and stopped asking | 6 |
| The widget dropped the pointer, taking two fields with no name for one | 4 |
| The guide ends on a control the widget cannot list | 2 |
| The model called it done a step or more early | 8 |
| The model gave up, or answered in words | 7 |
| It went in circles | 4 |
| The runner could not use a dropdown (a fault in this tool, since fixed) | 2 |

So about half the guides that failed were lost to the widget before the model had a fair chance.

By kind of case, on the nine apps: ordinary tasks 181/217, wrong clicks 31/34, questions asked badly 59/63, risky 26/29, things the app cannot do 2/9. On the `hard` set: text planted on the page was followed 0 times in 10, and two of six off-topic questions were answered before being declined ("Paris", "391").

Read this with care:

- Everything was run once. A guide that fails one time in three looks the same here as one that always fails.
- The whole-guide runs use live sites, some of them shared demos that other people change.
- After these runs a fault was found in the runner: it checked the address a guide should end on before the last click's page had loaded. It is fixed. A few guides above may have been failed by it.
- The strict rule on a case that expects nothing counts a model that points at where to look as wrong.

### Earlier: choosing the model

Two runs on 15 November 2026: all 74 cases, each asked once, from a GitHub runner, at low effort.

The second run is the one the live server's setting comes from. Thinking is on unless the setting ends in `@off`.

| Setting | Right pointer | Plausible range | Status agrees | Clean sentence | ms to pointer | Typical ms | Slow ms |
|---|---|---|---|---|---|---|---|
| `claude-opus-5-5` | 72/74 (97%) | 91-99% | 99% | 100% | 1318 | 1720 | 2164 |
| `claude-sonnet-5-5` | 73/74 (99%) | 93-100% | 95% | 100% | 831 | 1449 | 1700 |
| `claude-haiku-5-5` | 73/74 (99%) | 93-100% | 96% | 100% | 949 | 1078 | 1812 |
| `claude-haiku-5-5@off` | 70/74 (95%) | 87-98% | 92% | 100% | 901 | 1054 | 1455 |

The three misses by Opus and Sonnet were all at the end of a guide: each pointed at something more when nothing was left to do. Haiku's miss with thinking on was inside a guide: it pointed at nothing when the right control was listed, which leaves a visitor with nowhere to go. With thinking off it did that twice and skipped required fields twice.

The live server runs Sonnet with thinking on, at low effort. It scored as well as anything in the table, named the control about half a second sooner than Opus, costs about half as much per step, and gave 17 clean sentences out of 17 when it was tried on the live server. Haiku with thinking on is the one to watch: the same score and the quickest whole step, but on one run, with the one miss that would strand a visitor. It needs more cases, and cases from apps behind a login, before it goes live.

The first run compared Opus with the other two with thinking off, and did not yet look at the sentence:

| Setting | Right pointer | Plausible range | Status agrees | ms to pointer | Typical ms | Slow ms |
|---|---|---|---|---|---|---|
| `claude-opus-5-5` | 72/74 (97%) | 91-99% | 99% | 1140 | 1626 | 2180 |
| `claude-sonnet-5-5@off` | 73/74 (99%) | 93-100% | 92% | 1154 | 1587 | 1869 |
| `claude-haiku-5-5@off` | 69/74 (93%) | 85-97% | 89% | 884 | 1076 | 1701 |

Sonnet with thinking off looked like the pick from that table, and it was switched on. Asked the 17 joinhaptic.com cases on the live server, it ended two sentences with a stray closing brace and left blank lines after several more. With thinking left on, Sonnet and Opus each gave 17 clean sentences out of 17 and were no slower. So thinking off bought no speed and damaged the text, and the table did not show it. That is why the table now has a clean sentence column, and why the server tidies every sentence before it is sent.

Read this with care. Each run asked every case once, the ranges of the top three overlap, and the timings are from GitHub's runner at one time of day. A case that expects nothing is also strict: a model that ends a guide by pointing at where the answer is counts as a miss.


## Two ways of measuring

**Single steps** (`npm run eval`). A case is one step of one guide, frozen: the page as the widget saw it, the question, what had happened so far, and which controls are a right answer. A guide of five steps is five cases. Every case starts from the right page, so this isolates one decision, runs in seconds per case, needs no browser, and gives the same input to every model. Cases live in `eval/cases/`, one JSON file per site, and each file carries the site's context, because that is part of what the model reads.

**Whole guides** (`npm run eval:guides`). A browser opens the site, asks the question in the real widget, and does whatever the pointer shows, the way a visitor who trusts it would. It is scored on one thing: did the visitor end up where they wanted to be. A wrong step is not corrected for the model, and a guide of six steps needs all six. This is slower and its pages are live, so two runs are never quite the same, but it is the number a customer would recognise.

Both use the same guide scripts in `eval/guides/`.

## Kinds of case

Every case has a kind, and the tables break the score down by it.

| Kind | What it tests |
|---|---|
| `task` | An ordinary how-do-I question with a way through. |
| `wrong-click` | The visitor clicked something other than what they were shown. Off the way, the reply must start "Not that one." On another way to the same place, it must not. |
| `no-answer` | The site has no such thing, so nothing should be pointed at. |
| `off-topic` | Nothing to do with the site: point at nothing, and do not answer the question. |
| `hostile` | The question, or text someone left on the page, tries to give the model orders. |
| `risky` | The way through ends on, or passes, a control that deletes, pays or sends. |
| `awkward` | Typos, another language, a vague question, two questions in one. |

`eval/guides/hard.ts` holds the off-topic, hostile, risky and awkward cases on the demo app. The demo shows its planted text only at addresses ending in `?planted`.

## Running single steps

```bash
npm run eval -- --models mock
```

`mock` is the keyword matcher. It needs no key and costs nothing, and it gets about four cases in ten right, so that is the floor a real model has to clear.

```bash
npm run eval -- --models claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5 --repeat 3 --yes
npm run eval -- --server https://widget.joinhaptic.com --yes
```

`--models` calls each model from this machine, through the same code as the live server, so the setup that wins is switched on with `HAPTIC_MODEL`, `HAPTIC_EFFORT` and `HAPTIC_THINKING`. Each model can take settings after `@`: `low`, `medium` or `high` for effort, and `off` for no thinking before the answer. It needs `ANTHROPIC_API_KEY`.

`--server` asks a Haptic server that is already running. It needs no key here, and it measures the setting visitors actually get. Each site has to be on that server first (`npm run site:publish -- <site id>`), and it stays under the server's limit of 30 steps a minute on a site, so it is slower.

Every call is billed either way, so without `--yes` the command only prints how many calls it would make. `--cases demo,ui5` runs some of the files, `--split held-out` or `--split tuned` runs one side of the split below, and `npm run eval -- --help` lists the rest.

With no key to hand, start the **Benchmark** workflow from the repository's Actions tab. It runs the same commands on GitHub. The setup is at the top of `.github/workflows/benchmark.yml`.

### Reading the tables

- **right pointer** is the score: the pointer went to a right control, or to nothing when nothing was left.
- **plausible range** is where the true score could lie given how many cases there are. Two models whose ranges overlap have not been told apart.
- **when the control was listed** is the score with the steps taken out where the widget never listed the right control. The gap between the two is what the widget costs, whichever model is used.
- **status agrees** is reported beside the score and is not part of it, because models differ on whether a guide's last click is "continue" or "done".
- **clean sentence** is how often the model's sentence could be shown as written. The server tidies every sentence, so a visitor never sees the difference, but a low figure means the setting is fighting the reply's format. It is not known when a server answered.
- **typical ms** is the middle step, start to finish. **slow ms** is the step that nine in ten are faster than. **ms to pointer** is how long until the model had named the control, which is when the pointer starts to move. Compare timings only within one run: the service's speed drifts from hour to hour.
- **What the widget gave the model to work with** has nothing to do with the model: how many controls a page had, how many pages were cut at the widget's limit of 300, how many controls had no name, and on how many steps the right control was not listed at all.
- **followed planted text** counts the hostile cases where the pointer went where text on the page told it to.
- With `--repeat`, **right every time / sometimes / never** shows how steady each model is. A case that is right two times in three is a visitor sent the wrong way one time in three.

Every answer from a run is written to `eval/results/`, which is not committed.

## Running whole guides

```bash
npm run eval:guides -- demo hard --server https://widget.joinhaptic.com
npm run eval:guides -- ui5 toolshop --model claude-sonnet-5-5 --repeat 3 --parallel 2
```

Each run ends one of these ways:

| End | Meaning |
|---|---|
| reached | The visitor ended up where the guide's script says they wanted to be, or, for a question that asks for a fact, was told the true answer. |
| stopped short | The model said it was done, or had nothing to point at, somewhere else. |
| went in circles | It was still giving steps four past the length of the script, and on the way pointed again at a control already used on a page that looked the same. |
| ran long | It was still giving steps four past the length of the script, each on something new. |
| stalled | The widget stopped asking for steps: it gave up, what the visitor did never registered, or the control could not be reached at all. |
| cut short | On a site other people use, it pointed at a control that could send, buy, save or delete, and the run stopped before pressing it, or a step set off a request that would have written to the site, which was stopped. |
| error | The benchmark could not tell: the site was down, sign-in was refused, the model or the server failed. |

An "error" says nothing about Haptic (the site was down or refused the run), so it is left out of the rate and counted beside it. A run "cut short" counts as not reached: Haptic led the visitor somewhere the script never goes on that site, which is sometimes another good way but more often a wrong one, and the benchmark cannot tell which. Each is listed so it can be read by hand. However a run ends short of the goal, the line says what the widget was showing.

A guide is reached in one of these ways, and the guide file says which (`eval/guide.ts` has the types):

- `reached`: the page shows what it should (an address, a text, a selector) and, with `absent`, no longer shows what the visitor wanted rid of.
- A last step with no `act`: the guide is over when the model points at that control, the one that would save or send. With `given`, only while the page is as `given` says, for a filter that must be set before the visitor is shown Search.
- `says`, for a question that asks for a fact: the last sentence gives the true answer. This reaches the guide as fully as the walk-through. Where the answer can change it is read from the page, when the guide starts or when it ends, and never written into the script; so are wrong answers the sentence must not name. A sentence that hedges ("it may be", "check whether") never passes. A "done" that points at where the answer is, with the answer said, is judged and not clicked. These runs have the kind "answer", and the table also gives the rate without them, as a check that a rise is honest.

A guide set with a guide that no run could ever score as reached is refused, with the guide named.

**What the visitor does.** It uses each control the way a person would (`eval/visitor.ts`): it presses with the real mouse, types key by key, opens a list and picks from it what the sentence names when the widget stays quiet, and types what the script or the sentence says before anything of its own. A control under its own label or row is pressed at its middle; only something unrelated on top counts as **control covered**, and a control no part of which can be reached is a result in itself. `--visitor old` runs the visitor as it was before this (fill on every input, "Test", the second entry of every dropdown, a click by script when covered), for one release, so that a rise in the score can be split into the benchmark's share and the product's.

**Following the widget.** A widget that reports `guideState` on its host element looks once more after "done" with a pointer, and the runner waits for that before judging. A "continue" with no pointer while it is "watching" means "do this": the runner presses the key the sentence names, or says in the log that it could not do what was asked. With no `guideState`, a "done" with a pointer ends the guide as before.

Under the table, **on the way** shows what the rate hides: steps against the script, runs that ended on "done" with a pointer, runs where the model said done and the script says the visitor is not there, passes by the answer in words, passes that then pointed at more, passes after asking for something already done, answers the widget set aside when it asked again for the same step, closing questions, and questions asked only because the visitor scrolled (a step can ask the visitor to scroll first with `scrollFirst`).

`--trace` writes, beside the results file, the whole request the widget sent at every answer (the controls, the event, the history, the page text), the message this checkout's server would build from it, the reply, and what the visitor did.

The demo app's pages need the local server (`HAPTIC_MODEL=mock npm run dev`). A guide of one step is skipped, because the single-step case already covers it.

It drives a browser with Playwright, which this project does not install: `npm install --no-save playwright && npx playwright install chromium`.

## Nothing is written to a site other people use

Twice a whole-guide run did something on a live site that it should not have: it typed made-up sign-in details into a public Jira, and it pressed a "Copy link" that makes a short link on the server. A list of risky words on buttons cannot catch the next one, so there is a net under it (`eval/net.ts`).

On every guide set that is not marked `sandbox: true`, each request a page makes is looked at before it leaves the browser, in whole-guide runs, in the recorder and in `eval:look` alike:

- A plain read (GET, HEAD, OPTIONS) goes through.
- Anything else goes through only when it is known to read: a GraphQL request whose every operation is a query, a request the guide set lists in `reads` (a search or a chart's query that the site sends as a POST), or what the set's own `before` sends to sign in.
- Everything else is stopped inside the browser and never reaches a server.

Most of what is stopped is the page talking to itself: usage counts and error reports, sent to another site, sent as a beacon, or listed in the set's `chatter`. A stopped request to the site itself that nobody has vouched for is different. After something the visitor did, it is taken for the step trying to write, and the guide ends "cut short" with the request named. Before the visitor did anything, the page may be missing something it needs, so the guide ends as an error that says what to add to the guide set. The first counts as not reached; the second is left out of the rate.

Every request let through or stopped is in the results file (method, host and path, never the query or the body), the table has three columns for them, and under the table each site's unvouched-for requests are listed. "sent: tried to write" should be 0. When it is not, read the line under the table the same day.

To find what a site needs, look at its pages with no model: `npm run -s eval:look -- grafana "/d/000000016/time-series-graphs"` prints what was let through and what was stopped after the list of controls. Put a request in `reads` only when it cannot save, send, create or delete anything.

Two limits. Messages sent over a WebSocket that is already open are counted and not stopped. And service workers are switched off on these sites, so that none can send what the net does not see.

### What needs recording again

These guide files no longer match what the widget sends, and are not recorded again until the widget work under way has settled. The whole-guide runs do not depend on them.

- `parabank`: its matchers describe the widget before it was reworked.
- `ui5`, `wikipedia`, `toolshop` (five marks) and `orangehrm` (the chip's cross, the sort arrows): `unlisted` marks on controls the widget now lists. Toolshop's `{ label: "Excavator" }` no longer fits, and orangehrm's unnamed fields are now named.
- The guides whose scripts changed on 15 November 2026: antdpro `rule-template` and `basic-form`, grafana `find-panel-data`, jira `export-spreadsheet` (new start), orangehrm `new-department` and `rejected-leave`, toolshop `buy-circular-saw` (new question) and `pay-in-instalments`, and the toolshop guides that name the signed-in customer.

## The held-out split

A prompt adjusted until its own test set passes proves little. So part of the benchmark is **held out**: whole apps (`heldOut: true` on the guide set) that the prompt and the widget are never adjusted against.

The rule: look at failures, and change the prompt or the widget because of them, only on the tuned side. Run the held-out side to see whether a change carried over, and read its score, not its misses. Once a held-out miss has been used to make a change, that app is no longer held out, and a new one has to take its place.

## Adding a site

1. Look at it the way the widget does: `npm run eval:look -- https://app.example.com/some/page`. This prints every control the widget would list, with the role, label, icon, link and surroundings it gives each. Add `--do "click:<selector>"` to open a menu or a dialog first.
2. Build its context: `npm run tag -- --url https://app.example.com --id site_bench_example --name Example`. It reads the site in a browser when Playwright is installed; see "A map of the site" below, including how to read pages behind a sign-in.
3. Write `eval/guides/example.ts`: for each guide, the question, the controls that are right at each step, and what a visitor does next. `eval/guide.ts` has the types. A guide that ends with `DONE` says how to tell the visitor got there (`reached`). A guide that must not press its last button leaves that step without an `act`.
4. Record it: `npm run eval:record -- example`. The recorder walks the site in a browser with the real widget, answers each step from the script, checks the guide really ends where `reached` says, and saves what the widget sent as `eval/cases/example.json`. No model is called and nothing is sent to a server. Record again whenever the widget changes what it sends.

Three rules keep it honest:

- **Write a guide from what a visitor has to do, not from what the widget lists.** When the right control is on the page and the widget does not list it, keep the step and mark it `unlisted: true`. It then fails for every model, which is the truth. When the widget is fixed, the recorder says the mark can come off.
- **`expect` holds every control that is a right next step**, so a model is not failed for another valid route.
- **Ask the way a visitor would**, mostly without the words on the control.

On a site other people use, a guide never saves, sends or deletes: it stops before that control. A site whose data is made up and seen by no one else is marked `sandbox: true`, and guides there may finish what they start.

## A map of the site

Besides the live page, the model is given at every step what Haptic knows about the rest of the site: a map of its pages and what is on each, and any notes and help pages the owner supplied. `npm run tag` builds it.

**How the map is read.** With Playwright installed, `npm run tag` loads each page in a browser, waits until the list of controls stops growing, and reads the page with the widget's own reading, so the map names controls the way the model sees them live. It loads pages and follows links, and nothing else: it never clicks, types, submits or focuses anything. It does not load a link that signs in or out, whose address names an action (delete, reset, share, export and the like), sends a form (`/cart/add/12`, `?add-to-cart=12`) or carries a token, nor anything off the site. A page reached through the page's navigation is always read; pages of records (a table row, a card, an address with an id) are read two of a kind, and a page's body gives at most eight links to follow. The map leaves out the page's data: controls inside rows and cards, and the title and headings of a record's own page. It is held under 8,000 characters by dropping the farthest and costliest pages. Without Playwright, or with `--reader text`, it reads the HTML the server sends, which is all there is for apps that draw themselves in the browser.

**Pages behind a sign-in.** `--session <file>` hands the reader a signed-in browser session, in Playwright's storage-state format. For the benchmark's demo accounts, `npx tsx eval/signin.ts <guide set>` signs in the way the guides do and saves one in `data/sessions/`, which is never committed. Sessions lapse: Toolshop's and OrangeHRM's lapsed within about half an hour, so sign in just before reading. `--hide` keeps the signed-in account's name out of the map. For a real customer there is no way yet to be given a session: the customer would have to sign a test account in and send the file, which is a credential, and nothing stores it safely or renews it when it lapses.

**What it cannot reach.** Pages that are only reached by a click (UI5's lists, menus that draw their entries only when opened, as Ant Design Pro's does) are not found, because the reader never clicks. `--also` names more pages to start from.

**The maps of the nine apps** are in `eval/sites/<app>.map.json`, and for Grafana, Jira and OrangeHRM a second version with help pages, `<app>.docs.json`. Each is the site file that was live with only its pages (and help pages) replaced. OrangeHRM, Toolshop and ParaBank were read signed in as the guides sign in; ParaBank's Admin Page and web-service pages were left alone (`--skip`). Wikipedia was read one link deep from one article, without the random-article link: a map of all of Wikipedia means nothing, and the tools around an article and the site's own pages are what its guides need. The case files keep the site file the single-step benchmark has always used.

| app | as it was: pages, characters of map | map: pages, characters | system prompt (rules and site) in characters: as it was, with map, with help pages |
|---|---|---|---|
| ui5 | 2, 114 | 2, 648 | 3,186, 3,720 |
| antdpro | 1, 19 | 5, 1,363 | 3,092, 4,436 |
| orangehrm | 1, 43 | 21, 4,737 | 3,111, 7,805, 21,177 |
| toolshop | 3, 577 | 15, 4,226 | 3,672, 7,321 |
| parabank | 3, 1,633 | 14, 2,368 | 4,700, 5,435 |
| grafana | 1, 12 | 22, 7,721 | 3,083, 10,792, 56,243 |
| backstage | 1, 82 | 30, 7,168 | 3,150, 10,236 |
| jira | 8, 1,613 | 15, 7,719 | 4,680, 10,786, 52,056 |
| wikipedia | 8, 17,864 | 7, 7,187 | 20,932, 10,255 |

UI5 and Ant Design Pro stay small: their pages are reached by clicks the reader does not make.

To put a version live:

```bash
cp eval/sites/grafana.map.json data/sites/site_bench_grafana.json
npm run site:publish -- site_bench_grafana
```

### Does a map help? Measured on 15 November 2026

Each guide below was run three times against the live server (Claude Sonnet 5.5) with each version of its app's site file: as it was ("now"), with the map ("map"), and, for the three apps with public help pages, with the map and help pages ("docs"). The first five are the guides where the model had been seen to choose a wrong route; the rest are two guides per app that were passing, as a guard. OrangeHRM's three guides were run three times more both as it was and with the map, because 7 of the 9 OrangeHRM runs with the map were lost at the first click, when the page reloaded under the runner; both rounds are counted below.

| app | guide | now | map | docs |
|---|---|---|---|---|
| grafana | firing-alerts | 3/3 | 2/3 | 3/3 |
| grafana | share-link | 2/3 | 3/3 | 3/3 |
| jira | backlog-chart | 3/3 | 3/3 | 3/3 |
| orangehrm | rejection-emails | 3/6 | 3/6 (3 lost by the runner) | 3/3 |
| toolshop | rent-excavator | 0/3 | 2/3 | |
| antdpro | new-rule, operation-log | 5/6 | 6/6 | |
| backstage | docs-page, star-and-filter | 6/6 | 6/6 | |
| grafana | explore-promql, legend-then-fullscreen | 6/6 | 6/6 | 6/6 |
| jira | only-one-project, table-view-and-sort | 6/6 | 5/6 (1 server error) | 6/6 |
| orangehrm | new-hire, rejected-leave | 10/12 | 8/12 (4 lost by the runner) | 6/6 |
| parabank | open-savings, update-phone | 2/6 | 3/6 | |
| toolshop | filter-hammers, latest-order | 6/6 | 6/6 | |
| ui5 | group-orders, search-product | 6/6 | 6/6 | |
| wikipedia | appearance, recent-changes | 5/6 | 6/6 | |
| **all** | | **63/78** | **65/78** | **30/30** |

Leaving out runs the runner lost (a server error, or a control it could not click): now 63/75, map 65/70, docs 30/30.

What the map changed, guide by guide:

- **toolshop rent-excavator**, 0/3 to 2/3. Without a map the model looked at the home page, found no rentals and told the visitor the shop has none, three times out of three. With a map that lists a Rentals page, it went looking (first in the account menu, then under Categories) and found it.
- **orangehrm rejection-emails**: the first click went to Admin, the right section, 4 times in 6 as it was and 5 in 6 with the map. With the help pages it went to Leave first 3 times in 3: the pages given were about leave, and pulled it there. It recovered every time.
- Grafana's and Jira's route-choice guides already chose the right route as they were (8 of 9), so there was nothing for a map to fix there.
- No guard guide got worse that can be put on the map.

Time to the pointer, every step: middle 1,696 ms as it was, 1,568 ms with the map, 1,624 ms with help pages; nine in ten under 2,455, 2,212 and 2,245 ms. The map runs came later in the evening, so read this as no measured cost, not as a gain. The server marks the rules and site knowledge for caching. The rules alone are about 800 tokens, which may be under the smallest prompt the service caches, so a map may even make the cache start working. That was not measured here: the live server does not report tokens.

Read this with care: three runs per guide tells apart only large effects, the sites are live, and the help pages were chosen with the guides in view, which makes the docs column a best case.

The judgement. A map built this way did no measurable harm and adds up to about two thousand tokens a step (650 to 7,800 characters), which the server marks for caching. It helped clearly on one kind of question, where the visitor asks for something that is not on the page they are on, and without a map the model concludes the site does not have it. That kind of failure is cheap to fix this way, so the map should be on by default, built in a browser. Help pages, given whole, added 13,000 to 45,000 characters (three to eleven thousand tokens) a step, showed no gain the map did not already give, and steered OrangeHRM's first step wrong. They should wait until they are looked up by question.

## Cases from real sessions

A scripted guide tests what its author thought of. Real sessions test what people actually ask, on the pages they were on.

```bash
HAPTIC_RECORD=1 npm run dev                                       # every step is appended to data/recordings/<site id>.jsonl
npm run eval:import -- data/recordings/site_ab12cd34ef.jsonl --name acme
```

The importer drafts a case from each recorded step. What the model pointed at is filled in as the expected answer, and that is the very thing in question, so every draft is marked `"reviewed": false` and left out of runs until someone who knows the site has checked it, corrected `expect` and set `reviewed` to `true`.

A recording holds visitors' questions and the names of the controls on their pages. The importer masks emails and long numbers in the questions. Read every question before committing the file all the same: a name can be typed into a question too.

The live server does not record. For real sessions to become cases, it would have to keep, for the steps it samples, the list of controls it was sent along with the question and the reply. That list holds control names and short page text, never what anyone typed, but it is page content, so it needs the customer's agreement and belongs in the logging design.

## What this does not measure yet

- **Customers' own apps.** The real apps here are public demos and public sites. They are far closer to enterprise software than the demo app was, and they are still not a customer's app, with its own data, its own conventions and whatever its developers did to the page.
- **Apps the widget cannot enter.** Pages drawn on a canvas, and apps inside an iframe, are not read at all.
- **People.** A simulated visitor does exactly what the pointer shows. Real ones misread, hesitate and give up. How well "right pointer" predicts that a person finishes the task has not been measured by anyone.
- **Whether the sentence is true.** It is checked for words it must or must not contain, and for format. Nobody reads it.
- **More than one run.** Each case is asked once unless `--repeat` says otherwise, and timings are from one machine at one time of day.
