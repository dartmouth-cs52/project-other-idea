# Haptic website

The marketing site for Haptic, served at joinhaptic.com. Next.js with Tailwind and shadcn/ui, exported as a fully static site.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # writes the static site to out/
npm run lint
```

## What's here

- `app/page.tsx`: the landing page (hero, demo, FAQ).
- `app/request-access/`: the request access page, the one call to action on the site.
- `app/privacy/`, `app/terms/`: plain text pages.
- `components/demo.tsx`: the scripted demo. One task on a loop, driven by a list of steps at the top of the file.
- `components/pointer.tsx`: the Haptic pointer. Same path as `../assets/pointer.svg` and the widget in `../src/widget/ui.ts`.
- `lib/site.ts`: the name, contact address, links and FAQ copy.
- `app/globals.css`: the colour, radius and motion tokens from `../DESIGN.md`.

## The request access form

The form posts JSON (`email`, `company`) to `/api/request-access`. On Cloudflare that is answered by the Worker in `worker/index.ts`, which checks the email address and saves the request in a KV namespace. Nothing else about the visitor is kept.

`npm run dev` runs the pages only, so the form shows its fallback message there. To try the form locally, use `npm run preview`.

## Deploying

The site runs on Cloudflare as one Worker: the static pages from `out/`, plus the form handler. The settings are in `wrangler.jsonc`.

```bash
npm run preview   # builds, then serves the site and the Worker at http://localhost:8787
npm run deploy    # builds, then publishes to Cloudflare
```

`npm run deploy` uploads the pages in `out/` separately from the Worker, which is the standard way. There is a second way, `npm run deploy:embedded`, which packs the pages inside the Worker. Use it from machines where the separate upload fails with a 401, such as a Claude cloud session whose network layer rewrites the Authorization header. It works while the site stays under 3 MB compressed. The site that is live now was published this way.

Deploying needs a Cloudflare API token in `CLOUDFLARE_API_TOKEN`. Every deploy goes straight to the live site at joinhaptic.com, because the domain is attached in the `routes` setting. The Worker sends www and plain http to https://joinhaptic.com. The same deploy is also reachable at haptic-web.joinhaptic.workers.dev, which is marked so search engines skip it. To read the requests that have come in:

```bash
npx wrangler kv key list --binding ACCESS_REQUESTS --remote
```
