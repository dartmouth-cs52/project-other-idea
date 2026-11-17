# Deploying and running Haptic

How the hosted service is deployed and run: the widget Worker, the database, what is recorded, how finished guides are defined, the off switch, spend limits, and what a step costs. For the project overview, see the [README](../README.md).

## Deploying

The website deploys to Cloudflare from `web/`. See [`web/README.md`](../web/README.md#deploying).

The widget server runs as a Cloudflare Worker at `https://widget.joinhaptic.com`, the address in every customer's script tag. `worker/index.ts` is its entry point, and it gives the same answers as the Node server because both run `src/server/app.ts`. The settings are in `wrangler.jsonc`.

```bash
npm run deploy                                        # builds the widget, then publishes the Worker
npm run site:publish -- site_ab12cd34ef               # copies a site built with `npm run tag` to Neon
npm run site:publish -- --from-kv site_joinhaptic     # moves a site from the old KV store to Neon
```

Build a site for the online server with `HAPTIC_PUBLIC_URL=https://widget.joinhaptic.com npm run tag -- --url …`, so the tag it prints points there. A published site is picked up within a minute. Companies that sign up add their own sites from the dashboard on joinhaptic.com (see [`web/README.md`](../web/README.md#sign-in-approval-and-the-dashboard)).

### The staging server

A second copy of the server, for measuring a change against the real model before visitors get it, runs at `https://haptic-widget-staging.joinhaptic.workers.dev` (`npx wrangler deploy -c wrangler.staging.jsonc`, or a push to the `staging` branch, which `.github/workflows/deploy-staging.yml` publishes). It reads sites from the same KV store, has no database, and no customer's tag points at it. Its address is in this repository and anyone can call it, so it has the live server's budget meter with a small budget for every site together: $2 an hour and $5 a day (`HAPTIC_BUDGET_SHARED` in `wrangler.staging.jsonc` puts all sites on one meter, whatever a site sets for itself). Past either, every step gets the resting sentence until the hour or the day turns. A measurement run of a few hundred steps needs more, and is deployed with its limits on the command line, which leaves the file as it is: `npx wrangler deploy -c wrangler.staging.jsonc --var HAPTIC_BUDGET_HOUR:20 --var HAPTIC_BUDGET_DAY:100`. Those limits stand until the next deploy without them, so deploy once more from the file when the run is over.

## Keeping a site current

To keep a site's context current, run `npm run tag -- refresh --all` on a schedule (a cron job). It re-reads each site and its docs from the saved inputs, and the server picks up the change without a restart.

## The database

Sites, and every guide and step, are kept in Neon, in the project called haptic. The tables are in `db/migrations`, and `npm run db:migrate` applies the ones a database is missing, to the database in `DATABASE_URL`. It talks to Neon over HTTPS. Both deploys, the website's and the widget server's, apply them before they publish, from the `DATABASE_URL` repository secret in GitHub, and a change to `db/migrations` alone starts both. Without that secret neither deploy goes ahead: a deploy that publishes code without its tables is how Teach Haptic once shipped with no `teach_sessions` table. One push can start both deploys at once, so the runner skips a migration the other run applied at the same moment rather than failing on it (`test/migrate.test.ts`). On a database a migration hasn't reached, such as one migrated by hand, the server and the dashboard still work, and what needs a missing table or column is skipped and logged: Teach Haptic, for one, says it isn't set up on this server yet, and the log names the migration it needs. The Worker reads the connection string from a secret:

```bash
npx wrangler secret put DATABASE_URL
```

A step of a guide never waits on the database for its site: the Worker answers from the copy it holds in memory, up to ten minutes old, and fetches a fresh one after the response (`src/server/site-cache.ts`). The widget loading on a page does wait for a fresh copy once the held one is a minute old, which is how a change made in the dashboard takes effect.

Without it the Worker still answers, from the KV store sites were kept in before Neon, and records nothing. With it, a site missing from Neon is still looked for in the KV store, until every site has moved.

`db/migrations/0014` counts the networks each learned label was seen from. Until it is applied, nothing learned reaches the prompt and nothing new is learned (the server logs it); once it is, labels learned before have to be seen from three networks again before the prompt uses them.

## What is recorded about visitors

What is kept from visitors follows one rule: the question, each control pointed at and where on the page it sits, the page's path and the site's address, wrong clicks (by the caption of what was clicked, never by what a field holds), in Do it with me what Haptic did (its typing is only ever words from the question), how the guide ended, whether they said it helped, and timings.

What is masked, in the browser and again before anything is stored (`cleanText` in `src/shared/types.ts`, the one function both use): anything that looks like an email address; any run of five or more digits; and any eight or more digits written in groups with spaces, dashes, dots or brackets, like a phone or card number. Not masked: real dates written in figures, with a month from 1 to 12 and a day from 1 to 31, like 2026-03-07 or 07.03.2026, which questions like "my latest invoice" need (12.34.5678 is no date, and is masked); digits that follow straight after a letter, like the model number I9100, unless more of a number follows them (SSN123-45-6789 and Card4111 1111 1111 1111 are masked whole); numbers shorter than that; and names and other words, so a name on a control or in a page's address can be kept. One exception: an email address, or a number of five or more digits, that the visitor wrote in their own question is left readable wherever exactly that value stands on its own on the page, and in the question only when the page shows it so (`namedIn`). Otherwise it stays masked in the question. The rest of the page is not kept, and what people type is never sent: the widget looks at what fields hold only inside the browser, to leave it out wherever the page repeats it (as `[typed]` in headings, names and options). Words the visitor also wrote, whole, in their own question are not left out when the question is sent with them readable, since they are sent and kept anyway: a search for a name they asked about leaves that name readable in the results. An email address or a number that the question is sent without is left out like any other typing, even when the question names it, so the page's repeat of what a visitor typed never un-masks it, on the page or in the question (`typedValues` and `readableInQuestion` in `src/widget/snapshot.ts`). Apart from guides, the labels of the pages visitors see, and of what their menus, tabs and accordions show when opened, are kept for learning the site, with when each was first and last seen, how often, up to ten hashed visitor ids, and up to ten networks they were sent from. A network is kept as two bytes of a hash made with the site's id, a value about 65,000 IPv4 addresses share, so it can't be turned back into an address (see [the widget on a live page](widget.md#learning-the-site-from-visits)). The privacy page on the website says the same thing to visitors, so a change to what is kept has to change that page too. The question is recorded when the model is about to be asked it, before it answers, so a guide whose first step fails is still on record. A question the off switch or the budget turned away is not recorded: the model was never asked it, so it cost nothing to send, and recording it would let anything that can send a request put questions of its choosing on a site's dashboard. Each step's row also has the tokens it used and what it cost, which is where a site's cache-hit rate comes from: `cache_read_tokens` over the sum of the three input columns. A guide that never reports an ending was abandoned.

## What Teach Haptic keeps

Teaching is done by someone at the company, not by visitors, and it is kept apart from guides. A teach session (`teach_sessions`, `db/migrations/0014_teach_sessions.sql`) keeps the SHA-256 of its one-time token and of the secret the teaching tab claimed it with (never either value), the site, the question (masked like every question), the failed guide it was started from if any, who started it (their Neon Auth user id and the name the dashboard shows), when it was made, claimed, finished, cancelled or saved, the address the tab claimed it from, and the recorded steps. A step is a control's kind, its label and the section it sits in, masked as the widget masks everything, the page as a path with ids masked, and what was done with it; never what was typed, and never a record's own name from a table's row. The widget server checks and masks the steps again before keeping them. The recorded steps are kept only until the session is saved or discarded. Saving keeps the reviewed steps as a route and sets the session's `steps` to null, so the recording and any step the reviewer deleted are gone. Discarding sets them to null too. A session nobody saves is deleted once it is a week old: by the site Worker's daily schedule (`forgetOldTeaching` in `web/worker/teach.ts`, run from `daily` in `web/worker/handler.ts`), and when someone at that company next starts one for the same site. The daily run also clears the steps of any saved or closed session that still holds them. A saved route is kept in the site's context (`sites.context.taught`) with the reviewer's notes and the name of who taught it, until it is removed in the dashboard, replaced by a route for the same question, or dropped as the oldest when a site has more than 50. The session it was saved from is deleted with it, so nothing of the route is left. The name is never sent to the widget or the model.

## Which guides are finished

Pricing on joinhaptic.com bills only finished guides, so the widget reports "finished" exactly as pricing defines it: the visitor followed the steps and is now where they asked to be, or used the control the last answer pointed at. A first answer the visitor did not act on, or one that only needed words, ends as "shown". When the model finds no way forward it answers with the status "stuck", kept apart from "done", and the guide ends as "nothing to point at". Neither is billed. The dashboard lists every finished guide by month, with a download, so a bill can be checked. See `GUIDE_OUTCOMES` in `src/shared/types.ts`.

The widget's report is only its word, and anything that can send a request can send one. So the server keeps "finished" only when its own record of the guide bears it out (`endingFor` in `src/server/db.ts`). The newest step it recorded for the guide has to:

- have been answered by the model. A question the off switch or the budget turned away is not on record at all, and a step past the cap on acting, which the server answers by itself, never starts a guide's record and ends one as "step limit";
- have said the guide was done, or pointed at a control the visitor could then use. The second is how the click that commits in Do it with me is finished, since the reply that points at it can still say "continue";
- not be a first answer in words alone, which is "shown"; nor a step where the model was stuck ("nothing to point at"), named a control the site's owner ruled out ("blocked"), answered in words from the help docs ("answered"), or said it couldn't help (the reason it gave).

A report of "finished" that the record contradicts is kept as the ending the record shows, which is not billed, and the server's log says so. One for a guide with no step on record keeps no ending, so it stays a guide that never reported one. The report names the step its ending rests on, the last one the widget had an answer to, and that step is the one judged. So the look the widget asks for straight after the visitor uses the last control cannot change it, even when a report held up on its way arrives after that look is on record. A report from a widget too old to name its step is judged by the newest step on record. The widget reports the ending as soon as it is known, often before the step's own row is written, and from a page that may be on its way out: the server waits for that row, up to about ten seconds, and if it never comes, judges the newest step on record instead. Every other outcome is free, and is kept as reported, and the first outcome kept is the one that stays.

What this does not check: that the visitor really used the control. The server sees no clicks, so that is the widget's word. Someone willing to pay for the model's answers out of a site's budget, at most 30 steps a minute from one address, can still make guides that look finished. What it rules out is making them for nothing: every finished guide is a step the model answered, on a site that was on and within its budget.

The routes that write (`/v1/turn`, `/v1/guides/<id>/report`, `/v1/outline` and `/v1/handoff`) answer only a request whose `Origin` header names one of the site's allowed origins. A browser names the page's origin on every such request, and a page cannot change it, so this keeps one site's id from being used from another site's pages. A request with no `Origin` is never the widget, and is refused. A program can write any `Origin` it likes, so nothing above rests on this alone. Reading a site's public settings (`/v1/sites/<id>`) needs no `Origin`. The benchmark's `--server` mode names the site's own allowed origin, as the widget does from the site's pages.

The first time the script calls from an allowed origin is how the dashboard knows a site is connected, and a call from an origin that is not allowed is kept too, so the dashboard can say why an install looks dead.

## Switching it off

One command takes Haptic off a site, or off every site, without a deploy. The launcher goes, and the model is no longer called. It takes effect within a minute or two.

```bash
npm run site:off -- site_ab12cd34ef     # one site
npm run site:off -- --all               # every site
npm run site:on -- site_ab12cd34ef      # and back
```

The switch is kept in the Worker's KV store, apart from Neon, so it still works when the database cannot be reached. On your own machine, `HAPTIC_OFF=1` does the same. A site whose context has `"off": true` is off wherever it runs.

## What a site can spend

The limit of 30 steps a minute slows one caller down. It does not bound the bill, because every new address gets its own allowance. Two limits do:

1. **At the model provider.** Give the server its own workspace and API key, and set a monthly spend limit on that workspace in the provider's console. This is the one limit that holds even if the server has a bug, and it has to be set by hand.
2. **In the server.** Each site may spend $2 an hour and $10 a day on the model (`HAPTIC_BUDGET_HOUR` and `HAPTIC_BUDGET_DAY` in `wrangler.jsonc`). Past either, its visitors read "The guide is resting for now" and the model is not called until the hour or the day turns. The cost of a step is worked out from its tokens and the prices in `src/server/prices.ts`, which need updating when the provider's prices change.

   A step's cost is only known once the model has answered, so a step is let through with the most it could cost set aside, and that is swapped for what it did cost when it ends. Steps that arrive together are counted against what is left, and a site can pass a limit by less than one step. Near a limit this lets fewer steps run at once: a visitor can read the resting sentence a little before the money has run out.

A site can have its own limits, and a public demo can also limit each visitor:

```bash
npm run tag -- --id site_ab12cd34ef --budget-hour 5 --budget-day 40 --visitor-steps 60
```

To limit each visitor the server has to tell them apart, which it does by network address. It keeps a count of the day's steps against a scrambled form of the address, hashed with a random value made for each site each day so it means nothing anywhere else, and clears the list and the random value when the day ends.

When a site passes 50%, 80% and 100% of a limit, a line goes to the server's log. To have it sent to a chat channel as well, give the server a webhook address (Slack's and Discord's incoming webhooks both work):

```bash
npx wrangler secret put HAPTIC_ALERT_WEBHOOK
```

The online server calls the model named by `HAPTIC_MODEL` in `wrangler.jsonc`, which the benchmark chose (see [`eval/README.md`](../eval/README.md), "Results"). Its key is the repository's `ANTHROPIC_API_KEY` secret, which the deploy workflow copies onto the Worker. Set `HAPTIC_MODEL` to `mock` to run it on the keyword stand-in, which needs no key.

## What a step costs

A step can ask the model twice. With `HAPTIC_RECHECK` at its default, `ask`, a guide's reply that tells the visitor to use a listed control without pointing at it is judged in code (`judgeNamed` in `src/server/check.ts`): the control is pointed at, the model is asked about it once more, or the reply stands. A guide that ends in words that only name the goal's control ("Create API key makes a new one", with "done" and no pointer) is asked about once more as well, and never pointed at in code (`namedForTheGoal`). On a site with Answers on, "not covered" to a first question that asks for a way is asked about once more too. An act reply that stalls is asked about too. Both calls are charged to the site's budget, which sets aside room for the second. A site with Answers on is judged the same for its guide replies, a step or the sentence that ends a guide. An answer in words from a help article is looked at only when the visitor asked for a way ("how do I…"), never for a question of fact or explanation.

The rules and everything known about the site are the same on every step, so the model provider keeps them ready (a prompt cache) and charges a fraction of the price to read them again. They are kept for an hour after a site's last step. `HAPTIC_CACHE=5m` keeps them for five minutes, which is cheaper to write and only wins on a site that is never quiet that long. Every step logs how many tokens were read from the cache and how many had to be written.
