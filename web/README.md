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
- `app/contact/`: the request access page. `?topic=sales` opens it on the sales option.
- `app/privacy/`, `app/terms/`: plain text pages.
- `components/demo.tsx`: the scripted demo. One task on a loop, driven by a list of steps at the top of the file.
- `components/pointer.tsx`: the Haptic pointer. Same path as `../assets/pointer.svg` and the widget in `../src/widget/ui.ts`.
- `lib/site.ts`: the name, contact address, links and FAQ copy.
- `app/globals.css`: the colour, radius and motion tokens from `../DESIGN.md`.

## Not wired up yet

The contact form posts JSON (`email`, `company`, `topic`) to `/api/request-access`, or to `NEXT_PUBLIC_ACCESS_ENDPOINT` if set. Nothing answers at that address yet, so the form shows its fallback message, which asks people to email instead. The handler is added when the site is deployed.
