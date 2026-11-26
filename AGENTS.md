# Working on Haptic

Haptic is an AI guide a company adds to its web app with one script tag, or to its native Mac app with one call. A user says what they want to do, and it points at the control to click, step by step. This file is for coding agents. The [README](README.md) says what the product is, how to run it and how it is deployed.

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

- **`mac/`** is not an npm package. It is a Swift package for macOS 13 and later: Haptic for native Mac apps. [docs/mac.md](docs/mac.md) and [docs/mac-northpine.md](docs/mac-northpine.md) describe it.
  - `Sources/HapticKit`: what a company adds to its app. It mirrors the web side file for file. `Snapshot.swift` makes the `Snapshot` of `src/shared/types.ts` from an accessibility tree, `Masking.swift` is `cleanText`, and `Client.swift` makes the calls `src/server/app.ts` answers. `LiveTree.swift` is the running app's own tree and menu bar, `Guide.swift` is the guide loop, and `Stage.swift` draws the Ask button, the pointer and the caption.
  - `Sources/HapticDemo`: Acme Desk, a small app to try it on.
  - `Sources/Northpine`: Northpine for Mac, the large test app, the native cousin of `testbed/`. One file a screen in `Screens/`, the made-up company in `Data/Seed.swift`, the switches that make it hard in `Lab.swift`, and the tasks that run by themselves in `Tasks.swift` and `Autopilot.swift`.
  - `Tests`: the reader on trees written out by hand, and Northpine's seed, palette and Lab.

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

```bash
cd mac && swift build && swift test   # needs a Mac with Xcode's command line tools. No key and no server
```

Two more for the Mac side, which open a window on the screen. `swift run Northpine --dump` prints what Haptic reads from every screen, one line for each control, and is the quickest check on a change to the reader. `mac/scripts/replay-tasks.sh` runs Northpine's sixteen tasks through Haptic with nobody at the keyboard. It needs the server running with a real key and Northpine's site file in `data/sites`, so it is run by hand and never in CI.

The browser suites (`npm run test:browser`, `npm run test:widget`, `npm run test:dashboard`) need Playwright's browsers, and the last needs a local Postgres. The README's Development section says how.

## What a change has to pass

- CI runs the typecheck, the unit tests and the build at the top, the lint, tests and build in `web/`, and the build and the phone check in `testbed/`.
- A change to the widget also runs both browser suites, in `widget-tests.yml`. A change to the dashboard runs `dashboard-tests.yml`. A change to the code that signs in with a test account (`web/worker/sign-in.ts`, `web/worker/map-begin.ts`) runs the browser suites too, because its tests are there, in `test/browser/sign-in.test.ts`.
- A change under `mac/` builds and tests the Swift package on a Mac, in `mac-tests.yml`.
- A change to how HapticKit reads a window gets a test on a tree written out by hand, in `mac/Tests/HapticKitTests`, and a look at `swift run Northpine --dump` before and after.
- A change to the prompt or to how the server judges a reply should be measured on the staging server against the real model before visitors get it. `wrangler.staging.jsonc` has the two commands.
- Merging to `main` deploys. Nothing deploys from a pull request.

## What has to change together

- **A new table or column** is a new file in `db/migrations` with the next number. Migrations only add, because the code already live has to keep working on the migrated database. Both deploys apply them before they publish. Code that needs a new table has to cope with a database it hasn't reached: skip the feature and log which migration is missing.
- **What is kept about visitors** is described in `docs/operations.md`, in `docs/privacy.md` and on the website's privacy page, `web/app/privacy`. A change to what is kept changes all three.
- **A price** is changed in `web/lib/site.ts` and nowhere else, and then in Stripe with `npm run stripe:setup` in `web/`. The site's deploy stops if the two differ.
- **The model's prices** are in `src/server/prices.ts`, and each site's budget is worked out from them.
- **The hourly schedule** in `web/wrangler.jsonc` and `HOURLY` in `web/worker/handler.ts` have to match.
- **Colour, type, radii and motion** come from [DESIGN.md](DESIGN.md). The website's tokens are in `web/app/globals.css` and the widget's are in `src/widget/ui.ts`. The pointer is one path, in `assets/pointer.svg`, `web/components/pointer.tsx`, `src/widget/ui.ts` and `mac/Sources/HapticKit/Stage.swift`.
- **The widget and HapticKit** send the server the same thing. A change to the `Snapshot` in `src/shared/types.ts`, to `cleanText`, or to what `/v1/turn` and `/v1/sites` take and give back has to be made in `mac/Sources/HapticKit` too, in `Snapshot.swift`, `Masking.swift` and `Client.swift`. Masking is rule for rule the same on both sides, and `MaskingTests.swift` holds the Swift side to it.
- **A Mac app's origin** is `app://` and its bundle identifier. `APP_ORIGIN` in `src/shared/types.ts` says what counts as one, the dashboard's allowed origins accept it (`web/worker/app-api.ts`), and `Client.swift` sends it.
- **A screen of Northpine for Mac.** After changing one, write the site file again with `swift run Northpine --site > northpine-site.json` in `mac/`, and commit it. A new state behind a click, such as a sheet, goes in `Dump.opened` so the dump and the site file both reach it.
- **Mapping the signed-in app** has two ways in, and the dashboard offers both on one card (`MapApp` in `web/components/app/site-view.tsx`). In the company's own browser it is the widget's mapper (`src/widget/map.ts`). With a test account it is the site Worker, in a browser of its own: `web/worker/map-run.ts` starts it, `sign-in.ts` signs in and `map-begin.ts` starts the same mapper there. The two share the mapper's state (`MAP_KEY` and `newMapState` in `src/shared/mapping.ts`), so a change to that state changes both.
- **What Haptic does with a test account** is described in `docs/widget.md`, in `docs/privacy.md` and on the website's privacy page. It is the one place Haptic types a password, so a change to `sign-in.ts` changes all three.
- **A new page on the website** needs a line in `web/public/sitemap.xml`.
- **Docs.** Each part has a doc, listed under Documentation in the README. Change the doc in the same change as the code it describes.

## Rules

- Never commit a secret, or a value from `.env` or `.dev.vars`. `.env.example` and `web/.dev.vars.example` hold names and where each value comes from, never the values.
- The widget's address, `widget.joinhaptic.com`, is in every customer's script tag and must never change.
- The widget never sends what a visitor typed, and reads nothing inside an area a visitor writes in. `test/widget/privacy.test.ts` and the red-team pages hold it to that.
- A test account's name and password are held for the one call that signs in, and are never saved, logged or put in an error. Haptic types them only on an address the site has allowed, tries once, and stops at a captcha or a code. `test/browser/sign-in.test.ts` holds it to that.
- HapticKit only points. It never presses a control in the app, and it asks a text field for its name and nothing else. Northpine's autopilot is the test's stand-in for a person, and is not part of HapticKit.
- Do it with me never presses what saves, sends, pays or deletes. Every action passes the gate in `src/widget/gate.ts`, and the server checks it again with the same rules, in `src/shared/act-rules.ts`.
- No em dashes, in UI copy, comments or docs. Use a period or a comma.
