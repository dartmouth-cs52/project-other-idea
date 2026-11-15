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

**How a step works.** The widget lists every control on the page with a short id (`e12`), its role, label and state. It never reads what's typed into fields or anything inside an area a visitor writes in, and it masks emails, phone numbers and long numbers, in the question and the page's address as well. Nothing inside a writing area is listed, not even a control: a rich-text editor whose toolbar, mention chips or task checkboxes sit inside its editable element cannot be pointed at there. The model replies with the id to point at, a sentence to show, and whether to wait for the visitor. The reply is streamed, so the pointer moves as soon as the id is known, before the sentence is finished. After the visitor acts, the widget waits for the page to stop changing and sends the new page with a summary of what changed. If they click something else, Haptic says so and gives the step that gets them back. Guide state is kept in `sessionStorage`, so a click that loads a new page picks up where it left off.

**Answers.** A pointer cannot answer "what does this do" or "why did that happen". A site with Answers switched on gets replies that can also answer in words, from its own help docs. Each reply is one of three kinds, which the model names in the reply's first field so the widget knows what is coming:

| Kind | When | What the visitor gets |
|---|---|---|
| `guide` | They want to do something, and there is a control or a link toward it | The pointer and a sentence, as before |
| `answer` | They ask what something is, what it does or why, and a help article says | One to four sentences, with the title, link and date of each article they rest on. It can point as well |
| `cannot_help` | The docs do not cover it, it is one for a person, or it has nothing to do with the site | A fixed sentence |

What matters most is decided by the server after the model has replied, in `src/server/answers.ts`, and not by the prompt:

- When Haptic cannot help, the visitor reads a fixed sentence. The model only picks which one, and what it wrote is thrown away.
- An answer has to name at least one of the site's own help articles. If it names none, the visitor is told the docs do not cover it.
- Prices, refunds, billing disputes, legal and medical matters, deadlines and anything about the visitor's own account are never answered in words, whatever the docs say. Pointing at the page where the visitor can see their own plan is still allowed.
- An answer is held to the same rules as any sentence: plain text, with no web address, email address or number to call.
- A control an answer names is looked for on the page. Help docs go out of date, and a bot that only reads docs cannot know when an article names a button the product no longer has. Haptic has the page in hand when it answers. The model lists the controls its answer tells the visitor to use, and the server looks for each on the page the visitor is on and on the pages the site map knows. One that is on none of them is said so under the answer ("I can't see "Archive project" on this page or the others I know, so this may no longer be right"), and recorded with the step, which is how a company learns which of its articles no longer match its product. It only speaks when it can know: not while a dialog is open, and not for a product whose pages the crawl could not read, where a control that isn't on this page is most likely just on another.

In the widget, an answer is read in the panel: the question, the answer, and under it each article's title, link and date. If the answer is about a control on the page, the pointer goes to it as well. A step's sentence stays beside the pointer. Questions answered in words are remembered until the visitor presses Stop, so "and who can remove them?" is read with what came before.

It is off unless a site switches it on, and a site without it is asked exactly as before: the same prompt, and the same three fields in each reply. A test holds the old prompt to a fingerprint, so it cannot change by accident.

```bash
npm run tag -- --id site_ab12cd34ef --answers on --stale-days 365
```

With Answers on, up to about 100,000 tokens of help docs go in the prompt, where a site without it gets about 24,000. A text doc can say where it lives and when it last changed, in a few lines at its top, and those are what the visitor is shown under an answer:

```
---
url: https://help.example.com/articles/inviting-teammates
updated: 2026-10-02
---
```

A doc fetched from a URL is linked to that URL. **Answers has not been tried with a real model yet.** Run the benchmark with `--answers` before switching it on for anyone (see [`eval/README.md`](eval/README.md)).

**The way to a person.** A support chat is also an inbox someone watches, and Haptic is not one. When it can't help, it hands over to whatever the company already uses. The widget offers one button, "Contact support", in three cases: when Haptic has just said the docs don't cover a question or that it is one for a person, when a visitor answers "No" to "Did this help?", and when three questions in a row have ended without a "Yes". It is not offered after every reply.

A site sets where the button leads, and the first of these that is set is used:

```bash
npm run tag -- --id site_ab12cd34ef \
  --handoff-webhook https://example.com/hooks/haptic --handoff-secret "$SECRET" \
  --handoff-url https://example.com/contact \
  --handoff-email support@example.com
```

- **A webhook.** The widget shows a short form, an email address and a note. The server passes it on as JSON and keeps none of it: `kind` ("handoff"), `site`, `site_name`, `at`, `email`, `note`, `origin`, `page`, `guide`, `transcript` (each line has a `role`, its `text`, and for Haptic's lines the `kind` of reply), and `modes`, the kinds of reply used. With a secret set, the post carries `X-Haptic-Signature: sha256=` followed by the hex HMAC-SHA256 of the body, so the receiver can tell it came from Haptic. The address has to be https and on the public internet.
- **A page**, opened in a new tab.
- **An email address.** The visitor's own mail program opens, with the conversation in the message.

A site with its own chat widget can take over instead. Before the button does anything it sends a `haptic:handoff` event on the document, whose `detail` has the `question`, the `path` and the `transcript`. Cancel it and Haptic does nothing more:

```js
document.addEventListener("haptic:handoff", (event) => {
  event.preventDefault();
  openOurChat({ prefill: event.detail.question });
});
```

Creating the ticket in a helpdesk directly, through Zendesk's or Intercom's API, is not built.

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

The demo app has a small help centre of its own, in `demo/help`: twelve articles about a product that does not exist. Add `--answers on` to the command above to try Answers on it: ask "how long does an invite link last", then "how do I transfer ownership", which the articles leave out on purpose. One article, on roles, tells the reader to press a Remove button the app does not have, so there is something for the check against the live page to find. The plans article has prices and a refund rule in it, which Haptic must never state.

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
