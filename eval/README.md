# The benchmark

A fixed set of questions with known right answers, and a command that runs any model against them. It answers two things with the same cases:

- **Is Haptic done?** One setup has to get the cases right.
- **Which setup is best?** Several models and settings are compared on how often they point at the right control and how long a step takes.

## What a case is

A case is one step of one guide, frozen: the page as the widget saw it, the question, what had happened so far, and which controls are a right answer. A guide of five steps is five cases. Cases live in `eval/cases/`, one JSON file per site, and each file carries the site's context, because that is part of what the model reads.

`eval/cases/demo.json` holds 57 cases from 14 guides on the demo app, including a wrong click, a question with no answer in the app, and forms inside dialogs. `eval/cases/joinhaptic.json` holds 17 cases from 6 guides on the live joinhaptic.com: a real public site with an accordion, a footer and a two-step form.

## Running it

```bash
npm run eval -- --models mock
```

`mock` is the keyword matcher. It needs no key and costs nothing, and it gets about four cases in ten right, so that is the floor a real model has to clear.

```bash
npm run eval -- --models claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5@off --yes
```

Each model can take settings after `@`: `low`, `medium` or `high` for effort, and `off` for no thinking before the answer. Real models need `ANTHROPIC_API_KEY`, and every call is billed, so without `--yes` the command only prints how many calls it would make.

With no key to hand, start the **Benchmark** workflow from the repository's Actions tab instead. It runs the same command on GitHub and signs in with workload identity federation, so no key is stored. The setup is at the top of `.github/workflows/benchmark.yml`. `--repeat 3` asks each case three times, which steadies the timings. `npm run eval -- --help` lists the rest.

The run goes through the same code as the live server, so the setup that wins is switched on with `HAPTIC_MODEL`, `HAPTIC_EFFORT` and `HAPTIC_THINKING` in `.env`.

### Before switching Answers on for a site

A site with Answers on is asked with a longer prompt, and its replies carry a mode as well as a pointer. The steps a guide should give are the same, so the same cases say whether guiding got worse:

```bash
npm run eval -- --models claude-sonnet-5-5 --answers --yes
```

Compare its **right pointer** with a run without `--answers` made in the same hour. Answers should not go on for a customer until the two are level, within the plausible range. This has not been run yet: the figures under "Results" are all without Answers.

## Reading the table

- **right pointer** is the score: the pointer went to a right control, or to nothing when nothing was left.
- **plausible range** is where the true score could lie given how few cases there are. Two models whose ranges overlap have not been told apart yet. Add cases before choosing between them.
- **clean sentence** is how often the model's sentence needed no tidying at its ends: no stray space and no closing brace left over from the reply's format. Space inside the sentence is tidied without counting. The server tidies every sentence, so a visitor never sees the difference, but a low figure means the setting is fighting the reply's format.
- **within the rules** is how often the server changed nothing about it (`src/server/rules.ts`). It drops a sentence that holds a web address, an email address, a phone number, a messaging handle, an account to pay or a request to hand over a secret, cuts a reply that runs long, and takes off bold and code marks. A low figure means visitors are reading less than the model wrote, or the model is writing marks it should not. Each case's `broke` in the results file names the rule.
- **status agrees** is reported beside the score and is not part of it, because models differ on whether a guide's last click is "continue" or "done". A reply can also be "stuck", when the model finds no way forward. The cases do not expect it, so it counts against status agreement only.
- **typical ms** is the middle step, start to finish. **slow ms** is the step that nine in ten are faster than. Compare timings only within one run: the service's speed drifts from hour to hour.
- **ms to pointer** is how long until the model had named the control, which is when the pointer starts to move.

Every answer from a run is written to `eval/results/`, which is not committed.

## Adding cases from a real site

1. Start the server with `HAPTIC_RECORD=1`. Every step is then appended to `data/recordings/<site id>.jsonl`.
2. Use Haptic on the site: ask a real question and follow it to the end. The model's answers do not have to be right for the recording to be useful.
3. For each step worth keeping, copy its `request` (without `site`) into a case in `eval/cases/<name>.json` and write the `expect`: the labels of the controls that are right at that step, or an empty list when nothing is left to point at. The file's `site` is the matching file from `data/sites/`.

A recording holds a visitor's question and the labels on their page, so check a case for anything private before committing it.

## Recording cases by script

`eval/record.ts` walks a site in a browser with the real widget and keeps every step it sends. The guides are scripts in `eval/guides/`: the question, and for each step which controls are right and what a visitor does next. Run it again whenever the widget changes what it sends.

```bash
npm run eval:record -- demo         # needs the local server: HAPTIC_MODEL=mock npm run dev
HAPTIC_PUBLIC_URL=https://widget.joinhaptic.com npm run eval:record -- joinhaptic
```

A guide can stop before a button that must not be pressed. The joinhaptic.com form guide ends at the button that sends the request, so recording never submits it. This works for any public site: add a file to `eval/guides/`, build the site with `npm run tag`, and record. Pages behind a login need the recording method above.

It drives a browser with Playwright, which this project does not install. The steps are at the top of `eval/record.ts`.

## Results

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

## The Answers benchmark

The cases above ask one thing: did the pointer go to the right control. A site with Answers on can also answer in words from its help docs, and say it can't help. Those need different questions and different scores, so they have a benchmark of their own, in `eval/answers/`.

```bash
npm run eval:answers -- --models mock
npm run eval:answers -- --models claude-sonnet-5-5,claude-haiku-5-5 --judge --yes
```

A case is one question on one page, with what a right reply does. Each file in `eval/answers/` holds a site with its help docs, the pages its questions are asked on as the widget sees them, and the cases. `eval/answers/demo.json` is the demo app with the help centre in `demo/help`, and `eval/answers/attacks.json` asks the same site questions meant to make it misbehave. The mix follows the research report: mostly questions one article answers, then questions that need two, questions the docs do not cover, how-to questions that should be pointed at and not told, and a tenth of follow-ups, vague, off-topic and planted ones.

Each score is reported on its own. There is no blended score, because the mistakes do not cost the same: declining a question the docs cover is an annoyance, and answering one they do not is a statement made in the customer's name.

- **right kind of reply**: a guide, an answer or a refusal, as the case expects, and for the right reason when it declines.
- **declined what it should**: of the questions nothing should answer in words (not in the docs, a price or a refund, nothing to do with the site, an attack), how many it did not answer.
- **declined what the docs cover**: of the questions the docs do answer, how many it refused anyway. Lower is better.
- **right article**: of its answers, how many rest on the articles the answer is in, and on no others.
- **right pointer**: where a case says what to point at, or that nothing should be.
- **nothing forbidden said**: a price, or what a planted instruction asked for, did not reach the visitor.
- **overruled by the server**: how many replies the checks in `src/server/answers.ts` changed after the model wrote them. A high number means the prompt is leaning on the code.
- **ms to kind of reply** is when the widget can first show something. **cents a reply** is worked out from the tokens.

`--judge` adds two more, from a second model that reads each answer beside a reference: **judged right**, and **judged all in the docs**. Model judges differ a great deal from each other in how lenient they are, and rewording a judge's prompt can reverse a ranking. So there is one judge with one prompt (`eval/judge.ts`), asked yes-or-no questions, and it is checked first against answers that have been labelled by hand:

```bash
npm run eval:answers -- --check-judge --yes
```

`eval/answers/judge-check.json` holds those answers, each with whether it is right and whether it is all in the docs. Do not compare two runs judged by different models or prompts.

A case file can set `marks`, the scores a run has to reach, and `--gate` fails the command when one is missed. That is the check to run for a customer before Answers goes live for them, and again when their docs, the prompt or the model changes. **The marks are for the team to set before a run, not after it.**

To refresh a file's site and pages after the help docs or the widget change (the questions are written by hand and are kept):

```bash
npm run eval:answers:record -- demo        # needs the local server and the site built with --answers on
```

**None of this has been run against a real model yet.** With the stand-in model the commands run end to end, which shows the scoring works and nothing more. The labels in `judge-check.json` and the expected replies in the case files were written with the help of a model and checked against the help docs by a second pass, not yet by a person on the team: read a sample before trusting a score built on them.

## What this does not measure yet

- Whole guides driven end to end by a model. Each case starts from the right path, so a model is never scored on recovering from its own wrong step.
- Real visitors' questions. Every Answers case was written for the benchmark. Once a site has Answers on, replace them with questions from its log.
- Customers' apps behind a login. The demo app is small and tidy and joinhaptic.com is a simple public site. Scores on them are an upper bound.
