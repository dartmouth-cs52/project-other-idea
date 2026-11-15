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
npm run eval -- --models claude-opus-5-5,claude-sonnet-5-5@off,claude-haiku-5-5@off --yes
```

Each model can take settings after `@`: `low`, `medium` or `high` for effort, and `off` for no thinking before the answer. Real models need `ANTHROPIC_API_KEY`, and every call is billed, so without `--yes` the command only prints how many calls it would make.

With no key to hand, start the **Benchmark** workflow from the repository's Actions tab instead. It runs the same command on GitHub and signs in with workload identity federation, so no key is stored. The setup is at the top of `.github/workflows/benchmark.yml`. `--repeat 3` asks each case three times, which steadies the timings. `npm run eval -- --help` lists the rest.

The run goes through the same code as the live server, so the setup that wins is switched on with `HAPTIC_MODEL`, `HAPTIC_EFFORT` and `HAPTIC_THINKING` in `.env`.

## Reading the table

- **right pointer** is the score: the pointer went to a right control, or to nothing when nothing was left.
- **plausible range** is where the true score could lie given how few cases there are. Two models whose ranges overlap have not been told apart yet. Add cases before choosing between them.
- **status agrees** is reported beside the score and is not part of it, because models differ on whether a guide's last click is "continue" or "done".
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

One run on 15 November 2026: all 74 cases, each asked once, from a GitHub runner. Effort was low for all three.

| Setting | Right pointer | Plausible range | Status agrees | ms to pointer | Typical ms | Slow ms |
|---|---|---|---|---|---|---|
| `claude-opus-5-5` | 72/74 (97%) | 91-99% | 99% | 1140 | 1626 | 2180 |
| `claude-sonnet-5-5@off` | 73/74 (99%) | 93-100% | 92% | 1154 | 1587 | 1869 |
| `claude-haiku-5-5@off` | 69/74 (93%) | 85-97% | 89% | 884 | 1076 | 1701 |

The three misses by Opus and Sonnet were all at the end of a guide: each pointed at something more when nothing was left to do. Four of Haiku's five were mistakes inside a guide: it skipped required fields twice, pointed at nothing twice when the right control was listed, and once pointed at "New project" when asked how to delete one.

The live server runs Sonnet with thinking off. It matched Opus on accuracy and speed here, at half the price. Haiku was about a quarter of a second quicker to the pointer and made mistakes that would send a visitor the wrong way.

Read this with care. It is one run, the ranges overlap, and the timings are from GitHub's runner at one time of day. A case that expects nothing is also strict: a model that ends a guide by pointing at where the answer is counts as a miss.

## What this does not measure yet

- Whole guides driven end to end by a model. Each case starts from the right path, so a model is never scored on recovering from its own wrong step.
- Customers' apps behind a login. The demo app is small and tidy and joinhaptic.com is a simple public site. Scores on them are an upper bound.
