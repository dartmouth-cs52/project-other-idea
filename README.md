# Haptic Labs

![Team Photo](Insert a Team Photo URL here)
[*how?*](https://help.github.com/articles/about-readmes/#relative-links-and-image-paths-in-readme-files)

Haptic is an AI guide that software companies add to their web app with one script tag. A user asks how to do something, and a pointer walks them to the right buttons, step by step, across menus and pages.

## Status

We're rebuilding Haptic from scratch on `main`. What's here so far is the core loop, with no accounts or dashboard yet:

- **The widget** (`src/widget`): the script a customer adds to their site. It reads the page the visitor is on, asks the server for the next step, moves a pointer to the element, waits for the visitor to use it, and carries on, across page loads too.
- **The server** (`src/server`): serves the widget and answers each step with one Claude call.
- **Intake** (`src/intake`): a command that reads a customer's site and their help docs, saves what it learned, and prints the script tag.
- **The website** (`web`): the landing page for joinhaptic.com, a static Next.js site. See [`web/README.md`](web/README.md).
- **The test app** (`testbed`): Northpine, a made-up spend management dashboard with about 60 routes, 10,000 transactions and a test panel, built to break pointing guides. It has 179 benchmark tasks. See [`testbed/README.md`](testbed/README.md).

The look of both the widget and the website is defined in [`DESIGN.md`](DESIGN.md).

The first version is on the [`v1`](../../tree/v1) branch, kept as a reference.

## Architecture

TypeScript on Node, with no framework. The widget is bundled into one file by esbuild.

```
npm run tag ──▶ data/sites/<id>.json ──▶ server ◀── widget.js on the customer's site
 (crawl + docs)   (the site's context)     │  POST /v1/turn: the page as a list of elements
                                           ▼
                                         Claude: "point at e12, then wait"
```

**What we keep about a site** (`SiteContext` in `src/shared/types.ts`):

| Field | Where it comes from |
|---|---|
| `pages` | The crawl. For each page: title, headings, button and field labels, and which page each link leads to. Pages are nodes and links are edges, so this is already a graph of the site. The reader that runs at signup uses a real browser, so it also records what each menu, tab and accordion showed when it opened them (`opens`): the edges that take two clicks. |
| `notes`, `docs` | The company: free-form notes and help docs (files, folders or URLs). |
| `appearance`, `allowedOrigins` | The company: the widget's color, corner and label, and which origins it may run on. |
| `source` | The inputs it was built from, so it can be rebuilt unattended. |

**How a step works.** The widget lists every control on the page with a short id (`e12`), its role, label and state. It never reads what's typed into fields or anything inside an area a visitor writes in, and it masks emails, phone numbers and long numbers, in the question and the page's address as well. Nothing inside a writing area is listed, not even a control: a rich-text editor whose toolbar, mention chips or task checkboxes sit inside its editable element cannot be pointed at there. The model replies with the id to point at, a sentence to show, and whether to wait for the visitor. The reply is streamed, so the pointer moves as soon as the id is known, before the sentence is finished. After the visitor acts, the widget waits for the page to stop changing and sends the new page with a summary of what changed. If they click something else, Haptic says so and gives the step that gets them back. Guide state is kept in `sessionStorage`, so a click that loads a new page picks up where it left off.

**What a step costs.** The rules and everything known about the site are the same on every step, so the model provider keeps them ready (a prompt cache) and charges a fraction of the price to read them again. They are kept for an hour after a site's last step. `HAPTIC_CACHE=5m` keeps them for five minutes, which is cheaper to write and only wins on a site that is never quiet that long. Every step logs how many tokens were read from the cache and how many had to be written.

The crawl only sees HTML the server sends. Pages drawn by JavaScript or behind a login come back nearly empty, and the command says so when that happens. The widget reads each page live either way, so those sites lean on notes and docs for now.

## Setup

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY, or set HAPTIC_MODEL=mock to run without one
npm run dev               # http://localhost:4000, with a demo site at /demo/
```

In another terminal, build the demo site's context and open http://localhost:4000/demo/:

```bash
npm run tag -- --url http://localhost:4000/demo/ --id site_demo --name "Acme Console" \
  --notes demo/notes.md --docs demo/help --accent "#2f3bd6"
```

Click **Ask** and try "how do I change my billing info". With `HAPTIC_MODEL=mock` the answers come from a keyword matcher, which is only good for testing the plumbing.

For a real site:

```bash
npm run tag -- --url https://app.example.com --name Example --notes notes.md --docs help/ --docs https://example.com/faq
```

It prints the tag to paste before `</body>`. `npm run tag -- --help` lists every option. To keep a site's context current, run `npm run tag -- refresh --all` on a schedule (a cron job): it re-reads each site and its docs from the saved inputs, and the server picks up the change without a restart.

`npm test` runs the unit tests and `npm run typecheck` checks types.

`npm run eval -- --models mock` runs the benchmark: 74 fixed steps with known right answers, on the demo app and on joinhaptic.com, scored for any model. See [`eval/README.md`](eval/README.md).

## Deployment

The website deploys to Cloudflare from `web/`. See [`web/README.md`](web/README.md#deploying).

The widget server runs as a Cloudflare Worker at `https://widget.joinhaptic.com`, the address in every customer's script tag. `worker/index.ts` is its entry point, and it gives the same answers as the Node server because both run `src/server/app.ts`. The settings are in `wrangler.jsonc`.

```bash
npm run deploy                                        # builds the widget, then publishes the Worker
npm run site:publish -- site_ab12cd34ef               # copies a site built with `npm run tag` to Neon
npm run site:publish -- --from-kv site_joinhaptic     # moves a site from the old KV store to Neon
```

Build a site for the online server with `HAPTIC_PUBLIC_URL=https://widget.joinhaptic.com npm run tag -- --url …`, so the tag it prints points there. A published site is picked up within a minute. Companies that sign up add their own sites from the dashboard on joinhaptic.com (see [`web/README.md`](web/README.md#sign-in-approval-and-the-dashboard)).

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

The online server calls the model named by `HAPTIC_MODEL` in `wrangler.jsonc`, which the benchmark chose (see [`eval/README.md`](eval/README.md), "Results"). Its key is the repository's `ANTHROPIC_API_KEY` secret, which the deploy workflow copies onto the Worker. Set `HAPTIC_MODEL` to `mock` to run it on the keyword stand-in, which needs no key.

## Authors

TODO: list of authors

## Acknowledgments
