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
| `pages` | The crawl. For each page: title, headings, button and field labels, and which page each link leads to. Pages are nodes and links are edges, so this is already a graph of the site. |
| `notes`, `docs` | The company: free-form notes and help docs (files, folders or URLs). |
| `appearance`, `allowedOrigins` | The company: the widget's color, corner and label, and which origins it may run on. |
| `source` | The inputs it was built from, so it can be rebuilt unattended. |

**How a step works.** The widget lists every control on the page with a short id (`e12`), its role, label and state. It never reads what's typed into fields, and masks emails and long numbers. The model replies with the id to point at, a sentence to show, and whether to wait for the visitor. The reply is streamed, so the pointer moves as soon as the id is known, before the sentence is finished. After the visitor acts, the widget waits for the page to stop changing and sends the new page with a summary of what changed. If they click something else, Haptic says so and gives the step that gets them back. Guide state is kept in `sessionStorage`, so a click that loads a new page picks up where it left off.

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

What is kept from visitors follows one rule: the question, each control pointed at, wrong clicks, how the guide ended, whether they said it helped, and timings. Emails and long numbers are masked. Page contents are not kept, and what people type is never read. The question is recorded when it arrives, before the model answers, so a guide whose first step fails is still on record. A guide that never reports an ending was abandoned.

**Verified routes** (issue 13, `src/server/routes.ts`). For a question on a screen, the control that was right last time, so the same question on the same screen can be answered without the model. A route is keyed on the question (masked and normalized), the page, any open dialog and the control the previous step used. It is learned from the model's answer, trusted once a guide that used it finishes, and loses that trust when someone answers No to Did this help or the model answers differently. Each site has a mode, set from its dashboard:

- **shadow**, the default: every step is looked up beside the model call, and the step records whether the model chose the same control. The visitor always gets the model's answer, so this costs nothing and adds no wait.
- **serve**: a trusted route is answered without the model, but only when exactly one control on the live page matches it and it does not point again at the control just used. Anything else goes to the model. The lookup gets 250 ms before the model is asked anyway.
- **off**: no lookups.

How often questions repeat, and whether serving would be right, is on each site's dashboard and in a report across every site:

```bash
npm run routes:report                     # the last 7 days
npm run routes:report -- --days 30 --site site_ab12cd34ef
```

"Had a route" is the repeat rate issue 13 asks for: the same question on the same screen at the same point. "Could be served" is the share of steps that would skip the model, and "model agreed" says whether doing so would have been right. Turn serving on for a site once both are high.

**Which guides are finished.** Pricing on joinhaptic.com bills only finished guides, so the widget records "finished" exactly as pricing defines it: the visitor followed the steps and is now where they asked to be, or used the control the last answer pointed at. A first answer the visitor did not act on, or one that only needed words, ends as "shown". When the model finds no way forward it answers with the status "stuck", kept apart from "done", and the guide ends as "nothing to point at". Neither is billed. The dashboard lists every finished guide by month, with a download, so a bill can be checked. See `GUIDE_OUTCOMES` in `src/shared/types.ts`.

The first time the script calls from an allowed origin is how the dashboard knows a site is connected, and a call from an origin that is not allowed is kept too, so the dashboard can say why an install looks dead.

The online server calls the model named by `HAPTIC_MODEL` in `wrangler.jsonc`, which the benchmark chose (see [`eval/README.md`](eval/README.md), "Results"). Its key is the repository's `ANTHROPIC_API_KEY` secret, which the deploy workflow copies onto the Worker. Set `HAPTIC_MODEL` to `mock` to run it on the keyword stand-in, which needs no key.

## Authors

TODO: list of authors

## Acknowledgments
