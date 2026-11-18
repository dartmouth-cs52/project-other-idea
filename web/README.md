# Haptic website

The marketing site for Haptic, served at joinhaptic.com. Next.js with Tailwind and shadcn/ui, exported as a fully static site.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # writes the static site to out/
npm run lint
npm test         # the Worker's tests that need this folder's packages (test/)
```

The rest of the Worker's tests are at the top of the repository, in `../test/`. Those that run its queries need a Postgres: set `TEST_DATABASE_URL` to an empty local one, never a real one, as CI does. The browser tests for the setup screens and the pill are `../test/browser/setup-flow.test.ts` and `agent-pill.test.ts`.

## What's here

- `app/page.tsx`: the landing page (hero, demo, feature cards, pricing, FAQ).
- `app/request-access/`: the request access page, the one call to action on the site.
- `app/privacy/`, `app/terms/`: plain text pages.
- `components/demo.tsx`: the scripted demo. One task on a loop, driven by a list of steps at the top of the file.
- `components/pointer.tsx`: the Haptic pointer. Same path as `../assets/pointer.svg` and the widget in `../src/widget/ui.ts`.
- `lib/site.ts`: the name, contact address, links, FAQ copy and the pricing plans. A price is changed there and nowhere else. Billing reads the same plans: see [Billing](#billing).
- `components/haptic-tag.tsx` and `haptic-notes.md`: Haptic itself, running on this site so people can try it. See [Haptic on this site](#haptic-on-this-site).
- `public/sitemap.xml` and `public/robots.txt`: the list of pages for search engines. Add a line to the sitemap when a page is added.
- `app/globals.css`: the colour, radius and motion tokens from `../DESIGN.md`.

## The request access form

The form has two steps and is sent once, at the end. It posts JSON (`email`, `company`, `firstName`, `lastName`, `details`) to `/api/request-access`. On Cloudflare that is answered by the Worker, in `worker/handler.ts`. The Worker checks the entry, saves it in a KV namespace, then emails the team a copy. Nothing else about the visitor is kept.

Every field but `details` is required. The rules live in one file, `lib/access-request.ts`, which the page and the Worker both use, so a request that skips the page is held to the same standard. The Worker adds one check the page cannot make: it asks DNS whether the email's domain can receive mail, which catches mistyped and made up addresses. Personal mailboxes such as Gmail are accepted, and marked as such in the copy the team gets.

The email copy goes to the address in the Worker's `NOTIFY_TO` secret, which is not in this repository. Cloudflare only delivers to an inbox that is verified under Email Routing, as a destination address. To change it:

```bash
npx wrangler secret put NOTIFY_TO
```

Replying to one of those emails answers the person who sent the request. If the email fails, the request is still saved. Two things keep the inbox from being flooded: one address gets 5 tries a minute (an IPv6 address is counted with the rest of its /64, which one connection is usually given whole), and a hidden field that people never see catches programs that fill in everything.

`npm run dev` runs the pages only, so the form shows its fallback message there. To try the form locally, use `npm run preview`.

## Sign-in, approval and the dashboard

Companies sign up by invitation. The pages are `app/sign-in/`, `app/dashboard/`, `app/approve/` and `app/install/`. They are static and fetch everything from the Worker, whose code is in `worker/`:

- `worker/auth.ts` passes `/api/auth/*` through to Neon Auth, so the session cookie is joinhaptic.com's own and Safari keeps it. Only the four calls the pages make are passed on (`AUTH_CALLS`): the session check, the two ways to sign in, and signing out. Anything else Neon answers, such as its API reference or `organization/*`, through which an owner or admin could add people and owners past the Team page's rules, is a 404 here and never reaches Neon. A page that starts using another of Neon's calls has to add it to that list. This does not cover calls made straight to `NEON_AUTH_URL`, which is public and is in every emailed link: someone signed in can send their own session there. What must not be done that way has to be turned off in Neon Auth's own settings. Sign-in is an emailed link or Google. Both come back to the list of sites, `/dashboard/?view=sites`, with a one-time verifier that the browser client in `lib/auth-client.ts` exchanges through this proxy. Each sign-in try can send an email, and Neon sees every caller as this Worker, so the Worker limits them itself, to 10 a minute per address, or per /64 for IPv6. That limit can't hold for someone who asks Neon straight, so the emails themselves are limited too, below.
- `worker/app-api.ts` answers `/api/app/*`: who is signed in, their company's sites, install health, the dashboard and each guide's steps. Every site is looked up with the caller's organization.
- `worker/reader.ts` reads a new site's public pages a few at a time, in a real browser through Cloudflare Browser Rendering, or as plain HTML when that is not available. It follows links, tabs, menus and accordions only, and in the browser every request other than GET is refused, so it cannot change anything on the customer's site. It starts from the address pasted, then the links on that page, then the pages the site's sitemap lists. If the address redirects to the same site's other name, acme.com to www.acme.com or http to https, that becomes the site's origin and is allowed too. A redirect anywhere else, such as to a sign-in service, is not followed, and the dashboard then says the site could not be read and offers to try again.
- `worker/insights.ts` is the dashboard's queries. `headline` at its end is the top row: guides finished (by when they finished, as billing counts them), finish rate, questions Haptic couldn't guide and the median time to finish, each against the same number of days before, and each day's guides started and finished. `live` is a site's twenty newest questions and the step each is on, in one query, with a `stamp` that changes whenever anything about the last day's questions does. `sitesOverview` is every site's card for the list of sites.
- `worker/setup-api.ts` answers the setup screens at `app/dashboard/setup/`, where a company adds a site one question at a time: the address, reading its pages, what Haptic learned (with a "Never touch" list that feeds Never point at), adding the script, and seeing it connect. The screen it is on is kept in the site's context as `setup`, so a reload lands on it. The steps are listed in `lib/setup.ts`. A new address on the first screen changes the site in place, keeping all that was set up, until the script has called from an address the site allows. A call from one it doesn't allow is not counted, since anyone who knows the site's id can send one with a made-up Origin. It also sends "Email it to my developer" through Resend from install@joinhaptic.com, naming the sender by their sign-in address, with replies going to them. In any 24 hours a company sends one mailbox 3 and everyone together 6 (the mailbox written one way, so a +tag or Gmail's dots count as the same), a site sends 10, a company 20 and one person 10. One person may also have 30 presses reach Resend in any hour, sent or turned down, since one turned down doesn't count toward the rest. Every limit gives the same answer, naming no cause. Each email is a row in `developer_emails` (`../db/migrations/0013`), holding a hash of the mailbox, the site, the company, the sender and the time, deleted once a day old. Until that migration is applied, the form says email isn't set up and offers the link to copy.
- `worker/playbook.ts` serves `/install/<site>.md`, the steps a coding agent follows. The "Onboard your agent" pill (`components/app/agent-pill.tsx`) copies one line pointing at it, and opens Claude Code, Cursor or Codex by their own links (`lib/agents.ts`). Every way of sending the prompt copies it first and says whether the app opened (`lib/hand-off.ts`), because a link to an app that isn't installed does nothing at all.
- `worker/brand.ts` reads a site's icon and its own colour from its first page and the stylesheets it links: a custom property named for it such as `--brand` or `--primary`, then `theme-color`, the manifest, an SVG icon's fill, and last the colour written most often. A grey, a near white or a near black is never the answer. `GET /api/app/sites/:id/brand` returns both and keeps nothing. The colour is the launcher's, never the pointer's, which is Haptic's blue on every site (`src/shared/colour.ts`). `matchLauncher` reads it once when a site is first asked for after it is added, and again if its address changes, after the answer has gone (the request's `waitUntil`, passed down from `worker/index.ts` through `handle` as `later`). It claims the read in the database first, so two requests start one read, and never saves over a colour a person chose in Settings (`launcherChosen`). A launcher colour too light to see on a white page is darkened to 3 to 1 against white when it is saved and when it is drawn. The dashboard shows the icon beside a site's name, trying `/favicon.ico` first and asking only when that fails.
- `worker/docs.ts` reads a help doc from its address, keeping the article and leaving out navigation, headers, footers and scripts, as `npm run tag -- --docs` does. Each site's Settings tab in the dashboard sets the widget's colour, corner and button label, the company's notes, and its help docs, all of which the widget server reads within a minute. Whole docs go into the prompt in the order they were added, up to 60,000 characters, and the page shows which are left out. Deleting a site there, after typing its address, deletes its guides, steps and origins with it.
- `worker/health.ts` groups questions by meaning for the dashboard's lead, what people can't find, counted by person, and for guide health, which flags a common question whose guides stopped finishing. The Worker runs `sendHealthAlerts` once a day from the schedule in `wrangler.jsonc` and emails the company's people through the `EMAIL` binding. The email comes from alerts@joinhaptic.com, but the question, the page and the control's name in it came from visitors' browsers, and anyone can send those, so each is quoted short with anything that could be a link written as [link], and the question is said to be a visitor's (`quoted` in `worker/health.ts`). The site's name in the subject is kept to one line, and is saved that way too. Cloudflare only delivers that binding's mail to addresses verified under Email Routing, so emailing customers needs Cloudflare's email sending set up for joinhaptic.com, or another sending service. Until then each alert is still kept and shown on the dashboard.
- `worker/corrections.ts` keeps what a company changes about how Haptic guides: "Point here instead" on a step, and the controls Haptic must never point at. Both live in the site's context, so the widget server picks them up within a minute.
- `worker/teach.ts` is Teach Haptic: it starts a teach session (a one-time token, kept only as its hash, in `teach_sessions`), follows it while the company's own app records the task, and saves the reviewed steps as a taught route in the site's context. The buttons and the review drawer are in `components/app/teach.tsx`. See [Teach Haptic](../docs/corrections.md#teach-haptic).

**The dashboard's pages.** Everything behind sign-in is the one static page `/dashboard/`, and the address says the rest: `?site=` for the site, `?view=` for its page (Overview, Questions, Gaps, Knowledge or Settings), `?guide=` for the guide open beside it, `?days=` for the time range. `?view=sites` is the list of sites, and Add a site there leads to the setup screens at `/dashboard/setup/`. Sign-in lands on the list, whether a company has one site or several, and the address with no site named shows it too: a site opens only when the address names it. A company with no site yet is sent to the setup screens. These rules are in `lib/dashboard.ts`. The parts are in `components/app`: `dashboard.tsx` decides what to show, `shell.tsx` is the bar across the top and the pages down the left, `site-view.tsx` loads a site and picks its page, and each page has a file of its own. `DESIGN.md` at the top of the repository sets out how it should look, under Dashboard.

**Keeping it current.** A page that shows questions (Overview, Questions and Gaps, and any page with a guide open beside it) asks `/api/app/sites/:id/live` every second and a half while its tab is in view (`components/app/live.ts`). Knowledge and Settings ask for nothing. A page that is asking fetches the heavier numbers again, the top row from `/metrics` among them, only when the answer's `stamp` has changed. So a question asked on one computer shows on a dashboard open on another within about two seconds, with each step as it happens, and the heavier numbers are left alone while nothing changes. The list of sites asks every three seconds. A guide still open with no new step for two minutes is shown as paused, not as under way, since the person has most likely left: `PAUSED` in `worker/health.ts`, decided by the database's clock. It changes the words beside a guide and nothing that is counted. A guide still becomes abandoned after thirty minutes. There is no socket to keep open: the widget server writes each question and step to the database as it happens, and the dashboard reads them from there.

**Approving a company.** Each access request email now ends with an Approve link. It opens a page that shows the request and changes nothing until a button is pressed, so a mail scanner following the link approves no one. The team approves the one address, or everyone at the company's domain (never a free mailbox domain such as gmail.com). Approving emails the person a sign-in link. Their first sign-in creates the company's organization, and later sign-ins from an approved domain join it. Anyone else who signs in is told they are not approved yet. The list is the `approvals` table, from `../db/migrations`.

Being a member of an organization is not enough to get in. Neon Auth lets any signed-in person create an organization through its own API, so only an organization that an approval points at counts (`organizationOf` in `worker/db.ts`). An address can be covered by its own approval and its domain's. Whichever order they were made in, the person joins the organization that already exists, so a company has one.

**Setting it up.** The Worker needs four secrets, and Neon Auth needs to trust the site's address:

```bash
npx wrangler secret put DATABASE_URL              # Neon's connection string for the haptic project's main branch
npx wrangler secret put NEON_AUTH_COOKIE_SECRET   # 32 or more random characters: openssl rand -base64 32
npx wrangler secret put APPROVE_SECRET            # 32 or more random characters, a different one
npx wrangler secret put RESEND_API_KEY            # sends the sign-in email, see below
```

Billing needs two more, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. See [Billing](#billing).

`NEON_AUTH_URL` and `WIDGET_URL` are plain settings in `wrangler.jsonc`. In Neon Auth for the main branch, add `https://joinhaptic.com` as a trusted domain, turn on Magic Link with a 1440 minute expiry, and turn off email and password. Until the secrets are set, the sign-in pages load but say sign-in is not set up.

**Trying it locally.** Copy the values above into `.dev.vars`, pointing at a Neon branch for testing, with `NEON_AUTH_URL` set to that branch's auth address and `WIDGET_URL=http://localhost:4000`. Add `http://localhost:8787` to that branch's trusted domains. Then:

```bash
NEXT_PUBLIC_WIDGET_URL=http://localhost:4000 npx next build
npx wrangler dev --port 8787 --local-upstream localhost:8787
```

`--local-upstream` matters: without it, the site's address looks like joinhaptic.com over plain http and every page redirects to https. Run the widget server next to it with `npm run dev` at the top of the repository and `DATABASE_URL` in its `.env`.

**The sign-in email** is Haptic's own, sent through Resend. Neon Auth hands each sign-in link to the Worker through its `send.magic_link` webhook, at `/api/neon-auth-hook` (`worker/neon-hook.ts`), and while that webhook is on, Neon sends no email of its own. The Worker checks Neon's signature against the keys Neon publishes under `NEON_AUTH_URL`, turns away anything signed more than 5 minutes ago, and sends the email in `worker/sign-in-email.ts` from sign-in@joinhaptic.com, with replies going to hello@joinhaptic.com. Neon tries 3 times within 15 seconds, sending the same event id each time, and the Worker passes it to Resend as the idempotency key, so a retry never sends a second email.

Anyone can ask for a sign-in link for any address, on the sign-in page or straight from Neon, so each email is counted before it goes: one mailbox gets at most 5 in any hour, however its address is written (case, a +tag, Gmail's dots), and the site sends at most 300 in any hour, to everyone together. That keeps one person from filling someone's inbox, or using up what Resend will send and with it everyone's sign-in. Past a limit the Worker tells Neon the event was handled, so Neon doesn't try again, sends nothing, and logs it. The person sees the usual "Check your email" and no email comes. Each email is a row in `sign_in_emails` (`../db/migrations/0017`), holding a hash of the mailbox, the event's id, so a retry counts once, and the time, deleted once a day old. If the count can't be kept, because the database can't be reached or that migration isn't applied yet, the email is sent anyway and the log says so, since a sign-in that never comes is worse.

If every try fails, the person's sign-in fails, so the order to switch it on matters:

1. In Resend, add joinhaptic.com as a sending domain, add the DNS records it lists in Cloudflare, and wait for it to say verified.
2. Make a Resend API key with sending access only, and set it on the Worker: `npx wrangler secret put RESEND_API_KEY`.
3. Deploy, so `/api/neon-auth-hook` is live.
4. In Neon, under Auth, Configuration, Webhooks for the main branch, turn webhooks on with the URL `https://joinhaptic.com/api/neon-auth-hook` and the event `send.magic_link` only.

To go back to Neon's own email, turn the webhook off. Neon's webhook URL must be public HTTPS, so this cannot be tried against `wrangler dev`. `test/neon-hook.test.ts` at the top of the repository signs requests the way Neon does instead.

## The team

The Team page, `/dashboard/?view=team` (`components/app/team.tsx`, reached from the account menu), lists everyone at the company with their role, and the people added who haven't signed in yet. `worker/team.ts` answers `/api/app/team` and enforces every rule. A company's people are Neon Auth's `neon_auth.member` rows, each an owner, an admin or a member.

- **Everyone** sees the whole team.
- **Owners and admins** add people, make someone an admin or a member again, take back an invitation, and take someone off the team. They are also the ones who can pay (see [Billing](#billing)).
- **Nobody** changes or removes the owner, who is whoever signed in first, or changes or removes themselves, so a company always keeps someone who can manage it.

Adding someone approves their address for the company, as approving an access request does, with `approvals.invited_by` naming who added them (`../db/migrations/0016`). It emails them a sign-in link, and their first sign-in puts them on the team as a member. A company adds at most 20 people a day. An address already on another company, or approved for one, is refused. Removing someone deletes their membership and their own approval, so signing in again doesn't put them back. Someone let in by an approval of their whole email domain can't be removed here, and the page says why. A company always keeps at least one approval.

## Billing

Companies pay through Stripe for the plans in `lib/site.ts`. The unit is a finished guide, as the server decides it ([docs/operations.md](../docs/operations.md#which-guides-are-finished)). Each paid plan is one monthly subscription with two prices: the flat fee, paid at the start of the month, and finished guides, counted by a Stripe meter and paid at the end of it. The guides price has graduated tiers, so the plan's included guides cost nothing and each one after them costs the overage price. A month of 1,200 finished guides on Team comes to $149 + 200 × $0.12.

- `lib/billing-plans.ts` works out from `pricing` what Stripe must hold: two prices a paid plan, found by lookup keys such as `haptic_team_monthly` and `haptic_team_guides`.
- `scripts/stripe-setup.ts` makes them in Stripe, with the meter and the customer portal's settings, and with `--webhook` the webhook endpoint. `npm run stripe:check` changes nothing and exits 1 if Stripe differs from `lib/site.ts`. The site's deploy runs it when the `STRIPE_PRICES_KEY` repository secret is set, so a new price can't go live on the page before Stripe charges it.
- `worker/billing.ts` answers `/api/app/billing` for the dashboard's Billing page (`components/app/billing.tsx`, reached from the account menu) and Stripe's webhook at `/api/stripe/webhook`.
- `../src/shared/billing.ts` sends each finished guide to Stripe as one meter event, keyed by the guide's id. The widget server sends it when the guide is kept as finished, and this Worker sweeps every hour at 17 past for any that didn't get through. `guides.billed_at` records that it went.

**Who can do what.** Everyone at a company sees the Billing page: its plan, finished guides this period against what the plan includes, and each site's count. Only an owner or admin can start a subscription, change plan or open Stripe's portal. Starting one goes through Stripe Checkout, which collects the card, the billing address and an optional tax id. Subscriptions renew at midnight UTC on the first of each month, so a bill covers the same month as each site's Usage tab, and the first month is prorated.

**Changing plan** between Team and Scale happens on the Billing page, through the API, because Stripe's portal can't change a subscription with a metered price. It takes effect at once: the flat fee is prorated onto the next invoice, guides used before the change are billed at the old plan's rate, and the new plan's included guides start from the change. The portal is for the card, billing details, invoices and cancelling, which takes effect at the end of the period.

**Going over, or a failed payment,** never switches Haptic off: that would break the company's product in front of its own customers. The Billing page says what the period comes to so far, and says plainly when a payment failed. Stripe retries the card and emails the customer by its own settings.

**The webhook** checks Stripe's signature and refuses anything older than five minutes. It doesn't apply the event's copy of a subscription. It reads the subscription from Stripe and writes the company's row in `billing` (`../db/migrations/0015`), so events that arrive late, out of order or twice leave the same row. Each event's id is kept for 30 days in `stripe_events`, and one already applied is answered and skipped. It handles a finished Checkout, a subscription made, changed, paused, resumed or cancelled, and an invoice paid or failed. A subscription made by hand in Stripe's dashboard counts only if its customer is already a company's, or it has `organization_id` metadata naming one.

**Tax.** Every product carries the tax code for business software as a service (`PRODUCT_TAX_CODE` in `lib/billing-plans.ts`). Stripe needs it to work out sales tax and VAT, whether through Stripe Tax or Managed Payments, where Stripe is the seller of record. Haptic's Stripe account has Managed Payments on by default, so Checkout shows Link's form and Stripe handles the tax. Whether to keep it is a business decision, set in Stripe's dashboard under Settings, Managed Payments, and no code changes either way.

**Test and live mode.** The ids in a company's row belong to the mode they were made in. A server with a key for the other mode treats the row as empty, and never sends that company's usage to the other mode.

**Setting it up.** In each mode, test first:

```bash
cd web
STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup -- --webhook https://joinhaptic.com --secret-file ~/haptic-webhook-secret
npx wrangler secret put STRIPE_SECRET_KEY                                         # the same key, for this Worker
npx wrangler secret put STRIPE_WEBHOOK_SECRET < ~/haptic-webhook-secret && rm ~/haptic-webhook-secret
cd .. && npx wrangler secret put STRIPE_SECRET_KEY                                # the widget server, so finished guides go at once
```

The migration `0015_billing.sql` must be applied first. Without the two secrets the Billing page shows the plans and says paying isn't switched on yet. Without the key on the widget server, finished guides still reach Stripe, within the hour, from this Worker's sweep.

To try the webhook locally, `stripe listen --forward-to localhost:8787/api/stripe/webhook` prints a signing secret for `.dev.vars`. `stripe trigger checkout.session.completed` sends a test event.

## Haptic on this site

Haptic runs on joinhaptic.com, so people can try it before they ask for access. `components/haptic-tag.tsx` is the tag our install steps give a Next.js customer, and the footer draws it, so it is on every public page and not on the dashboard or the approve page, which have no footer. Once loaded, the widget stays in the page through Next.js's moves between pages, so those two pages are always left with a full page load (`leaveFor` in `components/app/parts.tsx`): Back cannot bring it to them. Keep it that way when adding a link out of them. It loads `https://widget.joinhaptic.com/widget.js` for the site `site_joinhaptic`, whose one allowed origin is https://joinhaptic.com. Anywhere else, such as haptic-web.joinhaptic.workers.dev or `npm run preview`, the widget server turns it away and no launcher shows.

To try it against a widget server on your machine, build with `NEXT_PUBLIC_WIDGET_URL=http://localhost:4000` and `NEXT_PUBLIC_HAPTIC_SITE` set to a site of yours that allows the address you open. Set `NEXT_PUBLIC_HAPTIC_SITE` to nothing to build without it.

What the guide knows about the site beyond the page in front of it is in `haptic-notes.md`, with what it read from the live public pages. Build that and publish it before the tag first goes live, and again after changing the notes or once a change to the pages is live, from the top of the repository:

```bash
HAPTIC_PUBLIC_URL=https://widget.joinhaptic.com npm run tag -- --url https://joinhaptic.com --id site_joinhaptic --name Haptic --notes web/haptic-notes.md --visitor-steps 60
```

```bash
npm run site:publish -- site_joinhaptic
```

The second needs `DATABASE_URL` for Neon's main branch in `.env`. Until it has run, the widget server answers from the copy of `site_joinhaptic` it held before, which has no notes and no limit for each visitor. Anyone can use the guide here, so it is held to the server's budget for a site, $2 an hour and $10 a day, and one visitor gets 60 steps a day. A visitor is told apart by network address, so people sharing one, as on an office or campus network, share the 60. Past any of these, visitors read a fixed sentence instead of a step. For a busy day, such as a demo to a room, rebuild with a higher `--visitor-steps`, and `--budget-hour` and `--budget-day` if needed, and publish again. `npm run site:off -- site_joinhaptic` takes the launcher off the site without a deploy.

## Deploying

The site runs on Cloudflare as one Worker: the static pages from `out/`, plus the form handler. The settings are in `wrangler.jsonc`.

**From GitHub.** Merging a change to the site into `main` publishes it. The workflow in `.github/workflows/deploy-site.yml` installs, lints, builds and deploys, then checks that joinhaptic.com answers. A change to the docs alone does not deploy. It can also be started by hand, from the Actions tab, under Deploy site. Pull requests never deploy.

The workflow reads two repository secrets, set under Settings, Secrets and variables, Actions:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token made from the "Edit Cloudflare Workers" template.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account the Worker lives in.

**By hand.** The same thing from a terminal:

```bash
npm run preview   # builds, then serves the site and the Worker at http://localhost:8787
npm run deploy    # builds, then publishes to Cloudflare
```

`npm run deploy` uploads the pages in `out/` separately from the Worker, which is the standard way. There is a second way, `npm run deploy:embedded`, which packs the pages inside the Worker. Use it from machines where the separate upload fails with a 401, such as a Claude cloud session whose network layer rewrites the Authorization header. It works while the site stays under 3 MB compressed. The site that is live now was published this way.

Deploying needs a Cloudflare API token in `CLOUDFLARE_API_TOKEN`. Every deploy goes straight to the live site at joinhaptic.com, because the domain is attached in the `routes` setting. The Worker sends www and plain http to https://joinhaptic.com. The same deploy is also reachable at haptic-web.joinhaptic.workers.dev, which is marked so search engines skip it.

Every answer the Worker gives, the pages and `/api/` alike, carries the same security headers (`SECURITY_HEADERS` in `worker/handler.ts`), in either way of deploying: HTTPS only for a year, subdomains included; no guessing at a file's type; only the origin as the referrer other sites see; no camera, microphone or location; and no framing, by `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`, so a signed-in page can't be shown inside another site to be clicked on unseen. Nothing frames joinhaptic.com. An answer that sets one of these headers itself keeps its own. A Content-Security-Policy that also limits scripts is still to do: it needs a hash for each inline script Next writes into the pages, and has to let in `https://widget.joinhaptic.com` for Haptic on this site.

To read the requests that have come in:

```bash
npx wrangler kv key list --binding ACCESS_REQUESTS --remote
```
