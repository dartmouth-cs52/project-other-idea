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

## The paintings

The picture behind each feature demo is a public domain painting from the Art Institute of Chicago's open access collection, which the museum releases under CC0. No credit is required. The rules for choosing and treating them are in `../DESIGN.md`, under Colors.

| File in `public/art/` | Painting | Museum page |
| --- | --- | --- |
| `heade-york-harbor.webp` | Martin Johnson Heade, *York Harbor, Coast of Maine*, 1877 | https://www.artic.edu/artworks/152747 |
| `inness-home-of-the-heron.webp` | George Inness, *The Home of the Heron*, 1893 | https://www.artic.edu/artworks/64724 |
| `whistler-nocturne.webp` | James McNeill Whistler, *Nocturne: Blue and Gold—Southampton Water*, 1872 | https://www.artic.edu/artworks/56905 |

Each was downloaded from the museum's image server, resized to 1400px wide and saved as WebP. Together they weigh about 105 KB. To add one, check that the museum's record says `is_public_domain: true` before using it.

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

Deploying needs a Cloudflare API token in `CLOUDFLARE_API_TOKEN`. Any address other than joinhaptic.com is treated as a preview and is marked so search engines skip it. To read the requests that have come in:

```bash
npx wrangler kv key list --binding ACCESS_REQUESTS --remote
```
