# Deploying and running Haptic

How the hosted service is deployed and operated: the widget Worker, the database, what is recorded, billing outcomes, the off switch and spend limits. For the project overview, see the [README](../README.md).

The website deploys to Cloudflare from `web/`. See [`web/README.md`](../web/README.md#deploying).

The widget server runs as a Cloudflare Worker at `https://widget.joinhaptic.com`, the address in every customer's script tag. `worker/index.ts` is its entry point, and it gives the same answers as the Node server because both run `src/server/app.ts`. The settings are in `wrangler.jsonc`.

```bash
npm run deploy                                        # builds the widget, then publishes the Worker
npm run site:publish -- site_ab12cd34ef               # copies a site built with `npm run tag` to Neon
npm run site:publish -- --from-kv site_joinhaptic     # moves a site from the old KV store to Neon
```

Build a site for the online server with `HAPTIC_PUBLIC_URL=https://widget.joinhaptic.com npm run tag -- --url …`, so the tag it prints points there. A published site is picked up within a minute. Companies that sign up add their own sites from the dashboard on joinhaptic.com (see [`web/README.md`](../web/README.md#sign-in-approval-and-the-dashboard)).

**The database.** Sites, and every guide and step, are kept in Neon, in the project called haptic. The tables are in `db/migrations`, and `npm run db:migrate` applies the ones a database is missing, to the database in `DATABASE_URL`. It talks to Neon over HTTPS. The Worker reads the connection string from a secret:

```bash
npx wrangler secret put DATABASE_URL
```

A step of a guide never waits on the database for its site: the Worker answers from the copy it holds in memory, up to ten minutes old, and fetches a fresh one after the response (`src/server/site-cache.ts`). The widget loading on a page does wait for a fresh copy once the held one is a minute old, which is how a change made in the dashboard takes effect.

Without it the Worker still answers, from the KV store sites were kept in before Neon, and records nothing. With it, a site missing from Neon is still looked for in the KV store, until every site has moved.

What is kept from visitors follows one rule: the question, each control pointed at and where on the page it sits, the page's path and the site's address, wrong clicks (by the caption of what was clicked, never by what a field holds), how the guide ended, whether they said it helped, and timings. Emails, phone numbers and long numbers are masked in the browser, and again before anything is stored. Names are not, so a name on a control or in a page's address can be kept. The rest of the page is not kept, and what people type is never read. The privacy page on the website says the same thing to visitors, so a change to what is kept has to change that page too. The question is recorded when it arrives, before the model answers, so a guide whose first step fails is still on record. Each step's row also has the tokens it used and what it cost, which is where a site's cache-hit rate comes from: `cache_read_tokens` over the sum of the three input columns. A guide that never reports an ending was abandoned.

**Which guides are finished.** Pricing on joinhaptic.com bills only finished guides, so the widget records "finished" exactly as pricing defines it: the visitor followed the steps and is now where they asked to be, or used the control the last answer pointed at. A first answer the visitor did not act on, or one that only needed words, ends as "shown". When the model finds no way forward it answers with the status "stuck", kept apart from "done", and the guide ends as "nothing to point at". Neither is billed. The dashboard lists every finished guide by month, with a download, so a bill can be checked. See `GUIDE_OUTCOMES` in `src/shared/types.ts`.

The first time the script calls from an allowed origin is how the dashboard knows a site is connected, and a call from an origin that is not allowed is kept too, so the dashboard can say why an install looks dead.

**Switching it off.** One command takes Haptic off a site, or off every site, without a deploy. The launcher goes, and the model is no longer called. It takes effect within a minute or two.

```bash
npm run site:off -- site_ab12cd34ef     # one site
npm run site:off -- --all               # every site
npm run site:on -- site_ab12cd34ef      # and back
```

The switch is kept in the Worker's KV store, apart from Neon, so it still works when the database cannot be reached. On your own machine, `HAPTIC_OFF=1` does the same. A site whose context has `"off": true` is off wherever it runs.

**What a site can spend.** The limit of 30 steps a minute slows one caller down. It does not bound the bill, because every new address gets its own allowance. Two limits do:

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
