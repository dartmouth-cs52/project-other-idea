# Self-serve company onboarding for snippet/SDK-installed B2B SaaS: best flows, step by step (state as of 12 November 2026)

Research notes. Read-only research: no signups, no forms submitted. All pages were fetched on 12 Nov 2026 unless a page date is given.

Verification legend used on every bullet:
- **[P]** = primary source (vendor docs, vendor blog, vendor repo) fetched and read directly.
- **[P-s]** = primary source, but only seen through a search-result summary; the page itself was not fetched (or the fetch failed). Treat wording as approximate.
- **[T]** = third-party teardown, review or tutorial. Not vendor-confirmed.
- **[U]** = user-supplied screenshots from the brief (Crisp/Hugo steps 1-8). Not independently verified.

Limits that affect the whole document: (1) signup screens (SSO buttons, field lists, email-verification timing, work-email gating) are almost never documented publicly, so most of those cells are gaps; (2) the shared web-search budget ran out before I could search Page Flows, Mobbin, growth.design, UserOnboard, Hacker News or Reddit, so the third-party teardown coverage is thin; (3) onboarding flows change often, and several vendors are running live experiments on exactly these screens.

---

## 1. For each product: what are the exact steps from landing page to "it is working on my site", and what is asked at signup?

### Takeaway
The publicly documentable flows fall into three shapes: (a) AI-agent products that go URL → crawl → playground → deploy snippet (Crisp/Hugo, Chatbase, SiteGPT, Intercom Fin), (b) analytics/dev tools that go signup → project → install → first event (PostHog, Sentry, Amplitude, Clarity, Plausible, Segment), and (c) a 2025-2026 "accountless" shape where the install happens from a CLI or coding agent before any signup and the account is claimed later (Clerk, Stripe, PostHog `--signup`). Signup field lists and SSO options could not be verified from public sources for almost any vendor.

### Cited Findings

#### Crisp / Hugo (reference flow)
- [U] The brief's screenshots show: 3-step signup (Google or name/email/password; company name + domain + goal chips; AI-first "Hugo" vs human-first "Crisp"), then a 3-step Hugo wizard (auto-train on domain; add Files / Q&A; configure name, logo, description, answer guidance with live widget preview), then a dashboard landing on the "Agent playground" with "Setup required" badges on Activation and Instructions and a 10-item "Get Started" checklist at 9%. None of this wizard sequence is described in Crisp's docs; it is only in the screenshots.
- [P] Crisp's docs define Hugo as "a next-generation AI support agent solution, fully integrated with Crisp", reached from "⚡️ AI Agent" in the left menu; article updated 26/10/2026 — [Crisp help: Getting started with Hugo](https://help.crisp.chat/en/article/getting-started-with-hugo-ai-agent-w6gbux/)
- [P] Documented setup order is: Step 1 Configuration (Agent → Settings: avatar, name, business description, data sources, escalation rules, auto-resolve delay, office hours); Step 2 Training (Train: Q&A snippets, import website content, CSV/PDF/TXT files, automatic training from the Crisp knowledge base); Step 3 Guidance (Guidance → Instructions; Guidance → Routing); Testing (Evaluate → Playground); Deployment (Agent → Activation) — [Crisp help: Getting started with Hugo](https://help.crisp.chat/en/article/getting-started-with-hugo-ai-agent-w6gbux/)
- [P] The Hugo navigation map is: Evaluate (Playground, Analytics); Agent (Activate, Settings, Billing); Guidance (Instructions, Routing); Train (Questions & Answers, Web pages, Files); Automate (Topic Detection, Workflows Builder, Integrations & MCP). This matches the screenshot's "Activation" and "Instructions" sub-navigation — [Crisp help: Navigating the Hugo interface](https://help.crisp.chat/en/article/navigating-the-hugo-interface-and-features-h1eatv/)
- [P] "Activation" is a conversation-routing switch, not a script install. It contains: the toggle "Enable Hugo AI Agent on incoming conversations" (when off, new conversations go through workflows starting on a "New User Message" event block); a default-handling choice and inbox choice ("Automated Inbox" or "Main Inbox"); "Enable AI Agent on channels"; "Allow Hugo AI Agent to reply again after resolution"; and Office Hours (timezone, daily hours, holidays) — [Crisp help: Navigating the Hugo interface](https://help.crisp.chat/en/article/navigating-the-hugo-interface-and-features-h1eatv/)
- [P] The getting-started article phrases deployment as: tick "Enable agent for new conversation", set the default target to "Answer with AI Agent", optionally limit to specific channels; once activated, new conversations route to Hugo in the "Automated" inbox and escalate to the main inbox — [Crisp help: Getting started with Hugo](https://help.crisp.chat/en/article/getting-started-with-hugo-ai-agent-w6gbux/)
- [P] The Playground's settings are "scoped to this sandbox" and "will not affect your production configuration" — [Crisp help: Navigating the Hugo interface](https://help.crisp.chat/en/article/navigating-the-hugo-interface-and-features-h1eatv/)
- [P] The widget snippet is installed separately: the chatbox script and Website ID live at Settings → Workspace Settings → Setup & Integrations → "Chatbox setup instructions"; preferred placement is inside `<head>`, fallback before `</body>`; listed platforms include WordPress, Squarespace, Webflow, Wix, Shopify, WooCommerce, Magento, PrestaShop, Shopware, React, Next.js, Nuxt.js, SPAs and Astro; verification is manual (open the site, confirm the chatbox appears, "Send a test message from the chatbox", confirm it appears in the Crisp Inbox). The article does not mention GTM, a send-to-developer option or a domain lock; updated 01/11/2026 — [Crisp help: How to add a live chat to my website](https://help.crisp.chat/en/article/how-to-add-a-live-chat-to-my-website-10wcj3l/)
- [P-s] Hugo launched on Product Hunt on 3 February 2026 (489 upvotes, #2 Product of the Day), tagline "The AI Agent that doesn't charge 1$ per support ticket" — [Product Hunt: Hugo launches](https://www.producthunt.com/products/hugo-ai/launches)
- [P] Crisp's "AI Core Update" post (dated "2/1/2026"; ambiguous between 1 Feb and 2 Jan 2026) says "Hugo is the new AI experience that'll serve your teams and your customers, today and in the future at Crisp and as a standalone product", that "You can simulate real customer conversations with Hugo", and that pricing is credit-based with a free monthly allowance per plan: Mini $5 (~90 automated conversations), Essentials $25 (~450), Plus $75 (~1350), then pay-as-you-go — [Crisp blog: AI Core Update](https://crisp.chat/en/blog/crisp-ai-core-update/)
- [P] Crisp's engineering post (dated "3/9/2026") says Hugo is treated as "a separate product" while staying "deeply integrated with Crisp", and the general Crisp offer is "14 days free trial — All Crisp features — No card required" — [Crisp blog: Inside Hugo](https://crisp.chat/en/blog/how-we-rebuilt-part-of-crisp-to-build-hugo-our-ai-support-agent/)

#### Intercom (Fin + Messenger)
- [P] Intercom's "Getting started" article lists six steps: "Step 1: Connect with your customers" (Messenger install), "Step 2: Add and configure your team", "Step 3: Build your knowledge base", "Step 4: Meet your AI Agent", "Step 5: Connect your apps" (optional), "Step 6: Send outbound messages to your customers" (optional); "You'll need an Intercom trial or subscription for the Messenger to function"; page dated 22 Sep 2026 — [Intercom help: Getting started with Intercom](https://www.intercom.com/help/en/articles/9639255-getting-started-with-intercom)
- [P] A "new Messenger install experience, rolling out gradually" has three steps: (1) choose install type — "Visitors & leads" (quickest; no user details) or "Signed-in users, visitors & leads" (requires frontend and backend changes); (2) install and test the Messenger; (3) connect customer data and secure the Messenger (skipped for visitors-only). Entry point: Settings > Channels > Messenger Live Chat > Overview > Website card > "Install on website". Page dated 9 Oct 2026 — [Intercom help: New Messenger install experience on your website](https://www.intercom.com/help/en/articles/16946116-new-messenger-install-experience-on-your-website)
- [P] The classic flow is at Settings > Channels > Messenger > Install > "Install for web": turn on "Enable connection to messenger", pick a method, paste "before the `</body>` tag on every page", pass the logged-in user's email or user_id and signed-up date, open the app to confirm, call shutdown on logout; page dated 9 Oct 2026 — [Intercom help: Install Intercom for users on web](https://www.intercom.com/help/en/articles/168-install-intercom-for-users-on-web)
- [P] Fin can be previewed at "Fin AI Agent → Deploy → Chat" and Intercom's course recommends "run an internal test before you set it live for customers" by limiting the live Messenger with an audience rule where "email contains `@yourcompany.com`" — [Fin Academy: Installing and customizing the Fin Messenger](https://academy.fin.ai/installing-and-customizing-the-fin-messenger)

#### Chatbase
- [P] Documented flow: sign in → "New AI Agent" → enter the site under "Your website (recommended)" (at least one source is required before "Continue") → crawl → see "all discovered pages and the total character count" → optional personality step ("What will your agent do?" or a template; "Continue" skips) → optional tools and deployment-channel step ("Continue" skips) → training ("Training usually takes a few minutes, depending on the amount of data"; sources show "Syncing", "Synced" or "Failed") → Build > Instructions → Playground (always uses the draft) → "Publish" → Channels → "Setup" on the "Chat Bubble" card → "Manage" → "Deploy" → Website widget → paste script → visit the site and click the bubble — [Chatbase docs: Your first agent](https://www.chatbase.co/docs/user-guides/quick-start/your-first-agent)

#### Tidio (Lyro)
- [P] The install code is at Settings > Live Chat > Installation under "Manual install"; on Shopify the alternative is the app plus an "App embeds" theme toggle that must be re-enabled on every theme change — [Tidio help: Install Tidio on Shopify](https://help.tidio.com/hc/en-us/articles/5379640857884)
- [T] One 2026 review states that in Tidio "reading your website and running a widget on your website are two separate things", and only the second needs the script; another guide says a persistent dashboard banner shows until the widget is installed and that the widget is required to enable Flows and Lyro — [marcandrews.com Tidio review](https://marcandrews.com/tidio-review-2026-ai-live-chat-for-uk-small-businesses/); [aiproductivity.ai Lyro setup guide](https://aiproductivity.ai/guides/tidio-lyro-ai-setup-guide/). Both seen only as search summaries; the review page returned empty on fetch.

#### Zendesk
- [P] Prerequisites are "a Zendesk Support account or a trial account" (a sponsored test account "doesn't expire after 14 days like the trial account"), help center enabled, and an AI agent configured and published. Install path: Admin Center > Channels > Messaging and social > Messaging > Web Widget > Installation tab > Copy; paste just before `</body>`; a checkbox auto-embeds the widget in the Help Center. Snippet form: `<script id="ze-snippet" src="https://static.zdassets.com/ekr/snippet.js?key=…">` — [Zendesk developer docs: Messaging Web Widget quickstart](https://developer.zendesk.com/documentation/zendesk-web-widget-sdks/sdks/web/messaging-web-widget-qs/)

#### Ada, Decagon, Sierra (sales-led only)
- [P] Decagon's homepage offers only "Get a demo" / "Contact Sales" and "Sign in"; no signup, no pricing — [decagon.ai](https://decagon.ai)
- [P] Sierra's homepage offers "Learn more" and "Sign in"; no signup, no demo-booking label, no pricing figures (it says "Pay for a job well done") — [sierra.ai](https://sierra.ai)
- [P] Ada's homepage primary CTA is "Speak to an expert" (links to /demo/) plus "Sign in"; no self-serve signup or public pricing — [ada.cx](https://www.ada.cx)

#### kapa.ai, Inkeep, SiteGPT, DocsBot, Mendable
- [P] kapa.ai widget flow: app.kapa.ai → Integrations (under Deploy) → "Add new integration" → "Website Widget" → "Enable your domains and set them live" → "Copy integration ID" → script tag in `<head>` with `data-website-id` (only the ID is strictly required; name, hex colour and logo are optional attributes) → refresh the site, widget button appears bottom right, ask a question — [kapa.ai docs: Website widget quickstart](https://docs.kapa.ai/integrations/website-widget/quickstart)
- [P-s] kapa.ai's widget FAQ says that to get a website ID you reach out to the kapa team by Slack or email, which suggests account setup is sales-assisted — [kapa.ai docs: widget FAQ](https://docs.kapa.ai/integrations/website-widget/faq)
- [P] SiteGPT flow: passwordless login at sitegpt.ai/login (email → 6-digit code and sign-in link); an active plan (free trial available) is needed to train; "Create New Chatbot" → name → "Website Links" > "Scrape Website" with fields Website URL, Recursion Depth (docs example: 2) and Max Pages to Scrape (docs example: 50) → "Add Links" → Links List with Trained / Pending / Failed counters → Dashboard "Chat with your chatbot" → "Installation" > "JavaScript Embed" → paste "inside the `<head>` section of every page" → open the site and look for the chat button — [SiteGPT docs: Quickstart](https://sitegpt.ai/docs/get-started/quickstart.md)
- [P] Inkeep's web source is configured with a root URL, Ingestion URLs, Crawler Sitemap URLs, Crawler Start URLs and URL/Title include and exclude patterns — [Inkeep docs: General web source](https://docs.inkeep.com/cloud/sources/management/general-web)
- [T] DocsBot offers a "Widget embed" page with a JavaScript embed or an iframe option — [Elegant Themes tutorial](https://www.elegantthemes.com/blog/business/how-to-create-an-ai-chatbot)

#### PostHog
- [P] Install docs lead with the AI wizard: "Install PostHog in minutes with our wizard by running this command in your project directory: `npx @posthog/wizard`", followed by the JS snippet (`posthog.init('<ph_project_token>', …)` with `api_host: 'https://us.i.posthog.com'`), SDK libraries and framework guides (including Google Tag Manager, Webflow, WordPress, Shopify, Segment) — [PostHog docs: Install](https://posthog.com/docs/getting-started/install.md)
- [P] The wizard: authenticates the account, installs SDKs, scans the codebase, creates custom events from real product flows, writes `.env`, instruments client and server, generates insights and dashboards, and optionally installs the PostHog MCP server; a cloud variant can "install PostHog in your GitHub repository" by opening a pull request — [PostHog docs: AI wizard](https://posthog.com/docs/ai-engineering/ai-wizard.md)
- [P] In-app onboarding code (master branch): steps are assembled per selected product from a provider registry, de-duplicated, with "all install steps to the front, with the primary product's install first among them", then shared trailing steps (billing/plans only when applicable); a `skipOnboarding` action exists that simply redirects; this file contains no logic that blocks on event ingestion — [PostHog repo: onboardingLogic.tsx](https://raw.githubusercontent.com/PostHog/posthog/master/frontend/src/scenes/onboarding/onboardingLogic.tsx)
- [P] In-app install instructions are React components shared between app and website; "Step badges include `required`, `optional`, or `recommended`" — [PostHog handbook: Onboarding docs](https://posthog.com/handbook/wizard-and-docs/onboarding-docs.md)

#### Sentry
- [P] Next.js docs open with "Set up with Sentry CLI" (`npx sentry@latest`, also cURL, PowerShell, Homebrew) and the wizard `npx @sentry/wizard@latest -i nextjs`, which asks whether to enable Tracing and Session Replay, route browser requests through your server, and create an example page; it writes `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`, error-boundary files, wraps the Next config and stores the auth token in `.env.sentry-build-plugin` — [Sentry docs: Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [P] Sentry's in-product onboarding footer shows "Waiting for error" until `project.firstEvent` is set, then "Error Received" and a "Take me to my error" link; before an event arrives it offers "View Sample Error" (creates a sample event) and a "Next Platform" / set-up-later action — [Sentry repo: firstEventFooter.tsx](https://raw.githubusercontent.com/getsentry/sentry/master/static/app/views/onboarding/components/firstEventFooter.tsx)

#### Amplitude, Mixpanel, Segment, Heap, FullStory, LogRocket
- [P] Amplitude's quickstart offers: a browser script snippet ("Paste one tag into your site's page head. No build step."), npm packages (`@amplitude/unified`, `@amplitude/analytics-browser`), and "Set up Amplitude with an AI coding assistant" ("Copy the setup prompt into your assistant. It installs the SDK, initializes it, and helps you confirm that events arrive."); each guide "ends with events arriving in your project, usually in under 10 minutes" — [Amplitude docs: Quickstart](https://amplitude.com/docs/get-started/amplitude-quickstart)
- [P] Amplitude "Agentic Setup": open the project's Setup page → select the coding-agent option → copy the generated prompt → paste into the agent in the repo → review app root, project, region and candidate events → select one meaningful event → agent implements → run the app and trigger the event → agent runs an ingestion check → review and commit. The coding-agent option "appears only when your account is in the Agentic Setup treatment of a 50/50 experiment" — [Amplitude docs: Setup wizard CLI / Agentic Setup](https://amplitude.com/docs/en/get-started/setup-wizard-cli)
- [P] Mixpanel "Install with AI": Step 1 copy the Project Token (Settings → Overview → Access Keys); Step 2 paste a prompt into a coding agent; modes are Quick Start (first two events: sign-up plus a "Value Moment"), Full Implementation, Add Tracking, Audit; prerequisites include Admin/Owner access and a dev or staging environment — [Mixpanel docs: Install with AI](https://docs.mixpanel.com/docs/quickstart/install-with-ai.md)
- [P] Segment: create a source (name it with `demo`, `test` or `quickstart`) → copy the JavaScript snippet from the source overview → "paste it into the `<head>` tag of your site" → Identify → Track → check the Debugger — [Segment docs: A simple Segment installation](https://www.twilio.com/docs/segment/getting-started/02-simple-install)
- [P-s] Heap: paste the snippet before the closing head tag and remove existing Heap scripts first; a snippet copied while logged out contains the placeholder `heap.load("YOUR_APP_ID")` — [Heap developers: Install Heap.js](https://developers.heap.io/docs/install-heapjs)
- [P-s] LogRocket: get an app ID from the dashboard, install via npm or script tag, call `LogRocket.init()` client-side — [LogRocket docs: Quickstart](https://docs.logrocket.com/docs/quickstart)

#### Microsoft Clarity, Plausible, Hotjar/Contentsquare
- [P] Clarity: "Sign up" → "Choose a sign-up method" → Projects page → "New project" → enter Name and Website → redirected to "Getting Started" with install methods (third-party platform, manual, NPM) and a scrollable "Clarity tour" checklist; a public live demo project is linked from the docs — [Microsoft Learn: Clarity getting started](https://learn.microsoft.com/en-us/clarity/setup-and-installation/getting-started); [Microsoft Learn: Clarity setup](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup)
- [P] Plausible: after the snippet is added, "A banner at the top shows the progress and result of the installation check" — [Plausible docs: Troubleshoot integration](https://plausible.io/docs/troubleshoot-integration)
- [P-s] Hotjar: the Sites page shows a tracking-code status (for example "Not installed"); from the install page you choose manual code and click "Verify Installation" — [Hotjar help: How to check that Hotjar is working](https://help.hotjar.com/hc/en-us/articles/36819989669905-How-to-Check-That-Hotjar-Is-Working) (direct fetch returned 403)

#### Clerk, Stripe, Supabase, Resend, Vercel, Linear
- [P] Clerk's Next.js quickstart is written as agent instructions: "`npx -y clerk@latest init` needs no Clerk account"; "Signed out, it provisions a claimable application, writes dev keys to `.env.local`"; "Signing in later claims it"; "Do not ask the user to copy keys"; verify by starting the app and confirming sign-in, sign-up and signed-in controls; "If a "Configure your application" callout appears, tell them to click it" — [Clerk docs: Next.js quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart.md)
- [P] Stripe CLI: "If your CLI isn't logged into Stripe, this command provisions a new sandbox with working test API keys, without requiring an account. This enables you, a coding agent, or an automated workflow to start building a Stripe integration immediately." "Sandbox environments expire after 7 days. Claim your sandbox before it expires by running `stripe sandbox claim`" — [Stripe docs: CLI sandbox](https://docs.stripe.com/cli/sandbox)
- [P] Supabase Next.js quickstart: create project → create an `instruments` table with sample rows (violin, viola, cello) → `npx create-next-app@latest my-app -e with-supabase` → optional `npx skills add supabase/agent-skills` → env vars from the project "Connect" dialog → run and "you should see the list of instruments" — [Supabase docs: Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [P] Resend publishes an agent-directed setup page that opens "You are helping a user set up Resend, the email API." with six steps (ask what they want; get access via MCP server, CLI login or API key; set up the domain; build; test; report) — [Resend: setup.md](https://resend.com/setup.md)
- [T] Resend's dashboard opens on a "Start your first email" screen with instructions for adding an API key — [Supademo: Resend flow](https://supademo.com/user-flow-examples/resend)
- [P-s] Vercel: sign up with email or a Git provider (GitHub, GitLab, Bitbucket) — [Vercel docs: Teams and accounts](https://vercel.com/docs/teams-and-accounts)
- [T] Linear (as a general benchmark): described as "a one-minute flow: seven quick screens, no tour" ending with "a blinking cursor in your first issue" (about the 2025 flow; article dated 2 Nov 2026) — [Candu: Linear onboarding teardown](https://www.candu.ai/blog/linear-onboarding-teardown)
- [T] Linear sequence per another teardown: Google OAuth → workspace creation with domain auto-join → theme (light/dark) → Cmd+K command-menu introduction → optional GitHub integration → optional teammate invite → "Get familiar with Linear" checklist (create an issue, use the command menu, set a priority) — [Supademo: Linear flow](https://supademo.com/user-flow-examples/linear)

### Inferences
- Counting documented screens between account creation and a first "it works" moment that does not require the customer's codebase: Chatbase needs roughly four (new agent, URL, two skippable steps) before the Playground; SiteGPT about three; Crisp/Hugo (per screenshots) six. For install-first tools the count is short on paper (project, install, verify) but includes a step outside the product (editing and deploying the customer's site).
- Intercom's "new install experience" restructures install around a question the customer can answer without reading code ("visitors only, or signed-in users too?"). For a product that lives only inside a logged-in app, that question collapses to the signed-in branch, so the identity/JWT step is part of the minimum path, not an optional third step.
- Three AI-agent leaders (Decagon, Sierra, Ada) have no self-serve flow to study at all; the self-serve references in this category are Crisp, Intercom, Chatbase, Tidio, SiteGPT and (partly) Zendesk.

### Gaps
- Signup form details (SSO providers offered, field lists, email-verification timing, work-email gating, card requirement) could not be verified from public sources for Intercom, Chatbase, Tidio, Zendesk, PostHog, Sentry, Amplitude, Mixpanel, Clerk, Stripe, Supabase, Resend, Vercel or Linear. The only verified login detail is SiteGPT's passwordless email code and Crisp's "No card required" trial line.
- Tidio's and Zendesk's signup wizard screens could not be verified; the one detailed third-party Tidio walkthrough ("Setting Up Tidio in 2026: Every Screen Before the Widget Goes Live", marcandrews.com) returned an empty page.
- Mendable: no sources found in this pass. DocsBot: no primary docs fetched.
- Vercel and Linear are covered only by thin or third-party sources; third-party Linear teardowns disagree on step order.
- Third-party PostHog teardowns were unreachable (Indie Hackers post returned 403; the command.ai "unboxing PostHog" post now redirects to an Amplitude page).

---

## 2. Ordering: is the install requested before or after the user sees value, and who lets you skip it?

### Takeaway
Website-trained AI agents put value first (a working agent in a playground) and defer the snippet to a deploy step or checklist; analytics and monitoring tools are install-first but increasingly soften the wait with sample events, demo projects and skip actions. The newest pattern inverts the order entirely: install first from a CLI or agent with no account, claim the account afterwards.

### Cited Findings
- [U] Crisp never asks for the script inside the wizard; the trained agent is shown in a playground first and "Install Crisp on your website" is a checklist item (brief screenshots).
- [P] Crisp's docs recommend the same order: configure → train → "Test before activation" in the Playground → choose activation settings — [Crisp help: Getting started with AI at Crisp](https://help.crisp.chat/en/article/getting-started-with-ai-for-customer-service-at-crisp-j6xa76/)
- [P] Chatbase puts the embed last: Step 1 create and train, Step 2 test in the Playground, Step 3 deploy to your website — [Chatbase docs: Your first agent](https://www.chatbase.co/docs/user-guides/quick-start/your-first-agent)
- [P] SiteGPT puts "Chat with your chatbot" (step 5) before the embed snippet (step 6) — [SiteGPT docs: Quickstart](https://sitegpt.ai/docs/get-started/quickstart.md)
- [P] Intercom's getting-started list puts Messenger install first ("Step 1: Connect with your customers") and the AI agent fourth, and says of the Messenger that you "need to get this added before you can preview and start interacting with Fin in the Messenger"; a separate preview exists at Fin AI Agent → Deploy → Chat — [Intercom help: Getting started](https://www.intercom.com/help/en/articles/9639255-getting-started-with-intercom); [Fin Academy](https://academy.fin.ai/installing-and-customizing-the-fin-messenger)
- [T] Tidio is reported to require the installed widget before Flows and Lyro can be enabled, with a persistent banner until then — [aiproductivity.ai Lyro setup guide](https://aiproductivity.ai/guides/tidio-lyro-ai-setup-guide/); [marcandrews.com: Setting up Tidio in 2026](https://marcandrews.com/?p=3709) (search summaries only; which of these third-party guides makes the banner claim is not confirmed)
- [P] Sentry is install-first but offers an escape: "View Sample Error" creates a sample event and "Next Platform" defers setup while the footer shows "Waiting for error" — [Sentry repo: firstEventFooter.tsx](https://raw.githubusercontent.com/getsentry/sentry/master/static/app/views/onboarding/components/firstEventFooter.tsx)
- [P] PostHog moves install steps to the front of onboarding but has a `skipOnboarding` action and no ingestion gate in the step logic — [PostHog repo: onboardingLogic.tsx](https://raw.githubusercontent.com/PostHog/posthog/master/frontend/src/scenes/onboarding/onboardingLogic.tsx)
- [P] Clarity is install-first ("To start using Clarity for your project, you must finish the Setup process") but links a public live demo project and shows a self-guided "Clarity tour" checklist "which helps to explore our features while you finish the setup" — [Microsoft Learn: Clarity getting started](https://learn.microsoft.com/en-us/clarity/setup-and-installation/getting-started)
- [P] Clerk and Stripe let the install precede the account: Clerk "provisions a claimable application" when signed out; Stripe "provisions a new sandbox with working test API keys, without requiring an account", claimable within seven days — [Clerk docs: quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart.md); [Stripe docs: CLI sandbox](https://docs.stripe.com/cli/sandbox)
- [P] PostHog's wizard has a `--signup` flag: "Create a new PostHog account during setup" — [PostHog wizard README](https://github.com/PostHog/wizard)
- [P] Clerk's stated reason: "Agents stall on account creation." and "Our onboarding was built for a person who lands on the signup page and creates an application in the Dashboard." — [Clerk blog: Accountless setup for Clerk in Next.js](https://clerk.com/blog/accountless-setup-clerk-init-nextjs.md)
- [T] Resend's default landing leads with API-key setup "before any product value is visible", which the teardown criticises — [Supademo: Resend flow](https://supademo.com/user-flow-examples/resend)

### Inferences
- The value-first ordering works for website-trained agents because the vendor can produce a convincing artefact from a public URL alone. A product that only acts inside the customer's logged-in app cannot crawl that app from outside, so it has no free artefact; the nearest equivalents in the evidence are (a) a sandbox or sample that needs no install (Sentry's "View Sample Error", Clarity's demo project, Crisp's playground) and (b) install-before-account flows that make the install itself the first step (Clerk, Stripe).
- Vendors that kept install first have all added a way out of the blocking screen (sample event, skip, demo project, tour checklist). No fetched source shows a hard block with no alternative.

### Gaps
- Whether PostHog's install step shows a blocking "waiting for events" state today is unverified; an older third-party teardown mentions a "Listening to events" step but the page is no longer reachable.
- Whether Fin can be fully trained and previewed before the Messenger is installed in a brand-new workspace is not stated clearly in Intercom's docs.
- Amplitude, Mixpanel, Heap, FullStory, LogRocket: no public description of whether the dashboard can be explored (demo data) before install.

---

## 3. "Train on your website": who crawls during onboarding, what is shown, how long, and what are the limits?

### Takeaway
Every self-serve AI-agent product crawls a public URL as its first substantive step and shows per-page status lists rather than rich progress; stated times range from "a few minutes" to "over an hour". All of them fail on login-walled pages and are weak on JavaScript-heavy sites, which is the central constraint for any product whose subject matter is a logged-in app.

### Cited Findings
- [U] Crisp/Hugo wizard: "Automatically train Hugo" with the domain prefilled and a browser-frame preview, then "Manually train Hugo" with a "1 Resource" counter (brief screenshots).
- [P] Crisp docs: you specify a URL, start the import and can add a filter to ignore pages; Hugo ingests content while you keep configuring. No crawl limits, timing or page counts are stated — [Crisp help: Getting started with Hugo](https://help.crisp.chat/en/article/getting-started-with-hugo-ai-agent-w6gbux/)
- [P] Chatbase: after crawling you see "all discovered pages and the total character count"; "Training usually takes a few minutes, depending on the amount of data"; per-source status is "Syncing" / "Synced" / "Failed" with a reason; limits are storage-based and "vary by plan"; for Shopify the docs say to add `/sitemap.xml` instead of crawling the whole store — [Chatbase docs: Your first agent](https://www.chatbase.co/docs/user-guides/quick-start/your-first-agent)
- [P] Chatbase FAQ: "Paste any URL and we'll crawl all linked pages"; training data is measured in MB against the plan's storage limit — [Chatbase docs: FAQ](https://chatbase.co/docs/faq/faq.md)
- [P] Intercom Fin website sync: enter the top-level domain → validity check → choose sections → optional advanced settings (extra URLs, exclusions, CSS selectors, proxy region, crawler type) → audiences → "Sync website". Page statuses are Syncing, Live, Failed, Excluded. "An initial sync can take anywhere from a few minutes to over an hour based on how much content you have." "Once the sync is complete, you'll receive an email notification." — [Intercom help: Sync and manage websites](https://www.intercom.com/help/en/articles/9357945-sync-and-manage-websites)
- [P] Intercom limits: "Pages per source: Fin syncs a maximum of 4,000 pages from each source"; "you can sync up to 100 different top-level domains"; re-syncs "usually happen weekly", JavaScript-heavy or large sources move to every 14 days, and scheduled syncs pause after 90 days if no page was used in a Fin answer — [Intercom help: Sync and manage websites](https://www.intercom.com/help/en/articles/9357945-sync-and-manage-websites)
- [P] Intercom restrictions: "If the content you want to use is behind a login, Fin won't be able to access or import it."; "Pages syncing empty or truncated usually means JavaScript rendering" (fix: switch crawler type to Full); a sync history lists date, status, synced / excluded / failed counts, duration and who started it — [Intercom help: Sync and manage websites](https://www.intercom.com/help/en/articles/9357945-sync-and-manage-websites)
- [P] SiteGPT exposes the caps as form fields (Recursion Depth, Max Pages to Scrape) and shows Trained / Pending / Failed counters that update on their own; "Failed pages don't block you" — [SiteGPT docs: Quickstart](https://sitegpt.ai/docs/get-started/quickstart.md)
- [P] Zendesk: "If a website requires authentication, the web crawler can't access it."; "Websites can have any format, including dynamic elements and JavaScript."; settings include Start URL, Max pages to crawl and Max crawling depth; "a weekly or monthly cadence is fine"; the article applies to accounts created before 10 March 2026 — [Zendesk help: Web crawler best practices](https://support.zendesk.com/hc/en-us/articles/9961827483162-Best-practices-for-using-a-web-crawler-to-import-content-for-AI-agents-AI-agents-Advanced-only)
- [P-s] Zendesk's default "Max pages to crawl" is 4,000 — [Zendesk help: crawler troubleshooting](https://support.zendesk.com/hc/en-us/articles/9961828111258)
- [P] Inkeep: "Websites with complex javascript or dynamic content may not be fully indexed." — [Inkeep docs: General web source](https://docs.inkeep.com/cloud/sources/management/general-web)

### Inferences
- The crawl step doubles as a qualification and personalisation step: the domain is usually prefilled or already known, and the product returns something specific to the customer within minutes. The cheapest visible feedback that vendors ship is a list of discovered pages with a count and a per-item status.
- Because every crawler in the evidence stops at a login wall, a logged-in-app product cannot copy this step literally. What transfers is the shape: ask for one thing the customer already knows (a URL), do work on it immediately, and show a countable result.

### Gaps
- Crisp/Hugo crawl limits, duration and JS-rendering behaviour: not stated in any fetched Crisp page.
- Chatbase page or link caps per plan, JS rendering and login handling: not in the fetched docs.
- Tidio Lyro crawl behaviour and limits: no primary source fetched.
- No vendor in the set documents crawling authenticated pages with customer-supplied credentials.

---

## 4. Install mechanics: script variants, framework tabs, packages, CLI/AI wizards, MCP servers, "copy this prompt", and developer handoff

### Takeaway
By late 2026 the leading developer-facing vendors offer three parallel install paths (paste a script tag; run a CLI wizard that edits the codebase; paste a one-line prompt or skill URL into a coding agent), and several also ship MCP servers and agent plugins. Non-developer handoff is handled by "invite a teammate" (Intercom), "share code by email" (Clarity) or a generated spec file (Mixpanel).

### Cited Findings

#### Script tag and framework variants
- [P] Intercom methods: Code snippet, React, Angular, Vue, Ember (many with an NPM install), plus WordPress, Google Tag Manager, Shopify and Segment; a Rails gem is also mentioned; SPAs need an adjusted approach — [Intercom help: Install for users on web](https://www.intercom.com/help/en/articles/168-install-intercom-for-users-on-web); [Intercom help: New install experience](https://www.intercom.com/help/en/articles/16946116-new-messenger-install-experience-on-your-website)
- [P] kapa.ai's whole install is one tag: `<script async src="https://widget.kapa.ai/kapa-widget.bundle.js" data-website-id="…" data-project-name="…" data-project-color="…" data-project-logo="…"></script>` — [kapa.ai docs: quickstart](https://docs.kapa.ai/integrations/website-widget/quickstart)
- [P] Chatbase placement advice: "Place in `<head>` for faster loading, or before `</body>` if you have loading performance concerns"; an iframe embed is the alternative — [Chatbase docs: Chat bubble](https://www.chatbase.co/docs/developer-guides/website-integration/chat-bubble)
- [P] Clarity offers three install routes (third-party platform list with an "I don't see my platform" request form, manual `<head>` paste, NPM `@microsoft/clarity`) — [Microsoft Learn: Clarity setup](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup)
- [P] Plausible: WordPress plugin with "a one-click proxy built in", an official GTM template, and an NPM package that "doesn't read your site settings" and whose `init` "has to run in the browser, not during server-side rendering" — [Plausible docs: Troubleshoot integration](https://plausible.io/docs/troubleshoot-integration)
- [P-s] Crisp's SPA guidance is to load the script once at app start instead of reinjecting on each route change — [Crisp help: Embed Crisp in a single-page app](https://help.crisp.chat/en/article/how-can-i-embed-crisp-inside-a-single-page-app-1ptfyyx/)

#### Google Tag Manager as an install channel
- [P] Clarity detects GTM automatically and can publish the tag itself: "Finish setup" → select a GTM account and container → "Create and publish" — [Microsoft Learn: Clarity setup](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup)
- [P] GTM is a listed install method for Intercom, PostHog and Plausible — [Intercom help](https://www.intercom.com/help/en/articles/168-install-intercom-for-users-on-web); [PostHog docs: Install](https://posthog.com/docs/getting-started/install.md); [Plausible docs](https://plausible.io/docs/troubleshoot-integration)

#### CLI and AI wizards that edit the customer's codebase
- [P] PostHog: `npx -y @posthog/wizard@latest`; options include `--signup`, `--install-dir`, `--api-key`, `--ci` (README: "not currently supported in published builds"), `--no-telemetry`; subcommands `mcp add` / `mcp remove` / `mcp tutorial`, `audit`, `self-driving`, `provision`; "over 16+ frameworks"; "Source files are sent to the selected model provider as part of the agent's context" while "`.env*` files and secrets stay on your machine" — [PostHog wizard README](https://github.com/PostHog/wizard)
- [P] PostHog (May 2025): "Now anyone using an AI agent can copy and paste one prompt and get a working integration in about 90 seconds"; the prompt is the command `npx -y @posthog/wizard@latest` pasted into an agent chat — [PostHog blog: We built an AI envoy](https://posthog.com/blog/envoy-wizard-llm-agent)
- [P] Sentry: `npx @sentry/wizard@latest -i nextjs` (interactive feature prompts, writes config files, creates a test page) — [Sentry docs: Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [P] Amplitude wizard: "sets up analytics in your app — from zero to first chart — with one command"; "Auto-detects your framework, instruments the SDK, and verifies events are flowing" — [Amplitude wizard repo](https://github.com/amplitude/wizard)
- [P] Clerk: `npx -y clerk@latest init` (adds `<ClerkProvider>`, sets up `clerkMiddleware()`, writes keys), `clerk doctor` reports failing checks with a `remedy` field readable by agents via `--json` — [Clerk blog: Accountless setup](https://clerk.com/blog/accountless-setup-clerk-init-nextjs.md)
- [P] Stripe: `stripe sandbox create --from-git` infers email and name from git config; `--non-interactive` is "Useful for scripting and agent-assisted workflows" — [Stripe docs: CLI sandbox](https://docs.stripe.com/cli/sandbox)

#### "Copy this prompt into your coding agent", skills and MCP servers (exact wording)
- [P] Clerk's AI page: "Have your agent use Clerk's CLI and Skills to get started", with the one-line agent prompt `Add Clerk auth to my app: clerk.com/SKILL.md` and `npx skills add clerk/skills` — [Clerk docs: AI prompts](https://clerk.com/docs/nextjs/guides/ai/prompts.md)
- [P] Mixpanel's prompt begins "Set up Mixpanel tracking in this project." then "Use the Mixpanel setup skill:" followed by a raw GitHub URL to `plugins/mixpanel/skills/tracking-implementation/SKILL.md` in `mixpanel/ai-plugins`; works with "Any agent that can fetch a URL and follow instructions" (Claude Code, Cursor, ChatGPT, GitHub Copilot Chat, Windsurf named); "Your code never leaves your environment." — [Mixpanel docs: Install with AI](https://docs.mixpanel.com/docs/quickstart/install-with-ai.md)
- [P] Amplitude's agent flow uses `amp skills get integrating-amplitude --region us` and requires only a public key: "Agentic Setup uses your public, ingestion-scoped project API key." "Never give the agent a Secret Key for this workflow." — [Amplitude docs: Agentic Setup](https://amplitude.com/docs/en/get-started/setup-wizard-cli)
- [P] Resend's agent page: "Aim to do the whole setup from this one prompt."; access via the MCP server at `https://mcp.resend.com/mcp`, `npx resend-cli@latest login`, or an API key; "Never ask for a key in chat; if one is pasted, do not use it and tell the user to revoke it immediately."; install lines include `claude plugin install resend@claude-plugins-official`, `codex mcp add resend --url https://mcp.resend.com/mcp`, `npx skills add resend/resend-skills` — [Resend: setup.md](https://resend.com/setup.md)
- [P] Intercom ships a Claude Code plugin (source `github.com/intercom/claude-plugin-external`, labelled "Anthropic verified", 2,952 installs at fetch) whose command `/intercom:install-messenger react` "generates production-ready backend and frontend code to add the Intercom chat widget to your app with secure JWT-based identity verification"; frameworks listed: React, Next.js, Vue, Angular, Node.js, Python, PHP, Ruby — [Claude plugins: Intercom](https://claude.com/plugins/intercom)
- [P] Sentry's skills repo: skills are built into per-agent plugins (`getsentry/plugin-claude`, `plugin-cursor`, `plugin-codex`); "The plugin configures the Sentry MCP server automatically on install."; skills "are also served over HTTP at skills.sentry.dev for agents to fetch directly"; example requests are "Add Sentry to my Next.js app" and "Set up Sentry in my Rails project"; older per-SDK "wizard" skills are frozen as legacy — [getsentry/sentry-for-ai](https://github.com/getsentry/sentry-for-ai)
- [P] Supabase: `npx skills add supabase/agent-skills` "so your AI coding agent can produce more accurate, reliable code using current Supabase patterns"; steps can alternatively be done by asking "the MCP server" — [Supabase docs: Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [P-s] Mixpanel's hosted MCP server is enabled by default for free and growth accounts created after 1 August 2026 — [Mixpanel docs: MCP](https://docs.mixpanel.com/docs/mcp)
- [P] Resend via Stripe Projects: "One command gives your project a Resend account and an API key, ready to send": `stripe projects add resend/email` — [Resend docs: Stripe Projects integration](https://resend.com/docs/guides/stripe-projects-integration.md)

#### Handoff to a developer or teammate
- [P] Intercom: section "Ask a developer to help (optional)" with an "Invite teammate" button that emails an invite; the invitee gets permissions to manage general and security settings, Messenger settings and workspace data (a lite seat on Advanced/Expert, a full seat on Essential) — [Intercom help: Install for users on web](https://www.intercom.com/help/en/articles/168-install-intercom-for-users-on-web)
- [P] Clarity: "Share code" → enter a team member's email → "An email with the tracking code and setup instructions is sent to your teammate." — [Microsoft Learn: Clarity setup](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup)
- [P] Mixpanel: tell the skill you are scoping work for a developer and it writes `MIXPANEL_IMPLEMENTATION_SPEC.md` (code, business context, verification steps, troubleshooting) instead of code — [Mixpanel docs: Install with AI](https://docs.mixpanel.com/docs/quickstart/install-with-ai.md)

### Inferences
- The agent-prompt path has converged on one of two forms: a single npx command, or one sentence plus a URL to a hosted SKILL.md. Both keep the prompt short enough to show as a copy button on an install screen and move all detail into a file the vendor can update without changing the UI.
- Several vendors now write quickstart pages as instructions to an agent, not a human (Clerk's quickstart .md, Resend's setup.md). The human-facing install screen is becoming a launcher for those pages.
- Agent-based installs depend on publishable-only credentials (Amplitude says so explicitly), which fits a script-tag product well because its only credential is already public.
- For a one-script-tag product, the wizard's main job would be finding the right layout file per framework and adding identity for the logged-in user, which is what Intercom's plugin command does.

### Gaps
- No fetched Intercom or Crisp help page mentions an AI-prompt or MCP install option inside the product's install screen; Intercom's agent path exists only as an external plugin.
- Sentry: I could not confirm a "copy prompt" control on the in-product onboarding screen or the exact prompt text on docs pages. A `--skills` flag for `@sentry/wizard` was seen only in an open pull request ([mirror of getsentry/sentry-wizard#1187](https://gh.r-mj.com/getsentry/sentry-wizard/pull/1187)) and may not have shipped.
- Amplitude's generated agent prompt text is not public; the `npx @amplitude/wizard` blog post (reported as September 2026) could not be fetched in full.
- Hotjar/Contentsquare, Heap, FullStory, LogRocket, Tidio, Chatbase: no evidence found of wizard, prompt or MCP install paths; absence is not confirmed.
- Supabase's dashboard "Connect" dialog layout (framework tabs, MCP tab) could not be verified.

---

## 5. Install verification: how is a live snippet detected, and what happens on failure?

### Takeaway
There are four verification mechanisms in use: a vendor-side check that loads the customer's URL (Plausible, Hotjar/Contentsquare, Intercom's "Test your installation"), a passive wait for the first event or widget ping (Sentry, Tidio, Clarity, Segment), an agent-run ingestion check from the CLI (Amplitude, Mixpanel), and plain manual instructions (Crisp, Chatbase, kapa.ai, SiteGPT). Plausible's is the most complete because it generates its own test traffic and offers four recovery options on failure.

### Cited Findings
- [P] Plausible: "Plausible first checks whether it can reach your site and detect the installation" and then "confirms if visits are being counted correctly"; "Our testing tool launches automatically in the background to send test traffic to your site" and "This test traffic won't be recorded in your dashboard"; on failure "the banner explains the problem and lets you check again, try another URL, review the installation instructions or verify the installation manually"; the script disables itself on localhost; consent tools that delay the script defeat the automatic check — [Plausible docs: Troubleshoot integration](https://plausible.io/docs/troubleshoot-integration)
- [P] Intercom (new flow): "Test your installation" → on pass a "Messenger is installed" confirmation; for visitors-only it adds that visitors can now start conversations which appear in the Inbox; install status later appears under "Installation locations" — [Intercom help: New install experience](https://www.intercom.com/help/en/articles/16946116-new-messenger-install-experience-on-your-website); [Intercom help: mobile install experience](https://www.intercom.com/help/en/articles/16947979-new-messenger-install-experience-in-your-mobile-app)
- [P] Intercom (classic flow): "Check installation" shows a success notification if the Messenger is found or indicates what went wrong; suggested causes are ad blockers, private browsing and public-suffix domains — [Intercom help: Install for users on web](https://www.intercom.com/help/en/articles/168-install-intercom-for-users-on-web)
- [P] Tidio: the Installation screen shows "checking widget activation" until Tidio detects the widget, then "The widget is installed properly" with a "See on your website" button; until then the panel shows "Chat Widget is not visible to your customers" — [Tidio help: Install Tidio on Shopify](https://help.tidio.com/hc/en-us/articles/5379640857884)
- [P] Sentry: "Waiting for error" → "Error Received" → "Take me to my error"; the wizard's `/sentry-example-page` has a "Throw Sample Error" button, and errors thrown from the browser console do not count because they are sandboxed — [Sentry repo: firstEventFooter.tsx](https://raw.githubusercontent.com/getsentry/sentry/master/static/app/views/onboarding/components/firstEventFooter.tsx); [Sentry docs: Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [P] Clarity: "You can instantly start viewing data in the project as soon as you add the code"; the project shows the number of current live users with a "Watch now" button; manual fallback is checking POST requests to `https://www.clarity.ms/collect` in the Network tab — [Microsoft Learn: Clarity setup](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup)
- [P-s] Hotjar: status label on the Sites page plus a "Verify Installation" action — [Hotjar help](https://help.hotjar.com/hc/en-us/articles/36819989669905-How-to-Check-That-Hotjar-Is-Working). Contentsquare: Get Started → "Verify installation" → enter the site URL → "Verify installation"; a Chrome extension (Tracking Setup Assistant) helps diagnose — [Contentsquare help: Squarespace install](https://support.contentsquare.com/hc/en-us/articles/37271885733521-Squarespace-How-to-install-the-Contentsquare-tag)
- [P] Amplitude: the agent runs `amp events check-ingestion-by-api-key --api-key … --region us --timeout-seconds 60`; the check "reports only whether the project received any recent event" and, if nothing is found, the fallback is "the live event feed on the Setup page" — [Amplitude docs: Agentic Setup](https://amplitude.com/docs/en/get-started/setup-wizard-cli)
- [P] Mixpanel: deploy to a test environment, use the app, open the Events page and confirm `sign_up_completed` and the Value Moment event appear; the skill also checks Live View before finishing — [Mixpanel docs: Install with AI](https://docs.mixpanel.com/docs/quickstart/install-with-ai.md)
- [P] Segment: "The Debugger shows a live stream of sampled events arriving at the Source", "with a cap of 500 events" — [Segment docs: simple install](https://www.twilio.com/docs/segment/getting-started/02-simple-install)
- [P] Clerk: `npx clerk@latest doctor` reports failing checks and remedies; the visible success signal is a completed signup and a profile icon — [Clerk blog: Accountless setup](https://clerk.com/blog/accountless-setup-clerk-init-nextjs.md); [Clerk docs: quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart.md)
- [P] Manual-only verification: Crisp (send a test message, see it in the Inbox) — [Crisp help](https://help.crisp.chat/en/article/how-to-add-a-live-chat-to-my-website-10wcj3l/); Chatbase (visit the site, click the bubble; troubleshooting list: agent ID, script placement, console errors, allowed domain) — [Chatbase docs: Chat bubble](https://www.chatbase.co/docs/developer-guides/website-integration/chat-bubble); kapa.ai (refresh, ask a question, whitelist domains in CSP if it does not load) — [kapa.ai docs](https://docs.kapa.ai/integrations/website-widget/quickstart); SiteGPT (open the site in a new window) — [SiteGPT docs](https://sitegpt.ai/docs/get-started/quickstart.md)
- [P-s] Heap: "check your live data feed"; console `heap.appid` — [Heap help](https://help.heap.io/hc/en-us/articles/37271988967953-How-can-I-check-if-Heap-is-installed-correctly-on-my-website). FullStory: search the browser console for "fullstory"; capture starts immediately once the snippet runs — [Fullstory help](https://help.fullstory.com/hc/en-us/articles/360032975813-How-do-I-know-that-Fullstory-is-deployed-successfully)

### Inferences
- Fetch-the-URL verification (Plausible, Hotjar, Contentsquare) only works when the snippet is on a public page. For a snippet that loads behind a login, the vendor cannot load the page, so the realistic options are a passive first-ping listener with a visible waiting state (Tidio, Sentry), a "test" button the installer clicks while logged in to their own app (Intercom), or an agent/CLI check against an ingestion endpoint (Amplitude).
- The strongest failure handling pairs a specific reason with next actions on the same surface (Plausible's four options; Intercom says what went wrong). The AI-agent products mostly leave failure to a troubleshooting list.
- Localhost is treated three different ways: disabled by default (Plausible), enabled by default for testing (kapa.ai), and the expected first target (Sentry's example page, Clerk's dev keys). A product installed by developers in a logged-in app will be verified on localhost or staging first, so the verification state needs to say which environment pinged.

### Gaps
- What Intercom's test actually does (server-side fetch, or waiting for a ping from the installer's browser) is not documented.
- PostHog's in-app verification screen wording and behaviour are unverified.
- Polling intervals and timeouts for the passive listeners (Tidio, Sentry, Clarity) are not documented.
- Hotjar's verification details come from search summaries only (403 on fetch).

---

## 6. Domain/origin controls: allowlists, publishable keys, CSP, SRI, staging vs production

### Takeaway
Client-side products rely on a public identifier in the snippet and then add one of three protections: a domain allowlist (kapa.ai, Chatbase), server-signed user identity (Intercom JWT), or nothing beyond the public key (analytics). Environment separation is done with separate sources or projects, temporary dev keys, or a staging domain on the same allowlist. No source mentioned subresource integrity.

### Cited Findings
- [P] kapa.ai makes the allowlist a prerequisite to getting the ID: "Enable your domains and set them live" (production plus staging; a regex such as `^https://\w+\.example\.com$` for dynamic subdomains); "For local testing, `http://localhost` is enabled by default."; "Only requests from enabled domains can submit questions through the widget", which the docs say "powers the bot protection" — [kapa.ai docs: quickstart](https://docs.kapa.ai/integrations/website-widget/quickstart)
- [P] Chatbase's allowlist is optional and a known cause of failure: restricting embedding but leaving out your site means "Browsers refuse to show the AI agent on your website"; the setting is "Only allow embedding the agent on specific domains" — [Chatbase docs: Your first agent](https://www.chatbase.co/docs/user-guides/quick-start/your-first-agent)
- [P] Intercom secures logged-in installs with identity, not origin: generate a signed JWT on your server with your secret key (HS256, one-hour expiry), keep the key off the browser, add an `intercom_user_jwt` line to the snippet; "Always pass `user_id`, `email`, and `user_hash` dynamically from your server"; no allowed-domain setting is mentioned in the install articles — [Intercom help: New install experience](https://www.intercom.com/help/en/articles/16946116-new-messenger-install-experience-on-your-website); [Intercom help: Install for users on web](https://www.intercom.com/help/en/articles/168-install-intercom-for-users-on-web)
- [P] Intercom has a workspace-level kill switch on the install page: "Enable connection to messenger"; without it all requests fail — [Intercom help: Install for users on web](https://www.intercom.com/help/en/articles/168-install-intercom-for-users-on-web)
- [P] Segment: "create and use separate sources for each of your environments" so that "testing and development activities" don't "fill production systems with invalid data"; the write key identifies the source and regenerates when library settings change — [Segment docs: simple install](https://www.twilio.com/docs/segment/getting-started/02-simple-install)
- [P] Clerk separates environments by key type: accountless apps get development keys; "Unclaimed applications and development keys are not production-ready"; production keys come from `clerk deploy` and `clerk env pull --instance prod`; "Never expose `CLERK_SECRET_KEY` in client code" — [Clerk blog: Accountless setup](https://clerk.com/blog/accountless-setup-clerk-init-nextjs.md); [Clerk docs: quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart.md)
- [P] Stripe's accountless sandbox returns a `publishable_key` (`pk_test_…`) and a secret key, expiring in 7 days unless claimed — [Stripe docs: CLI sandbox](https://docs.stripe.com/cli/sandbox)
- [P] Supabase's client env var is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, taken from the project Connect dialog — [Supabase docs: Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [P] Amplitude restricts agent setup to "your public, ingestion-scoped project API key" — [Amplitude docs: Agentic Setup](https://amplitude.com/docs/en/get-started/setup-wizard-cli)
- [P] CSP guidance is consistently "add our domain": Plausible ("add `plausible.io` to the allowed domains list") — [Plausible docs](https://plausible.io/docs/troubleshoot-integration); kapa.ai (whitelist the required domains) — [kapa.ai docs](https://docs.kapa.ai/integrations/website-widget/quickstart)
- [P] PostHog recommends a reverse proxy "so that events are less likely to be intercepted by tracking blockers" (managed proxy free on PostHog Cloud) and publishes IP ranges for firewall/WAF allowlists — [PostHog docs: Install](https://posthog.com/docs/getting-started/install.md)
- [P] Zendesk's widget snippet carries an account-specific key in the script URL (`snippet.js?key=…`) — [Zendesk developer docs](https://developer.zendesk.com/documentation/zendesk-web-widget-sdks/sdks/web/messaging-web-widget-qs/)

### Inferences
- kapa.ai's ordering (enable domains, then reveal the ID) turns the allowlist into an onboarding step that also captures staging and production hosts up front; Chatbase's optional allowlist shows the cost of doing it later (a silent failure mode).
- For a snippet that runs inside an authenticated app and acts on behalf of a known user, Intercom's model (public app ID + server-signed user token) is the closest precedent; an origin allowlist alone does not establish who the end user is.

### Gaps
- Subresource integrity: no vendor page fetched mentions SRI for its snippet.
- Crisp domain restrictions for the chatbox: not mentioned in the install article.
- PostHog "authorized URLs", Hotjar, Clarity, Tidio and SiteGPT domain controls: not covered in the fetched pages.
- Stripe key guidance beyond the sandbox page (restricted keys, dashboard onboarding) was seen only in search summaries of [Stripe docs: API keys](https://docs.stripe.com/keys).

---

## 7. Post-wizard activation: checklists, empty states, playgrounds, sample data, onboarding emails

### Takeaway
The common post-wizard devices are a sandbox/playground with a draft-versus-live distinction, a short task checklist, a sample artefact that fills the empty state, and status badges on unfinished setup areas. Checklist wording and item counts are rarely documented publicly.

### Cited Findings
- [U] Crisp lands on an "Agent playground" with the message "Hugo is disabled — this is a safe playground to test without impacting real conversations", "Setup required" badges on Activation and Instructions, and a pinned "Get Started" checklist at 9% with ten items (create workspace, install Crisp on your website, set up Hugo, create knowledge base, connect messaging channels, connect mailbox, invite teammates, customise widget, create first shortcut, import contacts) (brief screenshots).
- [P] Chatbase separates draft from live: "The Playground always uses the draft"; customers see changes only after "Publish"; new data sources go live when synced, without publishing — [Chatbase docs: Your first agent](https://www.chatbase.co/docs/user-guides/quick-start/your-first-agent)
- [P] Chatbase's suggested playground test: ask the most common customer questions "plus at least one your content doesn't cover", expecting the agent to admit the gap — [Chatbase docs: Your first agent](https://www.chatbase.co/docs/user-guides/quick-start/your-first-agent)
- [P] Intercom's pre-launch checks: Fin answers common questions accurately; "The escalation path works"; name, avatar and colours appear as expected; the AI Agent label shows — [Fin Academy](https://academy.fin.ai/installing-and-customizing-the-fin-messenger)
- [P] Intercom (2019) built "Onboarding Home", "the single place for all new customers to start setting up Intercom", on a modular framework of levels, each with an objective, a success metric and steps — [Intercom blog: Designing modular user onboarding](https://www.intercom.com/blog/designing-modular-user-onboarding/)
- [P] Sentry fills the empty state with a sample: "View Sample Error" — [Sentry repo: firstEventFooter.tsx](https://raw.githubusercontent.com/getsentry/sentry/master/static/app/views/onboarding/components/firstEventFooter.tsx)
- [P] Clarity shows "a checklist of self guided tour" on Getting Started, reachable later at Settings → Clarity tour — [Microsoft Learn: Clarity getting started](https://learn.microsoft.com/en-us/clarity/setup-and-installation/getting-started)
- [P] PostHog's wizard ends in the product, not the terminal: it "Generates insights and dashboards in the PostHog app"; the README says it "instruments a starter set of events" and walks the user through a first dashboard — [PostHog docs: AI wizard](https://posthog.com/docs/ai-engineering/ai-wizard.md); [PostHog wizard README](https://github.com/PostHog/wizard)
- [P-s] PostHog's onboarding emails began on Mailchimp in 2022 and have grown into a tree of roughly 100 emails; an in-app activation definition used was "events ingested, 1 insight created, 1 dashboard created" — [PostHog blog: How we built our onboarding email flow](https://posthog.com/blog/how-we-built-email-onboarding); [PostHog blog: Lifecycle marketers roasted our lifecycle marketing](https://posthog.com/blog/lifecycle-marketing). Search summaries only; which of the two posts carries the "roughly 100" figure is not confirmed.
- [P] Supabase's quickstart has the user create sample rows so the first run renders real data — [Supabase docs: Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [T] Linear's "Get familiar with Linear" checklist (create an issue, use the command menu, set a priority) surfaces features in context instead of a tour — [Supademo: Linear flow](https://supademo.com/user-flow-examples/linear)
- [P] Sentry (2019) found its older onboarding widget, "a list of TODOs rather than a guided tour of the product", had low engagement, and replaced it with a contextual "Assistant" — [Sentry blog: Building a modern Clippy](https://blog.sentry.io/growing-adoption-building-modern-clippy)

### Inferences
- Crisp's ten-item checklist mixes one critical item (install) with nine generic helpdesk tasks, and the low starting percentage (9%) reflects that. Linear's three-item list and Sentry's finding about TODO lists point the other way: fewer items tied to the first real outcome.
- "Disabled but testable" (Crisp playground, Chatbase draft, Intercom audience-rule internal test) is the shared answer to the fear of shipping an AI feature to real users. For an in-app guide, the equivalent is restricting the live snippet to the customer's own team first, which Intercom documents with an email-domain audience rule.

### Gaps
- Checklist wording, item counts and progress display for Intercom, Chatbase, Tidio, PostHog, Amplitude, Mixpanel and Zendesk are not publicly documented in the pages fetched.
- Onboarding email sequences for the AI-agent vendors were not researched.
- Vercel and Resend post-signup empty states: no primary source.

---

## 8. Personalisation questions at signup: who asks, how many, and what changes downstream

### Takeaway
Publicly verifiable evidence here is thin. The clearest cases are Crisp (goal chips plus an AI-first versus human-first fork that selects which wizard runs), Intercom (an install-type question that removes a step) and Sentry (a platform question that later became the basis of per-platform install instructions and analytics). Most other vendors' signup questions could not be verified without signing up.

### Cited Findings
- [U] Crisp asks one goal question as chips ("Centralize my emails / Chat with my website visitors / Integrate messaging channels / Build a chatbot / Build an AI Agent / I'm just curious") and one fork ("Hugo, AI-first" versus "Crisp, Human-first") with the reassurance "You can switch or combine both later. Nothing is locked in." (brief screenshots).
- [P] Intercom's install-type choice changes the path: choosing "Visitors & leads" skips the third step (connect customer data and secure the Messenger) — [Intercom help: New install experience](https://www.intercom.com/help/en/articles/16946116-new-messenger-install-experience-on-your-website)
- [P] Sentry began asking new users for their platform during sign-up in 2017 ("Are you coding in JavaScript? Ruby? Or perhaps the always popular Other?") and wrote that "asking this one small question has led to big insights about the ease of using different platforms" — [Sentry blog: Small data, big insights](https://blog.sentry.io/small-data-big-insights)
- [P] PostHog's onboarding steps are generated from the products the user selects (primary product first, then secondary products, with shared SDK install steps de-duplicated) — [PostHog repo: onboardingLogic.tsx](https://raw.githubusercontent.com/PostHog/posthog/master/frontend/src/scenes/onboarding/onboardingLogic.tsx)
- [P] Chatbase asks "What will your agent do?" (free text or template) and a tools/channels question, both skippable with "Continue" — [Chatbase docs: Your first agent](https://www.chatbase.co/docs/user-guides/quick-start/your-first-agent)
- [P] Clarity asks only for project Name and Website at creation; "website industry" is a later setting — [Microsoft Learn: Clarity getting started](https://learn.microsoft.com/en-us/clarity/setup-and-installation/getting-started)
- [P] Resend's agent setup starts with questions before any action ("Reply first. Your first message is the step 1 questions."): app email, marketing or inbox, plus domain, sender and access — [Resend: setup.md](https://resend.com/setup.md)
- [P] Mixpanel's and Amplitude's agent flows ask the user to pick the first event to track (Mixpanel: sign-up plus a "Value Moment"; Amplitude: "Select one meaningful event") — [Mixpanel docs](https://docs.mixpanel.com/docs/quickstart/install-with-ai.md); [Amplitude docs](https://amplitude.com/docs/en/get-started/setup-wizard-cli)
- [T] Linear asks theme (light/dark) immediately after workspace creation, before the workspace has content — [Supademo: Linear flow](https://supademo.com/user-flow-examples/linear)

### Inferences
- The questions that visibly earn their place are those that branch the flow (Crisp's fork, Intercom's install type, PostHog's product selection, Sentry's platform). Segmentation-only questions (role, company size) do not appear in any primary source fetched, which says more about what vendors document than about what they ask.
- Wizards and agent flows are moving the stack question out of the signup form: the CLI detects the framework from the codebase (PostHog, Amplitude, Clerk), so the remaining human question is "what is the first thing you want to see work?".

### Gaps
- Role, company-size and tech-stack questions at signup for Intercom, Tidio, Zendesk, PostHog, Amplitude, Mixpanel, Hotjar, Heap, FullStory, LogRocket and Vercel: unverified. These need a hands-on walkthrough or a teardown library (Page Flows, Mobbin), which I could not search before the search budget ran out.
- What Crisp's goal chips change downstream (other than the Hugo/Crisp fork) is unknown.

---

## 9. What have vendors published about their own onboarding redesigns and activation experiments (with numbers)?

### Takeaway
PostHog's 2026 wizard results are the strongest published numbers for an AI-assisted install; Sentry's older experiments quantify small UI changes on the install screen; Clerk and Stripe explain the accountless shift qualitatively; Amplitude is A/B testing its agent install option 50/50 right now.

### Cited Findings
- [P] PostHog (24 Jun 2026, Edwin Lim): 14.2% of wizard users convert to paid versus 2.6%; time to first event 1.9 hours versus 3.8 hours; 94% versus 67% activation within one hour; MRR 80% larger in the first paying month; the wizard does about two hours of work in 8 minutes; framework support went from 5 to 25+ in a few days. The comparison group is not explicitly named in what I retrieved, and nothing I retrieved mentions random assignment — [PostHog newsletter: Context engineering](https://posthog.com/newsletter/context-engineering)
- [P] PostHog (same post): the wizard originated when a growth-team member watched session recordings of users trying to onboard; the core lesson is "reasoning usually isn't the bottleneck. Context supply is." — [PostHog newsletter: Context engineering](https://posthog.com/newsletter/context-engineering)
- [P] PostHog (6 May 2025): one pasted prompt yields a working integration "in about 90 seconds"; "We know how many runs are successful, and how many are cancelled" — [PostHog blog: We built an AI envoy](https://posthog.com/blog/envoy-wizard-llm-agent)
- [P] Sentry (2 Nov 2017): roughly 70% of Python and PHP users sent a first event within two days of sign-up; PHP averaged about 90 minutes to first event; Python, JavaScript and Ruby within two hours; "The biggest step in getting Sentry up and running is integrating it with your platform" — [Sentry blog: Small data, big insights](https://blog.sentry.io/small-data-big-insights)
- [P] Sentry (8 Apr 2019): a contextual in-product "Assistant" "increased our first-event rate by almost 6%" — [Sentry blog: Building a modern Clippy](https://blog.sentry.io/growing-adoption-building-modern-clippy)
- [P] Sentry (9 May 2019): on the installation-instructions page, a prominent "See Sample Event" button at the top (25% of users) beat control by 12% on activation ("what percentage of sign ups successfully send an error to Sentry"); a subtler link at the bottom showed 1.03x — [Sentry blog: Easy A/B testing with PlanOut](https://blog.sentry.io/easy-ab-testing-with-planout)
- [P] Amplitude: the coding-agent install option "appears only when your account is in the Agentic Setup treatment of a 50/50 experiment" — [Amplitude docs: Agentic Setup](https://amplitude.com/docs/en/get-started/setup-wizard-cli)
- [P] Clerk: from `@clerk/nextjs` 7.8.0, an app without keys throws an error telling the developer or agent to run `npx clerk@latest init`; rationale "Agents stall on account creation." No metrics given — [Clerk blog: Accountless setup](https://clerk.com/blog/accountless-setup-clerk-init-nextjs.md)
- [P-s] Intercom: "User onboarding for the first several years of Intercom centered on one action: install a snippet of JavaScript", and the growth team chose to redesign rather than optimise it — [Intercom blog: Your onboarding has a shelf life](https://www.intercom.com/blog/your-onboarding-has-a-shelf-life/) (URL returned 404 on direct fetch; quote is from a search summary)
- [T] A Medium write-up of a Des Traynor talk credits Intercom's shift from "install the Javascript correctly" to "get their users into Intercom" with a 40% conversion increase — [Medium: Product Decision #10](https://medium.com/productinstinct/product-decision-10-intercoms-onboarding-mindset-change-that-increased-conversion-by-40-b1faf41f0c90) (403 on fetch; the figure is unverified)

### Inferences
- PostHog's wizard numbers compare wizard users with others, and users who run a CLI wizard are likely more technical and more committed than those who do not, so the gap probably overstates the causal effect. Amplitude's randomised 50/50 test is the design that would settle the question, but no result is published.
- Sentry's 12% lift from a sample-event button on the install page is the most directly transferable datum: showing what success looks like on the waiting screen raised real installs.

### Gaps
- No published numbers found for Segment, Intercom (primary), Chatbase, Tidio, Crisp or Clerk.
- Amplitude's wizard blog post (reported as September 2026) could not be fetched; its numbers, if any, are unknown.
- No Hacker News or Reddit threads on install friction were retrieved (one search returned nothing relevant; search budget then ran out).

---

## 10. Which five are most worth signing up for and walking through by hand, ranked, and what to watch at each step?

### Takeaway
Ranked for a script-tag product that runs inside a customer's logged-in app: (1) Intercom, (2) Chatbase, (3) PostHog, (4) Amplitude, (5) Plausible. Crisp/Hugo is already captured; Clerk and Tidio are the two runners-up. This ranking is my judgement from the cited findings, not a sourced fact.

### Cited Findings
- [P] Intercom is the only flow found that covers install-type choice, framework tabs, a test button, server-signed identity for logged-in users and a developer-invite handoff in one place, and the new experience was documented on 9 Oct 2026 as "rolling out gradually" — [Intercom help: New install experience](https://www.intercom.com/help/en/articles/16946116-new-messenger-install-experience-on-your-website)
- [P] Chatbase is the shortest documented value-first agent flow, with two explicitly skippable steps, a draft/publish split and an optional domain allowlist — [Chatbase docs: Your first agent](https://www.chatbase.co/docs/user-guides/quick-start/your-first-agent)
- [P] PostHog has the most mature AI install wizard, published results, and onboarding steps generated from product selection with a skip action — [PostHog newsletter](https://posthog.com/newsletter/context-engineering); [PostHog repo](https://raw.githubusercontent.com/PostHog/posthog/master/frontend/src/scenes/onboarding/onboardingLogic.tsx)
- [P] Amplitude's Setup page offers snippet, package and coding-agent paths side by side with a live event feed, and the agent option is under a 50/50 experiment — [Amplitude docs: Quickstart](https://amplitude.com/docs/get-started/amplitude-quickstart); [Amplitude docs: Agentic Setup](https://amplitude.com/docs/en/get-started/setup-wizard-cli)
- [P] Plausible has the most complete automated verification with explicit failure options — [Plausible docs](https://plausible.io/docs/troubleshoot-integration)
- [P] Clerk (runner-up) shows install-before-account with a later claim — [Clerk docs: quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart.md). Tidio (runner-up) shows a passive "checking widget activation" listener with a persistent not-installed state — [Tidio help](https://help.tidio.com/hc/en-us/articles/5379640857884)

### Inferences
What to pay attention to in each walkthrough:

1. **Intercom (Fin trial).** At signup: SSO options, whether a work email is required, when email is verified, whether a card is needed (all unverified). Then: how much of Fin can be trained and previewed before the Messenger exists; the wording of the install-type question; which framework tabs appear and whether any AI-prompt option has been added; exactly what "Test your installation" does when the snippet is only on a logged-in page or on localhost, and the failure copy; the "Invite teammate" email as received by the developer; the JWT step's code samples per backend language; whether you get the old or new install experience.
2. **Chatbase.** Signup friction; what the screen shows during the crawl (live list, counts, time); what happens on a JS-heavy or login-walled URL; the exact copy on the two skippable steps; the first Playground state and any suggested questions; how the dashboard nags about deployment after you leave the wizard; the Deploy screen's snippet and the allowed-domains setting; whether any install verification exists.
3. **PostHog.** Product-selection screen and how it changes the steps; how the install step presents the wizard versus the snippet versus framework tabs; whether there is a waiting-for-events state and what it shows; run `npx @posthog/wizard` in a scratch repo and note the OAuth hand-off, the file diff approval, the MCP offer and where it drops you in the app afterwards; what "skip" leads to; the first onboarding emails.
4. **Amplitude.** Whether your account gets the coding-agent option (50/50); the exact generated prompt text; how the Setup page's live event feed behaves before and after the first event; how the snippet path (Autocapture and Session Replay on by default) is explained to a non-developer; the ingestion check's messages on success and timeout.
5. **Plausible.** A ten-minute walkthrough for one thing: the verification banner. Note the progress states, the success copy, and each of the four failure options ("check again", "try another URL", "review the installation instructions", "verify the installation manually"); try it against a page where the snippet is absent to see the failure copy.

Runners-up: **Clerk** (run `npx clerk@latest init` signed out in a scratch Next.js app; watch the keyless banner, the "Configure your application" claim prompt and what claiming asks for), **Tidio** (the "checking widget activation" screen and the not-installed banner), **Sentry** ("Waiting for error" with "View Sample Error"), **Microsoft Clarity** ("Share code" email and the GTM "Create and publish" path).

### Gaps
- The ranking could not be cross-checked against screen recordings in Page Flows or Mobbin (search budget exhausted). Pattern-library pages exist for Sentry, PostHog and Clerk onboarding at saasui.design ([Sentry](https://www.saasui.design/pattern/onboarding/sentry), [PostHog](https://www.saasui.design/pattern/onboarding/posthog), [Clerk](https://www.saasui.design/pattern/onboarding/clerk)) but were not fetched.
- Whether Intercom and Chatbase trials can be completed without a payment card or a sales touch is unverified.
- Tidio, Zendesk, Hotjar and Mixpanel were not ranked partly because their flows could not be documented well enough from public sources; a hands-on pass might change the order.
