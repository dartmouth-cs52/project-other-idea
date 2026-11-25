# Working on Haptic

Haptic is an AI guide a company adds to its web app with one script tag. A user says what they want to do, and it points at the control to click, step by step. This file is for coding agents. The [README](README.md) says what the product is, how to run it and how it is deployed.

## Layout

Three npm packages, each with its own `package.json` and lockfile. Install each with `npm ci`, which leaves the lockfile alone.

- **The top of the repository** is the widget and its server.
  - `src/widget`: the script on the customer's page. It reads the page, draws the pointer and the panel, and talks only to the server.
  - `src/server`: one request handler, `app.ts`. It runs under Node on a developer's machine (`index.ts`) and as a Cloudflare Worker online (`worker/index.ts`), so a change to it changes both.
  - `src/shared`: what the widget, the server and the dashboard's Worker all use, such as masking (`cleanText` in `types.ts`) and the endings a guide can have (`GUIDE_OUTCOMES`).
  - `src/intake`: the `npm run tag` CLI, which reads a site and its help docs.
  - `src/db` and `db/migrations`: the migration runner and the schema.
  - `test`: unit tests (`test/*.test.ts`) and the browser suites (`test/browser`, `test/widget`).
  - `eval`: the benchmark. `demo`: a small app to try the widget on.
- **`web/`** is joinhaptic.com, the dashboard, and the Worker behind them (`web/worker`). It has its own [AGENTS.md](web/AGENTS.md). Read it before writing any Next.js code: this version differs from the one you know.
- **`testbed/`** is Northpine, the stress-test app and live demo. It has its own [AGENTS.md](testbed/AGENTS.md), with its rules and the names of the traps it sets.

## Commands

All of these work from a fresh clone with no key and no database.

```bash
npm ci
npm run typecheck                 # tsc, strict
npm test                          # unit tests. Tests that need a browser or a database skip themselves
npm run build                     # the widget, to dist/
npm run eval -- --models mock     # the benchmark against the stand-in model
npm run dev                       # http://localhost:4000, with HAPTIC_MODEL=mock in .env
```

```bash
cd web && npm ci && npm run lint && npm test && npm run build
```

```bash
cd testbed && npm ci && npm run build
```

The browser suites (`npm run test:browser`, `npm run test:widget`, `npm run test:dashboard`) need Playwright's browsers, and the last needs a local Postgres. The README's Development section says how.

## What a change has to pass

- CI runs the typecheck, the unit tests and the build at the top, the lint, tests and build in `web/`, and the build and the phone check in `testbed/`.
- A change to the widget also runs both browser suites, in `widget-tests.yml`. A change to the dashboard runs `dashboard-tests.yml`.
- A change to the prompt or to how the server judges a reply should be measured on the staging server against the real model before visitors get it. `wrangler.staging.jsonc` has the two commands.
- Merging to `main` deploys. Nothing deploys from a pull request.

## What has to change together

- **A new table or column** is a new file in `db/migrations` with the next number. Migrations only add, because the code already live has to keep working on the migrated database. Both deploys apply them before they publish. Code that needs a new table has to cope with a database it hasn't reached: skip the feature and log which migration is missing.
- **What is kept about visitors** is described in `docs/operations.md`, in `docs/privacy.md` and on the website's privacy page, `web/app/privacy`. A change to what is kept changes all three.
- **A price** is changed in `web/lib/site.ts` and nowhere else, and then in Stripe with `npm run stripe:setup` in `web/`. The site's deploy stops if the two differ.
- **The model's prices** are in `src/server/prices.ts`, and each site's budget is worked out from them.
- **The hourly schedule** in `web/wrangler.jsonc` and `HOURLY` in `web/worker/handler.ts` have to match.
- **Colour, type, radii and motion** come from [DESIGN.md](DESIGN.md). The website's tokens are in `web/app/globals.css` and the widget's are in `src/widget/ui.ts`. The pointer is one path, in `assets/pointer.svg`, `web/components/pointer.tsx` and `src/widget/ui.ts`.
- **A new page on the website** needs a line in `web/public/sitemap.xml`.
- **Docs.** Each part has a doc, listed under Documentation in the README. Change the doc in the same change as the code it describes.

## Rules

- Never commit a secret, or a value from `.env` or `.dev.vars`. `.env.example` and `web/.dev.vars.example` hold names and where each value comes from, never the values.
- The widget's address, `widget.joinhaptic.com`, is in every customer's script tag and must never change.
- The widget never sends what a visitor typed, and reads nothing inside an area a visitor writes in. `test/widget/privacy.test.ts` and the red-team pages hold it to that.
- Do it with me never presses what saves, sends, pays or deletes. Every action passes the gate in `src/widget/gate.ts`, and the server checks it again with the same rules, in `src/shared/act-rules.ts`.
- No em dashes, in UI copy, comments or docs. Use a period or a comma.
