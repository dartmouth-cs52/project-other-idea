# Working on Haptic

Read PURPOSE.md first. It settles questions about tone, visuals and scope.

## Commands

```bash
npm install
npm run dev            # SDK watch build, web on :4000, demo on :4100
npm test               # protocol + server unit tests (fast, Node)
npm run test:browser   # SDK tests in Chromium, WebKit and Firefox (needs `npx playwright install`)
npm run typecheck
npm run build -w @haptic/sdk   # rebuild apps/web/public/sdk/haptic.js once
npm run e2e            # Playwright: the demo driven end to end with the mock model
npm run eval -- gemini-3.5-flash-lite gemini-3.8-flash   # pointing accuracy and latency per model
npm run eval:guides -- gemini-3.5-flash-lite              # whole guides on the demo: finished, stopped in time, no loops
npm run db:start       # local Supabase in Docker; db:reset re-applies migrations, db:types regenerates types
```

Accounts, sites and the learned site map live in Supabase. `npm run db:start` runs it locally; copy the URL and keys from `npx supabase status` into `apps/web/.env.local` (see `.env.example`). Without Supabase the API still serves the built-in dev site (`pk_dev_local`).

Open http://localhost:4100 to try the demo with Haptic installed. Without any keys, set `HAPTIC_MODEL=mock` in `apps/web/.env.local` and the API answers with a scripted model that knows the demo's flows ("create an API key", "invite a teammate", "manage plan").

## Layout

- `packages/protocol`: types, the streaming tag parser, prompt builder, path normalizing and masking. Shared by SDK and server, so it uses no DOM or Node APIs. Imports use `.ts` extensions.
- `packages/sdk`: the embeddable script. Vite builds it into one IIFE at `apps/web/public/sdk/haptic.js`.
  - `snapshot/` turns the page into the element list the model sees.
  - `guide/` runs ask → point → wait for click → settle → continue, plus SPA route detection and sessionStorage resume.
  - `ui/` holds the overlay (pointer and highlight, driven per frame) and the Preact caption, launcher and Ask bar.
  - `host.ts` is our one element on the page: shadow root, top-layer popover, modal dialog handling.
- `apps/web`: Next.js 16. Public API in `app/api/v1`, server code in `lib/`. Read `apps/web/AGENTS.md` before changing Next code: this Next version differs from older docs, and its own docs live in `node_modules/next/dist/docs/`.
- `apps/demo`: "Acme Console", a deliberately confusing dashboard used as the test bed. New project opens a three-page wizard, so a guide has to press Next twice.
- The marketing site is `apps/web/app/page.tsx` with its sections in `app/_landing/`. It follows Wispr Flow's layout in black and white: EB Garamond headlines with an italic turn, Figtree body text, 32px-radius cards. Motion is CSS with reduced-motion fallbacks, and the "See it work" demo is a scripted mock app, not the SDK.

## SDK rules

The SDK runs on customers' pages. It must:
- never throw into the page. Entry points catch and log with a `[Haptic]` prefix.
- never change the customer's DOM except our `<haptic-root>` host.
- never read input values. Labels only.
- set model text as text, never as HTML.
- stay under 40KB gzipped. Vite prints the size on build.

Key and focus events from our UI are stopped at the host so page shortcuts and focus traps don't react to typing in the Ask bar.

## Voice (switched off)

Voice is built but disabled: in testing, recognition was too poor to ship. It's behind `HAPTIC_VOICE=on` (default off). With the flag off, `/session` reports `voiceEnabled: false` for every site, so the launcher doesn't start push-to-talk, `Haptic.ask(q, { speak: true })` stays silent, `/voice-token` returns 403, and the dashboard hides the voice checkbox. The code below is kept for when we pick it back up.

Holding the launcher for 300ms starts push-to-talk (`voice/controller.ts`). The SDK gets single-use ElevenLabs tokens from `/api/v1/voice-token` and connects straight to ElevenLabs: Scribe realtime for speech-to-text (16kHz PCM, manual commit on release) and `stream-input` for speech (Flash v2.5, PCM 24kHz). `SpeechChunker` in protocol sends the first clause early and then whole sentences, each with `flush: true`. Guides started by voice speak every step; typed guides stay silent. After a full page load a resumed guide is silent, because browsers block audio until the user interacts with the new page.

## Black and white UI

The SDK's default `accent` is `"auto"`. `ui/tone.ts` reads the background color under a point by walking up from `elementsFromPoint` and blending translucent layers. The overlay uses it to make the pointer and highlight black or white, checked when the pointer lands and every 400ms while it tracks. `pageIsDark` samples five points across the viewport, and the caption, Ask bar and launcher take the opposite tone. A hex accent from the dashboard replaces this with the customer's color.

## Server rules

- `/api/v1/turn` is the hot path: verify the JWT locally, no database reads. Site knowledge is cached for 60 seconds.
- Validate every request body with the schemas in `lib/validate.ts`. Customer pages are untrusted input.
- CORS headers reflect the requesting origin, but the origin check against the site's allowed list happens in `/session`, and the token is bound to that origin.

## Site learning

The SDK sends an outline of each route once per tab: title, headings, link labels and button labels, including icon-only buttons as `icon:share-2`. It also records which click led to which route. Labels are counted per distinct visitor: the SDK keeps a random ID in localStorage, `/session` hashes it per site into the token, and `outline_labels.visitors` stores up to 10 hashes per label. A label reaches the prompt once `visitor_count` meets `HAPTIC_LABEL_THRESHOLD`, which is 3 in production and 1 in development.

## Following along

After each step the model needs to know what the user's action did, or it repeats itself. Three things handle that:

- Each continue turn carries `change`, built by `describeChange` in `protocol/change.ts` from the last snapshot and the new one: "Dialog "Create API key" opened", "checkbox ... is now checked", "New text: "Step 2 of 3"", or "Nothing visible on the page changed." Element IDs change between snapshots, so elements are matched by role, label, icon and link. On a new route or dialog it names the route or dialog instead of listing every element.
- When the target is a text field, select or file input, the guide waits for the user to type (a 1.2s pause) or pick a value, not for the click into the field, and sends a `filled` event. It still never reads the value.
- Partway through a guide, a step that points at something waits for the click even if the model left off `<wait/>`. A first answer that points without `<wait/>` is treated as an explanation, but if the user then clicks what it pointed at, the guide carries on so the model can confirm where they ended up ("where is home" → click → "You're on the home page"). Clicking anything else or changing pages another way clears the pointer.
- Before the pointer moves, `GuideController.repeatNudge` checks whether the step points at something the user already used while the page looks the same as it did then. That covers the same button twice and two fields in turn. The step is held back and asked again with a `nudge`. If the model repeats anyway, the guide stops with "That step didn't change anything I can see". Three steps in a row on one element with the page changing each time (Next in a wizard) get one second look, then go through.

- If the route changes while the model is answering, the answer is about a page the user already left. The SDK cancels it and starts over from the new page with a `navigated` event. The server records that turn as `cancelled`.

`e2e/repeats.spec.ts` drives these with a scripted model. `npm run eval:guides` measures them with a real one.

## Coordinates

There are none. The model points by element ID (`e14`) from the snapshot and the SDK reads the element's live position. IDs are only valid for the snapshot they came from, so history keeps only the text of past replies. An earlier version wrote `[pointed at button "Next"]` into history, and the model started copying that into replies instead of a real point tag.

## Model choice

`npm run eval` replays `eval/cases/demo.json` (20 snapshots of the demo with the expected element for each question) through the real `/turn` endpoint. Results on 2026-10-10:

| Model | First-step hits | p50 first point | Notes |
|---|---|---|---|
| gemini-3.5-flash-lite (minimal thinking) | 37/40 | ~0.6s alone, ~1.5s with 4 in parallel | default |
| gemini-3.8-flash (low thinking) | 15/20 | ~3s | 3 timeouts at the 8s first-token limit |

The in-page five-task benchmark on the demo went 5/5 for both, with Flash-Lite 3-4x faster. Re-run the eval before changing the prompt or the default model.

`npm run eval:guides` runs seven whole tasks on the demo in Chromium, with a simulated user who clicks whatever Haptic points at. Flash-Lite, three runs each, on 2026-10-14:

| | Finished | Stopped by itself | Extra steps after finishing | Re-pointed after a no-op click | Clicks (fewest possible: 93) |
|---|---|---|---|---|---|
| Before the change summary and repeat guard | 16/21 | 17/21 | 38 | 36 | 133 |
| After | 19/21 | 21/21 | 2 | 0 | 89 |

Before, "region" pointed at the Region dropdown 12 times in a row and "plan" went Team → Team → Team. Both misses after are "two-factor", where the model says "Enable the checkbox" and ends with `<done/>` instead of pointing at it.

## Pilot

Flasht (`~/Projects/Flasht/flasht`) on branch `haptic-pilot`, port 3000. The only change there is a `next/script` tag in `app/layout.js`.

Findings from the pilot that shaped the code:
- The account menu is a button showing only the user's initial ("T"). The `short-text` hint plus a prompt line about one- or two-letter buttons gets the model there.
- Most buttons are lucide icons with no label. The `icon:` hint comes from the `lucide-*` class.
- Pages show a full-screen spinner while the user loads, so settling waits for visible `.animate-spin`, skeletons and `aria-busy` before snapshotting.
- Import only exists on `/create`. Questions about it from other pages work once the learned site map has seen `/create`.
- Flasht's gear icon on the set page links to `/edit/undefined`, a Flasht bug.
- Share is the 13th button on `/set/:id`, and the site map used to cap each page at 12. Navigation that repeats on most pages (`My cards`, `New +`, the `T` menu) is now listed once, and each page gets up to 24 buttons.
- Getting to a set's page from `/home` means opening a set's dialog and clicking View. The SDK learns this from clicks: a route change within 8 seconds of a click stores the clicked label as a link on the page it came from ("View, in a dialog → /set/:id").
- Clicking View in a set's dialog takes a moment to load `/set/:id`. Settling sees no DOM changes in the meantime, so the next snapshot was still `/home` and the model pointed at View again. Turns now restart when the route changes mid-answer.
- The Restart button at the end of a deck sits under the card stack. The snapshot hit-tests on-screen controls with `elementFromPoint` and leaves out anything covered (`snapshot/occlusion.ts`).

## Gotchas

- Native `<dialog>.showModal()` makes everything outside the dialog inert. The host moves itself into the open modal and re-shows as a popover. Tested in `packages/sdk/test/browser`.
- `cursor: pointer` is inherited, so the clickable-div heuristic only counts the element where the cursor starts.
- `checkVisibility` deliberately skips the opacity check: hover-revealed row actions are real controls.
- Covered isn't the same as scrolled away. The occlusion check ignores parts clipped by a scroll container, and anything under a sticky header or fixed toolbar that would be uncovered once the element is scrolled to the middle of the screen.
- The Anthropic SDK reads `ANTHROPIC_BASE_URL` from the environment. `lib/llm/claude.ts` pins the base URL so a shell setting can't reroute traffic.
- Gemini 3.6+ rejects temperature/topP/topK in future models; don't send them. Keep thinking at the lowest level or the first token takes seconds.

## Design mockups

Read DESIGN.md before touching any UI. The round-2 mockups on MagicPatterns (Haptic) are the spec for every screen. Build screens in this repo from DESIGN.md and the mockups, and don't copy MagicPatterns code into the repo.
