# Haptic

[![CI](https://github.com/dartmouth-cs52/project-other-idea/actions/workflows/ci.yml/badge.svg)](https://github.com/dartmouth-cs52/project-other-idea/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)
[![Website](https://img.shields.io/badge/web-joinhaptic.com-1E6EF4)](https://joinhaptic.com)

**An AI guide that lives inside any web app.** A software company adds one script tag to their product. When a user asks *"how do I invite a teammate?"*, Haptic doesn't answer with a wall of help-center text. It moves a pointer to the right button, waits for the user to click it, reads the new page, and points at the next one, across menus, dialogs and full page loads, until the task is done.

![Haptic pointing a user to the Team page in the demo app](docs/demo.png)

**Website:** [joinhaptic.com](https://joinhaptic.com)

## Why

Help docs go stale and users don't read them. Product tours are scripted by hand and break whenever the UI changes. Haptic reads the live page on every step, so it follows whatever the UI is today, and it learns the product from what the company already has: the site itself, its help docs, and a few notes.

## How it works

```
npm run tag ──▶ data/sites/<id>.json ──▶ server ◀── widget.js on the customer's site
 (crawl + docs)   (the site's context)     │   POST /v1/turn: the page as a list of elements
                                           ▼
                                        Claude: { target: "e12", say: "Click Team.", status: "continue" }
```

There are three parts to the product, plus the website:

| Part | Path | What it does |
|---|---|---|
| **Widget** | `src/widget` | The script customers embed (about 22 KB minified, no dependencies). It renders in a shadow root so it can't clash with the host page's styles. It snapshots the page, draws the pointer and caption, and watches for the user's action. |
| **Server** | `src/server` | Plain Node `http` with no framework. It serves the widget, checks each request's origin against the site's allowlist, rate-limits, validates and caps the input, and makes one Claude call per step. |
| **Intake** | `src/intake` | A CLI that crawls the customer's site into a page graph, loads their help docs from files, folders or URLs, saves the result, and prints the script tag. |
| **Website** | `web` | The landing page at [joinhaptic.com](https://joinhaptic.com): Next.js, Tailwind and shadcn/ui, exported as a static site and served by a Cloudflare Worker that also handles the request-access form. See [`web/README.md`](web/README.md). |

The widget and the website share one design system, defined in [`DESIGN.md`](DESIGN.md). The pointer is [`assets/pointer.svg`](assets/pointer.svg).

### One step of a guide

1. **Snapshot.** The widget walks the DOM once and lists every interactive control with a short id (`e12`), its role, label, state (`checked`, `collapsed`, `disabled`) and where it sits on the page (`nav`, `main › Billing`). When a dialog is open, only the dialog's controls are listed.
2. **Decide.** The server sends that snapshot, the goal and the conversation so far to Claude. The reply must match a strict schema (`target`, `say`, `status`, validated with Zod), and a `target` that isn't on the current page is dropped. The model can only point at things the user can actually see.
3. **Point.** The widget scrolls to the element, rings it, and shows the caption.
4. **Observe.** It waits for the user to click, or to stop typing, then waits for the DOM to settle and sends the new page with a summary of what changed. The next step builds on that.
5. **Survive navigation.** Guide state lives in `sessionStorage`, so a click that loads a new page picks the guide back up where it left off.

### Engineering details

- **Prompt caching.** The rules, site map and help docs are identical for every turn on a site, so they form a cached system prompt. Only the live page and progress go in the per-turn message, which keeps latency and cost per step low.
- **The site as a graph.** The crawler collapses dynamic routes (`/orders/123` becomes `/orders/:id`), records which page each link leads to, and lists navigation shared by most pages only once. The model gets a compact map it can use to plan paths to pages the user isn't on yet.
- **Privacy.** The widget never reads what users type into fields. It reads labels only, and masks emails and long numbers before anything leaves the browser.
- **Untrusted input.** Customer pages are treated as hostile. Every field of a turn request is type-checked and length-capped on the server, and page content is fenced off in the prompt as data the model must not take instructions from.
- **Help docs fit whole or not at all.** A 60K-character budget decides which docs go in the prompt. A doc that doesn't fit is left out entirely, never cut off mid-sentence.
- **Mock mode.** `HAPTIC_MODEL=mock` swaps Claude for a keyword matcher, so the whole loop can run and be tested with no API key.

## Quick start

Requires Node 20 or later.

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY, or set HAPTIC_MODEL=mock
npm run dev            # http://localhost:4000, with a demo app at /demo/
```

In a second terminal, build the demo app's context:

```bash
npm run tag -- --url http://localhost:4000/demo/ --id site_demo --name "Acme Console" \
  --notes demo/notes.md --docs demo/help
```

Open http://localhost:4000/demo/, click **Ask**, and try *"how do I change my billing info"*. Billing sits behind the account menu, so Haptic first has to open the menu and then follow the path to the billing page.

## Adding Haptic to a real site

```bash
npm run tag -- --url https://app.example.com --name Example \
  --notes notes.md --docs help/ --docs https://example.com/faq
```

The command prints a tag to paste before `</body>`:

```html
<script src="https://<your-haptic-host>/widget.js" data-site="site_ab12cd34ef" async></script>
```

`npm run tag -- --help` lists every option, including the accent color, launcher position and label, and extra allowed origins such as staging. To keep a site's knowledge current, schedule `npm run tag -- refresh --all`. The server picks up changed site files without a restart.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required unless `HAPTIC_MODEL=mock`. |
| `HAPTIC_MODEL` | `claude-opus-5-5` | Any Claude model ID, or `mock`. |
| `HAPTIC_PUBLIC_URL` | `http://localhost:4000` | Where browsers reach the server. Goes into the generated script tag. |
| `PORT` | `4000` | Port the server listens on. |
| `NODE_ENV` | none | Set to `production` to let browsers cache `widget.js` for five minutes. |

## Deployment

### Website

The site in `web/` is live at [joinhaptic.com](https://joinhaptic.com) on Cloudflare. `npm run deploy` from `web/` builds it and publishes it. It needs `CLOUDFLARE_API_TOKEN`. [`web/README.md`](web/README.md#deploying) covers local preview and the form's storage.

### Widget server

The widget server isn't hosted yet. It is a single long-running Node process, so any host that runs Node 20 works (Render, Fly.io, Railway, a VM):

```bash
npm ci
NODE_ENV=production HAPTIC_PUBLIC_URL=https://haptic.example.com npm start
```

The widget is bundled on startup. Site contexts are JSON files in `data/sites/`, so that directory needs persistent storage, and the `npm run tag` CLI must write to the same place the server reads from.

## Development

```bash
npm test            # unit tests (node:test)
npm run typecheck   # tsc in strict mode
npm run build       # bundle the widget to dist/widget.js
```

The website has its own commands in `web/` (`npm run dev`, `npm run lint`, `npm run build`). CI typechecks, tests and builds the widget server, and lints and builds the website, on every push and pull request.

```
src/
  widget/   snapshot.ts (DOM → element list) · guide.ts (step loop) · ui.ts (pointer, caption, launcher)
  server/   index.ts (HTTP + validation) · model.ts (Claude call) · prompt.ts · sites.ts
  intake/   cli.ts · crawl.ts · docs.ts
  shared/   types.ts (the contract between widget, server and intake)
web/        the website (Next.js, deployed to Cloudflare)
demo/       a small multi-page app to try the widget on
test/       unit tests
assets/     the Haptic pointer
DESIGN.md   the design system: colours, type, radii and motion for the widget and the website
```

## Limitations and roadmap

- The crawler reads server-rendered HTML. Single-page apps and pages behind a login come back nearly empty, and the CLI flags them. The widget still reads every page live, so on those sites guidance leans on notes and docs. A headless-browser crawl is next.
- Site contexts are JSON files. A database, accounts and a dashboard for companies to manage their sites come with the hosted version.
- Rate limiting is in memory and per process.

An earlier prototype is kept on the [`v1`](https://github.com/dartmouth-cs52/project-other-idea/tree/v1) branch for reference.

## Team

Built for Dartmouth's CS 52 (Full-Stack Web Development) by:

- Theodore Chan ([@TheoC26](https://github.com/TheoC26))
- Charlie Peers ([@charliepeers](https://github.com/charliepeers))
- Isaac Saxonov ([@clewner](https://github.com/clewner))
