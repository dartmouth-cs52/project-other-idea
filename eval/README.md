# The benchmark

A fixed set of questions with known right answers, and a command that runs any model against them. It answers two things with the same cases:

- **Is Haptic done?** One setup has to get the cases right.
- **Which setup is best?** Several models and settings are compared on how often they point at the right control and how long a step takes.

## What a case is

A case is one step of one guide, frozen: the page as the widget saw it, the question, what had happened so far, and which controls are a right answer. A guide of five steps is five cases. Cases live in `eval/cases/`, one JSON file per site, and each file carries the site's context, because that is part of what the model reads.

`eval/cases/demo.json` holds 57 cases from 14 guides on the demo app, including a wrong click, a question with no answer in the app, and forms inside dialogs.

## Running it

```bash
npm run eval -- --models mock
```

`mock` is the keyword matcher. It needs no key and costs nothing, and it gets 25 of the 57 demo cases right, so that is the floor a real model has to clear.

```bash
npm run eval -- --models claude-opus-5-5,claude-sonnet-5-5@off,claude-haiku-5-5@off --yes
```

Each model can take settings after `@`: `low`, `medium` or `high` for effort, and `off` for no thinking before the answer. Real models need `ANTHROPIC_API_KEY`, and every call is billed, so without `--yes` the command only prints how many calls it would make. `--repeat 3` asks each case three times, which steadies the timings. `npm run eval -- --help` lists the rest.

The run goes through the same code as the live server, so the setup that wins is switched on with `HAPTIC_MODEL`, `HAPTIC_EFFORT` and `HAPTIC_THINKING` in `.env`.

## Reading the table

- **right pointer** is the score: the pointer went to a right control, or to nothing when nothing was left.
- **plausible range** is where the true score could lie given how few cases there are. Two models whose ranges overlap have not been told apart yet. Add cases before choosing between them.
- **status agrees** is reported beside the score and is not part of it, because models differ on whether a guide's last click is "continue" or "done".
- **typical ms** is the middle step. **slow ms** is the step that nine in ten are faster than. Compare timings only within one run: the service's speed drifts from hour to hour.

Every answer from a run is written to `eval/results/`, which is not committed.

## Adding cases from a real site

1. Start the server with `HAPTIC_RECORD=1`. Every step is then appended to `data/recordings/<site id>.jsonl`.
2. Use Haptic on the site: ask a real question and follow it to the end. The model's answers do not have to be right for the recording to be useful.
3. For each step worth keeping, copy its `request` (without `site`) into a case in `eval/cases/<name>.json` and write the `expect`: the labels of the controls that are right at that step, or an empty list when nothing is left to point at. The file's `site` is the matching file from `data/sites/`.

A recording holds a visitor's question and the labels on their page, so check a case for anything private before committing it.

## Re-recording the demo cases

`eval/record-demo.ts` holds the 14 guides as a script and rebuilds `demo.json` by walking the demo app in a browser. Run it again whenever the widget changes what it sends. The steps are at the top of that file.

## What this does not measure yet

- Whole guides driven end to end by a model. Each case starts from the right path, so a model is never scored on recovering from its own wrong step.
- Time until the pointer moves. Today the reply arrives in one piece, so only the whole step is timed.
- Real customer apps. The demo app is small and tidy. Scores on it are an upper bound.
