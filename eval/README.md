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
| reached | The visitor ended up where the guide's script says they wanted to be. |
| stopped short | The model said it was done, or had nothing to point at, somewhere else. |
| went in circles | It was still giving steps four past the length of the script. |
| stalled | The widget stopped asking for steps: it gave up, or what the visitor did never registered. |
| cut short | On a site other people use, it pointed at a control that could send, buy, save or delete, and the run stopped before pressing it. Left out of the rate, since it shows nothing either way. |

**control covered** counts the steps where the caption or something else sat on top of the control, so a visitor could not have clicked its middle. The demo app's pages need the local server (`HAPTIC_MODEL=mock npm run dev`). A guide of one step is skipped, because the single-step case already covers it.

It drives a browser with Playwright, which this project does not install: `npm install --no-save playwright && npx playwright install chromium`.

## The held-out split

A prompt adjusted until its own test set passes proves little. So part of the benchmark is **held out**: whole apps (`heldOut: true` on the guide set) that the prompt and the widget are never adjusted against.

The rule: look at failures, and change the prompt or the widget because of them, only on the tuned side. Run the held-out side to see whether a change carried over, and read its score, not its misses. Once a held-out miss has been used to make a change, that app is no longer held out, and a new one has to take its place.

## Adding a site

1. Look at it the way the widget does: `npm run eval:look -- https://app.example.com/some/page`. This prints every control the widget would list, with the role, label, icon, link and surroundings it gives each. Add `--do "click:<selector>"` to open a menu or a dialog first.
2. Build its context: `npm run tag -- --url https://app.example.com --id site_bench_example --name Example --max-pages 8`.
3. Write `eval/guides/example.ts`: for each guide, the question, the controls that are right at each step, and what a visitor does next. `eval/guide.ts` has the types. A guide that ends with `DONE` says how to tell the visitor got there (`reached`). A guide that must not press its last button leaves that step without an `act`.
4. Record it: `npm run eval:record -- example`. The recorder walks the site in a browser with the real widget, answers each step from the script, checks the guide really ends where `reached` says, and saves what the widget sent as `eval/cases/example.json`. No model is called and nothing is sent to a server. Record again whenever the widget changes what it sends.

Three rules keep it honest:

- **Write a guide from what a visitor has to do, not from what the widget lists.** When the right control is on the page and the widget does not list it, keep the step and mark it `unlisted: true`. It then fails for every model, which is the truth. When the widget is fixed, the recorder says the mark can come off.
- **`expect` holds every control that is a right next step**, so a model is not failed for another valid route.
- **Ask the way a visitor would**, mostly without the words on the control.

On a site other people use, a guide never saves, sends or deletes: it stops before that control. A site whose data is made up and seen by no one else is marked `sandbox: true`, and guides there may finish what they start.

## Cases from real sessions

A scripted guide tests what its author thought of. Real sessions test what people actually ask, on the pages they were on.

```bash
HAPTIC_RECORD=1 npm run dev                                       # every step is appended to data/recordings/<site id>.jsonl
npm run eval:import -- data/recordings/site_ab12cd34ef.jsonl --name acme
```

The importer drafts a case from each recorded step. What the model pointed at is filled in as the expected answer, and that is the very thing in question, so every draft is marked `"reviewed": false` and left out of runs until someone who knows the site has checked it, corrected `expect` and set `reviewed` to `true`.

A recording holds visitors' questions and the names of the controls on their pages. The importer masks emails and long numbers in the questions. Read every question before committing the file all the same: a name can be typed into a question too.

The live server does not record. For real sessions to become cases, it would have to keep, for the steps it samples, the list of controls it was sent along with the question and the reply. That list holds control names and short page text, never what anyone typed, but it is page content, so it needs the customer's agreement and belongs in the logging design.

## Checking every kind of control in the toolkits customers use

```bash
npm run eval:toolkits                         # every toolkit, every kind of control
npm run eval:toolkits -- antd select          # one toolkit, one kind (or one demo by name)
npm run eval:toolkits -- --widget ../other    # the widget from another checkout
npm run eval:toolkits -- --table eval/toolkits/results/<file>.json --compare eval/toolkits/results/<earlier>.json
```

Most customers' apps are built from a handful of UI toolkits, and most faults found so far belong to a kind of control, not to one app. This suite opens each toolkit's own public demo of each kind of control, puts the widget in the page the way the whole-guide runs do, and checks it with no model and no server: every step's answer is scripted. A run takes about half a minute a demo and costs nothing.

For each demo it checks:

- **Listed.** The controls a visitor could use in the demo, by the browser's accessibility tree (a second opinion that does not come from the widget's code), against the widget's list. Each entry in the list is tied to its element by running the widget's own reader beside it, and a missing control is checked again with the list's length limits lifted, to tell "cut by the limit" from "never read". It also reports controls listed with no name, and controls whose whole line is the same as another's.
- **Heard.** The scripted answer points at a control. A real mouse or keyboard uses it, never a script's `click()` or `fill()`. The widget must ask its next question, and its sentence about what the visitor did must name that control. A control that opens something is used in two steps: opening it, then picking inside what opened.
- **Read at the right time.** The list sent with that next question, against the page once it has stopped changing. Only the demo and what the steps opened count.
- **Inside overlays.** For anything that opens over the page, the overlay is opened with no guide running, then a question is typed into Haptic's box as a visitor would. Did the keys arrive, did the overlay stay open, and are its controls in the list sent.

The run prints what it cannot see first: the widget does not read controls inside an iframe, inside a closed shadow root or drawn on a canvas, and those demos are counted, never passed or failed. A demo that cannot be found on its page is "not tested", never a failure. Results are written to `eval/toolkits/results/` as JSON, with every sentence the widget sent, and printed as a table and a list of faults, most widespread first. `--shots <dir>` keeps a screenshot and the exact list the widget sent at each question, to look at a failure by hand.

These are other people's documentation sites. The browser sends nothing but GET requests: anything else a demo tries is stopped. Pages load one at a time, two seconds apart, and their static files are kept for the length of a run.

A toolkit is one file in `eval/toolkits/kits/`: where its demos are, how to find a demo's container, and for each kind of control what a visitor does, by role and visible text. The checks are shared, in `eval/toolkits/checks.ts`. Where a toolkit's documentation shows its demos inside iframes (Storybook sites, UI5's samples), the file opens each demo on its own page, which is how an app built with it would show it, and the iframe is counted separately.

To compare the widget before and after a change, run the suite on each checkout with `--widget` and print the later results with `--compare` set to the earlier file. `eval/toolkits/results/before.json` holds the run on the widget as it was before round 2 of fixes (MUI, Ant Design, Fluent UI, Carbon and UI5 Web Components; AG Grid's site could not be loaded without sending a bot-check token, so it is not tested):

```bash
npm run eval:toolkits -- --widget ../merged-checkout
npm run eval:toolkits -- --table eval/toolkits/results/<new file>.json --compare eval/toolkits/results/before.json
```

## What this does not measure yet

- **Customers' own apps.** The real apps here are public demos and public sites. They are far closer to enterprise software than the demo app was, and they are still not a customer's app, with its own data, its own conventions and whatever its developers did to the page.
- **Apps the widget cannot enter.** Pages drawn on a canvas, and apps inside an iframe, are not read at all.
- **People.** A simulated visitor does exactly what the pointer shows. Real ones misread, hesitate and give up. How well "right pointer" predicts that a person finishes the task has not been measured by anyone.
- **Whether the sentence is true.** It is checked for words it must or must not contain, and for format. Nobody reads it.
- **More than one run.** Each case is asked once unless `--repeat` says otherwise, and timings are from one machine at one time of day.
