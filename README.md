# Haptic Labs

![Team Photo](Insert a Team Photo URL here)
[*how?*](https://help.github.com/articles/about-readmes/#relative-links-and-image-paths-in-readme-files)

Haptic is an AI guide that software companies add to their web app with one script tag. Users ask how to do something, and a pointer walks them to the right buttons, step by step, across menus and pages.

```html
<script src="https://<haptic-host>/sdk/haptic.js" data-key="pk_live_..." async></script>
```

See [PURPOSE.md](PURPOSE.md) for what it is and how it should feel, [AGENTS.md](AGENTS.md) for how the code fits together, and [DESIGN.md](DESIGN.md) for the UI spec.

## Architecture

An npm workspaces monorepo in TypeScript.

- `packages/protocol`: types, the streaming tag parser, prompt builder, path normalizing and masking, shared by the SDK and the server.
- `packages/sdk`: the embeddable script. Vite builds it into one file at `apps/web/public/sdk/haptic.js`. Preact for the caption, launcher and Ask bar.
- `apps/web`: Next.js 16. The public API (`app/api/v1`), the dashboard, and the marketing site.
- `apps/demo`: "Acme Console", a deliberately confusing dashboard used as the test bed.
- `supabase`: database migrations for accounts, sites and the learned site map. We plan to move this to our own backend on Neon.
- `e2e` and `eval`: Playwright end-to-end tests and model accuracy and latency evals.

Models: Gemini Flash-Lite by default, with Claude as an option. Tests use Vitest and Playwright.

## Setup

```bash
npm install
cp .env.example apps/web/.env.local   # HAPTIC_MODEL=mock works with no keys
npm run dev
```

Then open http://localhost:4100, click **Ask** in the corner, and try "how do I create an API key".

Without Supabase the API serves a built-in dev site (`pk_dev_local`). To run the database locally, `npm run db:start` starts Supabase in Docker. Copy the URL and keys from `npx supabase status` into `apps/web/.env.local`.

Never commit `.env.local` or any real keys. `.env.example` lists every variable with empty values.

## Deployment

TODO: how to deploy the project

## Authors

TODO: list of authors

## Acknowledgments
