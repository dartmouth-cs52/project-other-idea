# Engineering options for giving an embedded AI guide knowledge of a logged-in, JS-rendered web app, making each guidance step fast, and what each option demands of the customer at onboarding (state: 12 November 2026)

Reading notes for the report writer:

- Evidence tags used in every finding: **[doc]** = primary documentation/spec/official blog; **[vendor]** = vendor marketing or a vendor describing itself; **[3p]** = third-party or secondary source (often a competitor blog); **(snippet)** = I only saw the claim in a search-result summary and did not open the page myself.
- All pages were retrieved on 2026-11-12 unless a different "as of" date is given. Page contents were read through a summarising fetch tool, so short quotes are reliable but long tables (for example the Anthropic price table) should be re-checked against the live page before publication.
- Two access limits affected this research. (1) `octomind.dev` could not be resolved from this session (it is outside the session's allowed network domains; it would have to be allowed in the session's network settings to be fetched), so Octomind facts are snippet-level only. (2) The web-search budget for the session ran out before I could source a few items (shadow DOM as a security boundary, Fullstory "private by default", LogRocket, click-to-component, assistant-ui / Vercel AI SDK, Arcade, Guidde, mabl / testRigor / Reflect onboarding). Those are listed under Gaps, not guessed.
- "Inferences" are mine and are not sourced facts.

---

## 1. Authenticated automated exploration: can a cloud browser agent log in with a test account and build a UI map, and what does the customer have to hand over?

### Takeaway
This is a mature pattern in AI QA (QA.tech, Octomind, Momentic, QA Wolf all do a version of it), and it reliably requires three things from the customer: a reachable environment URL, test credentials, and help getting past 2FA/SSO/bot protection. None of the vendor docs I read solve destructive actions or SSO automatically; they push that back to the customer ("point out anything to avoid", "exempt a test user from 2FA", "don't log in through SSO").

### Cited Findings

**What QA / AI-testing vendors ask for at onboarding**
- QA Wolf (managed service) asks the customer to "Get access to a testing environment", "Provide test environment credentials", share existing test plans, and then do a live product tour: "You'll walk our team through your app and point out critical priorities or anything to avoid." Timeline from contract start: kick-off and product tour by day 5, first test-plan review by day 15, final by day 20. Repo access is not mentioned on the page. [doc] — [QA Wolf: Full Service, the first three months](https://docs.qawolf.com/qawolf/Full-Service-The-First-Three-Months)
- QA Wolf recommends a staging (QA/test) environment "for the best balance between reliability and safety". [doc] (snippet) — [QA Wolf: Test environments](https://docs.qawolf.com/qawolf/Test-environments.md)
- QA.tech crawls the app to build a "knowledge graph" of pages and past agent interactions and keeps updating it "as PRs come in"; it is described as "like a sitemap on steroids". [vendor] (snippet) — [QA.tech blog: knowledge graphs for AI agents](https://qa.tech/blog/knowledge-graphs-for-ai-agents)
- QA.tech crawling records, per iteration, a screenshot, the source action, depth and the "found actions (links, buttons, forms)"; for logged-in areas it reuses the browser state of a successful login test (and offers to create that test first); crawls stay inside the project's allowed domains. The page gives no guidance on destructive actions or production data. [doc] — [QA.tech docs: crawling](https://docs.qa.tech/core-concepts/crawling)
- QA.tech: "If you provide login credentials, we will use those and ingest the information behind that login screen." [doc] (snippet) — [QA.tech docs: knowledge](https://docs.qa.tech/core-concepts/knowledge)
- Octomind asks for a publicly reachable URL, then its agent looks for a cookie banner and a required login and asks for test credentials; credentials work only for username/password logins (not social sign-in); OTP is supported through a stored secret and a `$OCTO_TOTP` template; bot protection on the site can block the agent and the vendor recommends allow-listing its bot. [doc] (snippet; site not reachable from this session) — [Octomind docs: first steps](https://octomind.dev/docs/first-steps)
- Momentic handles login by saving auth state (cookies, localStorage, IndexedDB) or a cached "auth module"; it advises against logging in through SSO providers because Google/Facebook/GitHub "may block Momentic's IP addresses if they detect automated login attempts"; its 2FA guide suggests a test user role exempt from 2FA. [doc] (snippet) — [Momentic docs: auth overview](https://momentic.ai/docs/guides/auth/overview); [Momentic 2FA guide](https://join.momentic.ai/resources/a-developers-guide-how-to-reliably-automate-2fa-testing-in-2024)
- Momentic launched "Mo", an agent that tests web/iOS/Android apps without scripts, on 28 September 2026. [3p] (snippet) — [SiliconANGLE](https://siliconangle.com/2026/09/28/momentic-debuts-mo-ai-agent-to-automate-software-testing-without-scripts/)
- Meticulous takes a different route: no credentials, but a recorder script that "must be the first script to load", added to local/staging/preview (production optional), plus CSP exceptions; sessions are recorded as people click around and replayed against each commit. [doc] — [Meticulous docs: recorder script](https://app.meticulous.ai/docs/how-to/recorder-script.md); [Meticulous: how it works](https://meticulous.ai/how-it-works)
- Checksum is described by directories as training on real user sessions collected with a 2–3 line JS snippet "similar to Fullstory or Hotjar". I could not verify this on checksum.ai. [3p] (snippet) — [toolmage listing](https://www.toolmage.com/en/tool/checksumai/)

**Agent/browser tooling and how it handles credentials, 2FA, bot detection**
- Browserbase's guidance: "the best practice is to log in manually once using Session Live View", then persist cookies/localStorage in a reusable Context; "Two-step verification (via authenticator apps or SMS) or magic links usually require human intervention in the loop." [doc] — [Browserbase docs: authentication](https://docs.browserbase.com/guides/authentication)
- 1Password "Secure Agentic Autofill" on Browserbase injects credentials through the 1Password extension only when required, with human approval of each request by default; it needs a 1Password Business/Enterprise admin to enable. [vendor] (snippet) — [Browserbase blog](https://browserbase.com/blog/1password-agentic-autofill); [1Password blog](https://1password.com/blog/closing-the-credential-risk-gap-for-browser-use-ai-agents)
- Browser Use (post dated 8 March 2026, updated 25 October 2026): credentials go in `sensitive_data` and "The agent never sees your actual credentials, only placeholder names"; TOTP needs "individual setup for each website"; there is no "native authentication framework for autonomous agents that's been widely adopted"; the article does not cover SSO. [vendor] — [Browser Use: how to authenticate AI web agents](https://browser-use.com/posts/web-agent-authentication)
- Skyvern stores username/password plus an optional base32 TOTP secret, can receive pushed email/SMS codes, integrates Bitwarden (1Password in private beta), and says credentials are never sent to LLMs (placeholders appear in prompts and logs). [doc] (snippet) — [Skyvern docs: credentials](https://docs.skyvern.com/credentials/introduction); [Skyvern docs: handle 2FA](https://skyvern.com/docs/developers/credentials/handle-2fa)
- Bot detection: Browserbase is in Cloudflare's "signed agents" programme (Web Bot Auth, HTTP message signatures per RFC 9421), so participating sites can explicitly allow its sessions; first cohort was ChatGPT agent, Goose, Browserbase and Anchor Browser. [doc]/[vendor] (snippet) — [Cloudflare blog: signed agents](https://blog.cloudflare.com/signed-agents/); [Browserbase blog](https://browserbase.com/blog/cloudflare-browserbase-pioneering-identity)
- Playwright MCP returns an accessibility snapshot (a text tree with element refs) from every page-interacting tool; Playwright's docs rate snapshots as low-cost text and screenshots as high-cost image tokens. [doc] (snippet) — [Playwright MCP: snapshots](https://playwright.dev/mcp/snapshots)

**Action caching / self-healing (the "memory" these tools keep)**
- Stagehand v4 server-side cache: "On a cache hit, the server returns the response directly with no LLM inference and no token cost." The cache key is built "from the instruction, page content, and the options you pass" (URL included, so dynamic URLs cause misses). A cached `act()` is replayed deterministically with self-healing off, and "If the recorded selector no longer resolves, Stagehand falls back to full inference." Requires a Browserbase browser. [doc] — [Stagehand v4 docs: caching](https://docs.stagehand.dev/v4/best-practices/caching)
- Stagehand's speed guide gives cached operations as roughly 50–100 ms (selector replay) versus 1–5 s uncached (LLM inference). This is a docs figure, not a published benchmark. [doc] (snippet, from a docs mirror) — [Stagehand speed optimisation (mirror)](https://www.mintlify.com/browserbase/stagehand/best-practices/speed-optimization)

**General computer-use agents (state of the field)**
- Google's Gemini 2.5 Computer Use model (October 2025): 65.7% on Online-Mind2Web on the Browserbase harness versus 61.0% for Claude Sonnet 4 and 44.3% for OpenAI's agent; Google's own chart puts it at 70%+ accuracy at about 225 s latency per task. Vendor-reported; confirmed only as of October 2025. [vendor]/[3p] (snippet) — [Google blog](https://blog.google/technology/google-deepmind/gemini-computer-use-model/); [VentureBeat](https://venturebeat.com/ai/googles-ai-can-now-surf-the-web-for-you-click-on-buttons-and-fill-out-forms)
- Google shut down Project Mariner on 4 May 2026 and folded the technology into Gemini Agent and AI Mode. [3p] (snippet) — [TechSpot](https://www.techspot.com/news/112334-project-mariner-dead-but-google-browser-controlling-ai.html)
- Anthropic's Claude for Chrome pilot (August 2025): 123 red-team cases across 29 attack scenarios; prompt-injection success 23.6% without mitigations and 11.2% with them; site-level permissions and confirmation before high-risk actions. Later, lower figures exist only in a secondary report I could not verify. [doc] (snippet) — [Anthropic: Claude for Chrome](https://www.anthropic.com/news/claude-for-chrome); critique: [Simon Willison](https://simonwillison.net/2025/Aug/26/piloting-claude-for-chrome/)
- OpenAI's Atlas agent mode distinguished "logged-in" mode (uses the user's existing sessions) from logged-out mode; a secondary source says Atlas was deprecated in July–August 2026 and that the ChatGPT Chrome extension now acts in signed-in tabs. Deprecation date not confirmed from a primary source. [doc]/[3p] (snippet) — [OpenAI help: agent on Atlas](https://help.openai.com/en/articles/12628199-using-ask-chatgpt-sidebar-and-chatgpt-agent-on-atlas); [beri.net](https://www.beri.net/article/chatgpt-chrome-extension-work-mode-computer-use-logged-in-tabs-enterprise-admin-controls-allowlist-no-action-log)

### Inferences
- What it yields: broad page and action inventory for the role and tenant of the test account, reached in hours to days. It does not see screens gated by other roles, plans, feature flags or data states the test tenant lacks. Element identifiers are whatever the crawler derives from the DOM, so they are no more stable than the widget's own live reading.
- Customer effort is "no engineering, but not zero": someone must create a test account (ideally on staging with seed data), disable or script 2FA, possibly allow-list the crawler's IP or bot, and tell the vendor what must not be clicked. For an SSO-only enterprise app this is often an IT ticket, not a self-serve step.
- Destructive exploration is an unsolved liability in every doc I read. A guide product that only needs to *observe* navigation can crawl far more conservatively than a QA tool (follow links and open menus, never submit forms or confirm dialogs), but it then misses post-submit screens.
- Stagehand's "replay cached selector, fall back to inference when it breaks" is the directly transferable design for a per-step cache in a guidance widget.
- Asking a prospect for credentials before any value is shown is a trust hurdle; QA vendors get away with it because the customer is buying testing of a staging environment, not adding a script to production.

### Gaps
- mabl, testRigor and Reflect onboarding specifics (credentials, link agents, IP allow-lists): my one search returned only comparison pages; not verified.
- No vendor publishes exploration coverage numbers (share of screens reached) for logged-in SaaS apps.
- No primary source found on how any exploration vendor prevents destructive actions beyond customer instructions.
- Octomind details are snippet-level because the site was unreachable from this session.

---

## 2. Exploration from inside the customer's own browser: can an extension (or similar) run the product or capture screens in the signed-in admin's session without any credentials being shared?

### Takeaway
Yes, and this is the established pre-install channel in the digital-adoption category: several vendors explicitly let an admin preview or build on their own logged-in app through a Chrome extension before the snippet is installed. The limits are that only the person with the extension sees anything, Manifest V3 forbids remotely hosted logic, and locked-down enterprises block or allow-list extensions.

### Cited Findings
- Userflow: "You can preview Flows (e.g., product tours, modals, tooltips, etc.) directly in your app before installing the Userflow JavaScript snippet (Userflow.js) or publishing changes." The extension needs permission to read and change site data on all sites or on the app's domain; without it "preview, and element selection can fail". [doc] — [Userflow: Chrome extension](https://help.userflow.com/docs/userflow-chrome-extension)
- Fullstory Guides and Surveys extension (Chrome and Edge) lets you "preview your product tours, smart tips, checklists, banners, and surveys on any website" "without modifying your site's code". Preview ignores user-segment conditions. [doc] — [Fullstory: Guides and Surveys browser extension](https://help.fullstory.com/hc/en-us/articles/37802698713367)
- Usetiful's extension "enables you to preview product tours directly on your page without embedding the code" and grabs an element selector with one click. [doc] (snippet) — [Usetiful help](https://help.usetiful.com/support/solutions/articles/77000197926-preview-tours-with-usetiful-chrome-extension)
- Product Fruits editor extension: "The extension provides full functionality with the exception of segmentation, for which the JS snippet needs to be deployed." [vendor] (snippet) — [Chrome Web Store listing](https://chrome.google.com/webstore/detail/product-fruits-editor/blfcndbglccbobmkepikmbmobcehhkkf)
- HelpHero: "This extension allows you to create and edit tours on sites that do not have the HelpHero snippet installed." [vendor] (snippet) — [Chrome Web Store listing](https://chromewebstore.google.com/detail/helphero-editor/igddcfndiapddcmgkkkjaalanbclolni)
- Userpilot treats extension and snippet as parallel onboarding steps: "While your engineering team completes the installation, you can proceed with installing the Chrome extension"; the extension is required for building ("You can't create in-app messages without this"). [doc] (snippet) — [Userpilot: get started](https://docs.userpilot.com/welcome-to-userpilot/get-started-with-userpilot)
- Pendo AI tagging (beta) is the closest shipped example of "capture the app's structure from the admin's session with AI": it "captures the DOM of your application's pages through the designer", "only reads the page structure", and "Before any DOM content is sent to the AI for analysis, Pendo sanitizes it client-side, in your browser"; it uses Gemini; "Nothing is created, updated, or deleted in your subscription until you review the suggestions"; weak selectors are flagged because they "are more likely to break when your application's code changes". [doc] — [Pendo: overview of AI tagging (beta)](https://support.pendo.io/hc/en-us/articles/52003588343963)
- Pendo AI tagging has a multi-page mode: after "Start capturing pages" it captures each page's DOM as the admin navigates, then "Stop and tag with AI" produces suggestions for all captured pages. [doc] (snippet) — [Pendo: Tag with AI (beta)](https://support.pendo.io/hc/en-us/articles/54741747298459)
- Extensions as the *end-user* delivery channel exist only in the employee-facing DAP world, where IT mass-deploys them (Whatfix via Intune/PowerShell; WalkMe via a Mass Deployment Wizard, repeated per OS and browser). [doc] (snippet) — [Whatfix: mass deployment](https://support.whatfix.com/docs/mass-deployment-of-the-browser-extension); [WalkMe: deploy using an extension](https://support.walkme.com/knowledge-base/mass-installation-project-scope/)
- Manifest V3: an extension's full functionality must be discernible from its submitted code; external resources may be loaded for data but "must not contain any logic"; remote code attracts extra review scrutiny and undeclared remote code leads to rejection. [doc] (snippet) — [Chrome: improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security); [Chrome Web Store troubleshooting](https://developer.chrome.com/docs/webstore/troubleshooting); [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- Review time: Google publishes no figure that I found; one developer reported delays "up to 2 weeks" in the Chromium extensions group (anecdote). [3p] (snippet) — [chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/NxpAGOEDI2U)
- Enterprise control: Chrome's `ExtensionSettings` policy lets admins block, allow or force-install each extension, and Google's admin guidance describes a "block all, allow some" model; the CIS Chrome benchmark recommends setting the install blocklist to `*`. [doc] (snippet) — [Google: allow or block apps and extensions](https://support.google.com/chrome/a/answer/6177431); [CIS benchmark item via Tenable](https://tenable.com/audits/items/CIS_Google_Chrome_L1_v2.1.0.audit:fbfba5392aa5f35543ca8ac9018e4944)
- WebMCP docs note that "Chrome Extensions can query and execute WebMCP tools with content scripts", so an extension can also read declared tools where a site has them. [doc] — [Chrome: WebMCP](https://developer.chrome.com/docs/ai/webmcp)
- Install-rate data: I found no B2B comparison of extension versus snippet adoption. The only numbers are community-reported consumer funnel figures (permission acceptance 65–80%, day-1 activation 30–50%). Weak evidence. [3p] (snippet) — [extensionbooster.net](https://extensionbooster.net/blog/how-to-get-more-chrome-extension-installs-discovery-funnel-playbook-2026.md)

### Inferences
- An extension that injects the same widget code a snippet would load is the only approach found that shows the product on the prospect's real logged-in app with no credentials shared, no developer and no CSP change. It is a trial and authoring channel, not a production channel for a customer-facing SaaS: the customer's end users will never install it.
- The same extension can double as a capture tool: while the admin clicks through their app it can log (element used → resulting screen) transitions and screen inventories, which seeds the site map before any real-user traffic exists. Pendo's multi-page AI tagging shows a large vendor already shipping this shape.
- Manifest V3 means the widget logic must be bundled in the extension package, so every widget update is a store review. The extension and the production snippet will drift unless built from one codebase.
- Requesting host access to "all sites" lengthens review and alarms security teams; requesting access per site on click (activeTab or optional host permissions) is the lower-friction pattern (this is my reading of the review guidance, not a quoted rule).
- A bookmarklet or a console paste is a weaker fallback: it executes in the page context and so is subject to the page's CSP, which a strict B2B app will often block. I did not source this; treat it as an engineering assumption to test.

### Gaps
- No data on what share of B2B admins are allowed to install an arbitrary Chrome Web Store extension, or on extension-trial to snippet-install conversion.
- No official Chrome Web Store review-time figure for 2026.
- Whether the Userflow/Fullstory extensions inject the production runtime or a separate preview runtime is not documented.

---

## 3. Record-by-demonstration: what is captured when a customer records their top workflows, how robust is replay, and how is AI used to generalise?

### Takeaway
Recording tools capture clicks/keystrokes plus either screenshots or a copy of the page's HTML/CSS, anchored to an element; replays are only as stable as the stored selector, and every vendor documents breakage when the app changes. The 2025–2026 direction is to treat the recording as a hint and let a model re-find the element when the selector fails.

### Cited Findings
- Tango (2022 description of its capture): "Tango captures your mouse and keyboard inputs and filters DOM (webpage) data to describe what you are doing and take relevant screenshots." [vendor] (snippet) — [Tango blog: workflow capture](https://www.tango.us/blog/workflow-capture)
- Tango says it "only processes clicks, keystrokes, and screen content during an active Capture or Guide Me session". Its Guide Me overlay requires viewers to have the Tango extension (third-party guides also say it is an Enterprise feature; Tango's help article does not state a tier). [vendor]/[3p] (snippet) — [Tango: create](https://www.tango.ai/create); [Tango help](https://help.tango.us/en/articles/7966907-what-does-tango-do)
- Supademo offers two capture types: "HTML capture copies each page's HTML and CSS, so the text, numbers, and logos stay editable after you record", while "Screenshot capture saves an image at every click". In HTML demos "Each HTML hotspot has a corresponding anchor position ... the element which your hotspot is attached next to". HTML capture works only for web apps and needs a pause on each page to capture. [doc] (snippet) — [Supademo docs: guided HTML demos](https://docs.supademo.com/create/by-demo-type/guided-html-demos); [Supademo changelog](https://supademo.com/blog/changelog/product-update-html-supademo)
- DAP builders store CSS-selector rules: Pendo's Visual Design Studio builds Feature rules from HTML and CSS and shows how many elements match. [doc] (snippet) — [Pendo: tagging with the Visual Design Studio](https://support.pendo.io/hc/en-us/articles/360032293971)
- Brittleness is documented by the vendors themselves: Pendo flags weak-selector tags as "more likely to break when your application's code changes"; Fullstory's selector guidance says to choose the most stable, shortest selector because selectors break when developers change the site. [doc] — [Pendo AI tagging](https://support.pendo.io/hc/en-us/articles/52003588343963); (snippet) [Fullstory: tips for choosing CSS selectors](https://help.fullstory.com/hc/en-us/articles/24732235019927)
- AI generalisation pattern in browser automation: Stagehand replays the recorded selector and "falls back to full inference" when it no longer resolves. [doc] — [Stagehand v4: caching](https://docs.stagehand.dev/v4/best-practices/caching)
- Tango reportedly announced "Hybrid Automation" in April 2025, a browser agent built from recorded clicks that pauses for human judgement; Scribe's "Optimize" maps captured workflows and ranks automation opportunities, and Scribe reportedly raised a $75M Series C in February 2026. Third-party comparison pages only; not verified on the vendors' sites. [3p] (snippet) — [Supered: Tango vs Scribe](https://www.supered.io/blog/tango-vs-scribe/); [kyp.ai](https://kyp.ai/scribe-alternatives/)
- Meticulous uses recordings differently: it records sessions with a snippet and replays them against each commit with the network mocked, so the "suite" is continuously derived from recordings. [doc]/[vendor] — [Meticulous: how it works](https://meticulous.ai/how-it-works)

### Inferences
- For a guide that reads the live DOM on every step, a recording does not need to be replayable. Its value is as a labelled route: goal text → ordered list of (screen signature, element role + accessible name). That representation survives CSS and layout changes far better than a stored selector and can be validated against the live DOM at run time.
- Customer effort is real but non-technical: a support or product person spends minutes per flow. Coverage is exactly the N flows recorded; nothing else is learned.
- Recording needs a capture surface in the logged-in app, which is again either the extension (approach 2) or the installed snippet in an "author mode". So approach 3 depends on approach 2 or on the script tag.

### Gaps
- Arcade and Guidde capture internals: not found.
- No published robustness numbers (for example share of recorded steps that still resolve after N weeks) from any recording or DAP vendor.
- How Tango/Scribe agents generalise beyond the recorded path is not documented in anything I retrieved.

---

## 4. Passive learning from real user sessions after install: can the widget (or an analytics tool) build the navigation graph from anonymised transitions, and what are the privacy and performance costs?

### Takeaway
The capture mechanics are proven at scale (Heap, PostHog, Pendo, rrweb-based replay all log element-level interactions from one snippet and define meaning retroactively), but I found no guidance product that documents learning its navigation model from end-user sessions. The binding constraint is legal, not technical: France's CNIL treats session-replay purposes as consent-gated and US wiretap suits target replay vendors, so a transition log must be designed as structure-only, not as replay.

### Cited Findings

**How existing tools capture**
- rrweb-style replay takes an initial DOM snapshot and then records changes via `MutationObserver`; the observer is cheap and "the only complicated bit is serializing the modified DOM nodes"; Highlight moved serialisation and compression to a web worker to keep it off the main thread. [vendor] (snippet) — [Highlight: session replay performance](https://www.highlight.io/blog/session-replay-performance)
- PostHog's own benchmark sampled 10 recording requests with an average payload of 2,799 bytes (range 457–12,772 bytes) and notes deep DOM trees cost more; it distinguishes "no performance impact" from "trivial performance impact". [vendor] (snippet) — [PostHog: session recording performance](https://posthog.com/blog/session-recording-performance)
- PostHog autocapture stores, per `$autocapture` event, the clicked element and its ancestors in an `elements_chain` column (including text and attributes). [doc] (snippet) — [PostHog: analysing autocapture with SQL](https://posthog.com/tutorials/hogql-autocapture)
- Heap: autocapture records "all user interactions automatically, with one snippet of code"; a Virtual Event defined later is retroactive to install; Heap says just over 90% of events used in its customers' reports are Virtual Events; input values are not captured (it records that typing occurred, not the value). [vendor] — [Heap: how autocapture actually works](https://heap.io/blog/how-autocapture-actually-works); (snippet) [Heap: virtual events](https://heap.io/blog/virtual-events)
- Pendo: "since Pendo has retroactive analytics, it's not necessary to tag every Page and Feature immediately." [doc] (snippet) — [Pendo: tagging with the Visual Design Studio](https://support.pendo.io/hc/en-us/articles/360032293971)

**Masking defaults**
- PostHog replay: inputs are masked by default ("we mask these by default"), but "General text is not masked by default"; "Our privacy controls run in the browser or mobile app. So, masked data is never sent over the network to PostHog." [doc] — [PostHog: replay privacy controls](https://posthog.com/docs/session-replay/privacy)
- PostHog autocapture: "PostHog will make a best effort to not capture sensitive information by default. This is not always sufficient"; a PostHog PR notes the old filter could still expose the same elements and attributes in `$elements_chain`. [doc] (snippet) — [PostHog: controlling data collection](https://posthog.com/docs/privacy/data-collection)

**Law and regulation**
- CNIL opened a consultation on a draft session-replay recommendation on 25 February 2026 (closed 22 April 2026). The draft says "the purposes pursued by the deployment of session replay tools are subject to prior user consent" and that processing of the resulting personal data needs its own GDPR Article 6 basis. [doc] (snippet) — [CNIL consultation page](https://www.cnil.fr/en/session-replay-cnil-launches-public-consultation-its-draft-recommendation); [draft PDF](https://www.cnil.fr/sites/default/files/2026-02/recommendation_draft_session_replay.pdf)
- CNIL pages dated 5 November 2026 state that a recommendation for professionals was published in November 2026, recommending dedicated information at the first layer of the consent platform, minimised collection and very short retention; a CNIL webinar presenting it is announced for 17 November 2026. I did not retrieve the final text. [doc] (snippet) — [CNIL: rejeu de session, vos droits](https://www.cnil.fr/fr/rejeu-de-session-vos-droits)
- US: a vendor blog reports the Ninth Circuit held on 20 June 2025 (Bloomingdale's case) that session-replay recordings can be "contents" under California's CIPA §631(a), and cites statutory damages of $5,000 per violation. Not checked against the opinion. [3p] (snippet) — [FlexyConsent guide](https://flexyconsent.com/blog/session-replay-heatmap-tools-consent-guide/)

**Does any guidance product learn this way?**
- None found. The nearest shipped things are admin-driven (Pendo AI tagging scans pages in the designer and only suggests tags), crawler-driven (QA.tech's graph) or test-generation from recorded sessions (Meticulous; Checksum per unverified directories). [doc]/[vendor] — [Pendo AI tagging](https://support.pendo.io/hc/en-us/articles/52003588343963); [QA.tech crawling](https://docs.qa.tech/core-concepts/crawling); [Meticulous](https://meticulous.ai/how-it-works)

**Using the learned graph for speed**
- "Speculative Actions" (ICLR 2026) has a fast model predict the next action and commits only when it matches the authoritative model, reporting up to 55% next-action prediction accuracy; a related system reports a 73.4% hit rate on the first step. [doc] (snippet) — [arXiv 2510.04371](https://arxiv.org/abs/2510.04371); [arXiv 2511.20048](https://arxiv.org/html/2511.20048v1)

### Inferences
- The widget already reads role, label and state of interactive elements with values excluded and identifiers masked. Logging only (hashed screen signature, element role + label, resulting screen signature), with no text nodes, no coordinates, no timing stream and no user identifier, is much narrower than session replay. Whether a regulator would still class it with replay is a legal question I cannot answer; the CNIL text is the thing to read. Element labels can themselves contain personal data in a B2B app ("Invoice for Jane Doe"), so label capture needs an allow-pattern or the same masking the widget applies today.
- Coverage is the best of any approach in the long run (all roles, tenants, flags, real data states) and requires nothing beyond the script tag, but it has a cold start and it learns what users do, not what is correct. It learns fastest from guided sessions, where the goal is known: each completed guidance run yields a labelled route for free.
- This is the natural source for "memory for speed": a per-customer table of (goal cluster, screen) → usual next element supports both an LLM-free fast path and speculative precomputation.
- Enterprise customers will ask whether this is on by default, where it is stored, retention, and whether it trains shared models (see the Vanta question list in section 9). A per-customer, opt-in, structure-only graph is the defensible default.

### Gaps
- No source found on process-mining-style path discovery applied to product clickstreams by a guidance vendor.
- Fullstory's indexing and "private by default" behaviour: not sourced (search budget exhausted).
- The final CNIL recommendation text and the Ninth Circuit opinion were not read directly.
- No published measurement of main-thread or payload cost for a transitions-only logger (replay benchmarks overstate it).

---

## 5. Source-code and build-time integration: what do a repo reader, a bundler plugin or runtime framework introspection yield, and what do they cost the customer?

### Takeaway
Build-time component annotation is a solved, widely shipped technique (Sentry and Fullstory both publish Babel plugins that stamp component names onto DOM nodes), and it is the only approach that gives truly stable element identifiers. It costs a build change, a code review and a release, so it is an upgrade for committed customers, not an onboarding step.

### Cited Findings
- Sentry's motivation: with React, selectors "become unreadable in production due to the minification process" (example: `button.en302zp1.app-191aavw.e16hd6vm2[...]`). Its Babel-based annotation adds `data-sentry-component` (component name), `data-sentry-element` (Emotion-styled component name) and `data-sentry-source-file`; it works out of the box with Sentry's Vite/Webpack/Rollup bundler plugins and the browser SDK reads the attributes from 7.91.0. Published 30 May 2024. [doc] — [Sentry blog: from unreadable CSS selectors to clear component names](https://blog.sentry.io/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/)
- The plugin is React-only (parses `.jsx`/`.tsx`), has an `ignoredComponents` option, and must run before other JSX-transforming plugins. [doc] (snippet) — [@sentry/babel-plugin-component-annotate](https://socket.dev/npm/package/@sentry/babel-plugin-component-annotate)
- Fullstory's open-source `@fullstory/babel-plugin-annotate-react` adds `data-component`, `data-element` and `data-source-file`; Fullstory says it works with CSS-in-JS libraries (the main case where generated class names break selectors) and that attributes apply only to sessions captured after deployment. [doc] (snippet) — [GitHub README](https://github.com/fullstorydev/fullstory-babel-plugin-annotate-react/blob/master/README.md); [Fullstory help](https://help.fullstory.com/hc/en-us/articles/360049493054-FullStory-s-Annotate-React-plugin-for-Web-Native); [Fullstory engineering blog](https://www.fullstory.com/blog/react-end-to-end-testing-custom-plugin/)
- Pendo can auto-create Features from developer-added custom HTML attributes: it "adds new Pendo Features to your Features list when elements associated with your custom HTML attributes are clicked", and says that if the team already uses attributes for automated test suites this "could be a good fit". [doc] — [Pendo: automatic Feature tagging with custom HTML attributes](https://support.pendo.io/hc/en-us/articles/20116813908763)
- Meticulous ships framework plugins (Nuxt, Vite, rsbuild) that inject its recorder at build time, by default only in development builds. [doc] — [Meticulous: recorder script](https://app.meticulous.ai/docs/how-to/recorder-script.md)
- Runtime React introspection: every DOM node React renders carries a hidden `__reactFiber$<random>` property pointing to its Fiber; tools read `fiber.type.displayName || fiber.type.name`. Source locations come from `_debugSource`, which exists only in dev builds on React 17/18 and was removed in React 19, so tools fall back to a build plugin. [3p] (snippet) — [dom-to-fiber-utils](https://github.com/aliemir/dom-to-fiber-utils); [fiber-inspector](https://www.pkgstats.com/pkg:@justuswitmer/fiber-inspector)
- Repo access is treated as high-risk: one compliance guide calls source code "perhaps the most sensitive data your organization will store in GitHub"; a 2022 GitHub bug let apps mint tokens with overly permissive scope; admin guidance is to approve low-risk read-only scopes from trusted vendors and require security review for high-risk integrations. [3p] (snippet) — [Rewind: GitHub compliance concerns](https://rewind.com/blog/top-github-compliance-concerns/); [The Register](https://www.theregister.com/2022/06/21/github_bug_apps/)
- A repo/CI hook is normal in AI QA: QA.tech updates its app graph "as PRs come in"; QA Wolf runs flows "against the preview deploy of a pull request". [vendor]/[doc] — [QA.tech blog](https://qa.tech/blog/knowledge-graphs-for-ai-agents); [QA Wolf](https://docs.qawolf.com/qawolf/Full-Service-The-First-Three-Months)

### Inferences
- What it yields: stable identifiers (component name, optional source file) on every interactive element, and, if a manifest is emitted, a complete route list. It yields no runtime state, labels in context or "how to reach a goal" on its own; it makes the other approaches' caches and recordings durable.
- Fiber reading in production gives minified function names unless the app sets `displayName`, and it depends on React internals that changed in React 19, so it is not a dependable substitute for build-time stamping (the minification point is my understanding, not a quoted source).
- Reuse beats new work: many teams already have `data-testid` (or Sentry/Fullstory annotations). The widget can prefer any stable attribute it finds, and onboarding can simply ask "which attribute do your tests use?", which is how Pendo positions its attribute tagging.
- A GitHub App with `contents: read` triggers the hardest security conversation of any option here and should not be on the default onboarding path for an early-stage vendor.

### Gaps
- LogRocket component naming, click-to-component tools and framework router introspection (Next.js route manifest, React Router/Vue Router at runtime): not researched before the search budget ran out.
- No data on how often enterprises refuse repo access to a non-developer-tool vendor.
- No performance/bundle-size figures published for the annotation plugins.

---

## 6. Declarative exposure to agents (WebMCP, MCP-B, NLWeb, llms.txt, registered "actions"): what is real in November 2026, and can an early customer be asked to do it?

### Takeaway
WebMCP is in a Chrome and Edge origin trial with an API that moved during 2026 and, as of mid-2026, almost no production deployment and few consuming agents; llms.txt is published by a minority of sites and rarely read by crawlers. Developer-registered actions (Intercom Fin data connectors/Procedures, Command AI actions, CopilotKit tools) work today but are real engineering projects per customer. None of this is a realistic onboarding requirement for an early customer; it is an optional accelerator to consume when present.

### Cited Findings

**WebMCP**
- Chrome describes WebMCP as "a proposed web standard to help you build and expose structured tools for AI agents", with an imperative JavaScript API and a declarative API that annotates HTML forms. Origin trial "from Chrome 149"; local flag `chrome://flags/#enable-webmcp-testing`. Docs published 18 May 2026, last updated 7 October 2026. [doc] — [Chrome: WebMCP](https://developer.chrome.com/docs/ai/webmcp)
- Origin-trial announcement dated 9 June 2026: "In Chrome 149, you can sign up for the WebMCP origin trial." No end version stated on the page. [doc] — [Chrome blog: join the WebMCP origin trial](https://developer.chrome.com/blog/ai-webmcp-origin-trial)
- Documented limits: gated by a `tools` Permissions Policy that "defaults to `self`" (cross-origin iframes need `allow="tools"`); "Clients and browsers must visit a site directly to know if it has callable tools"; the API is "primarily designed for local browser workflows with a human in the loop"; "If your site is highly complex, you likely need to refactor or add JavaScript to handle application and interface state"; the standard is "under active discussion and subject to change". [doc] — [Chrome: WebMCP](https://developer.chrome.com/docs/ai/webmcp)
- Community-group implementation status: Chrome 149 origin trial live; Edge 150 origin trial live; ChatGPT Desktop listed as supported; Brave 1.102.2 supports it in Leo with release expected 5 January 2027; Firefox and Safari have only standards-position issues; Meta Ray-Ban Display "coming soon", registering tools with `document.modelContext.registerTool()`. [doc] — [webmachinelearning/webmcp implementation-status.md](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)
- Google said at I/O 2026 that Gemini in Chrome "will soon support WebMCP APIs". [doc] (snippet) — [Chrome at I/O 2026](https://developer.chrome.com/blog/chrome-at-io26)
- API churn: a vendor blog dated 23 July 2026 says the 21 July 2026 spec draft "moved the API from `navigator` to `document`", that "Chrome 150 deprecates `navigator.modelContext`" while the trial still serves it, and recommends `document.modelContext ?? navigator.modelContext`. [3p] — [Spronta: state of WebMCP, July 2026](https://www.spronta.com/blog/state-of-webmcp-july-2026/)
- Adoption as of July 2026 per the same blog (a crawler vendor): "close to zero deployment on real websites"; "not one mainstream AI agent that calls the tools"; Google's listed trial participants include Expedia, Booking.com, Shopify, Credit Karma, TurboTax, Redfin, Etsy, Instacart and Target, but "Deployment is a separate step none of them has confirmed"; the spec is a draft community group report, not on the standards track. This conflicts in part with the later implementation-status page listing ChatGPT Desktop as supported. [3p] — [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/); contrast [implementation-status.md](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)
- Trial end date: sources conflict (Chrome 149–156 per Spronta; extended to Chrome 162 on 31 October 2026 per one blog; 30 March 2027 per a GitHub list). Not confirmed on a Chrome page. [3p] (snippet) — [nohacks.co](https://nohacks.co/blog/what-is-webmcp); [awesome-webmcp](https://github.com/firstmoverprojects/awesome-webmcp)
- MCP-B is the polyfill route: `@mcp-b/webmcp-polyfill` and `@mcp-b/global` implement the `modelContext` API for browsers without native support. [doc] (snippet) — [WebMCP-org npm packages](https://github.com/WebMCP-org/npm-packages)

**NLWeb and llms.txt**
- NLWeb (Microsoft): a readiness tracker lists Tripadvisor and O'Reilly as production deployments and several others as announced, rates the direction of travel "flat" as of 28 July 2026, and notes the reference repository has never shipped a tagged release. [3p] (snippet) — [Lumar agentic readiness: NLWeb](https://agentic-readiness.lumar.io/docs/capabilities/nl-web.md)
- llms.txt: 8.6% of the top 100,000 domains publish one (SEOmator); Ahrefs found 97% of such files were never requested; a 12-week study of 83 sites saw OpenAI's crawler read llms.txt 7 times against 3,990 robots.txt fetches. [3p] (snippet) — [SEOmator](https://seomator.com/blog/llms-txt-adoption); [PPC Land on Ahrefs](https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/); [Something Inc](https://somethinginc.com/blog/llms-txt-ai-crawlers-fetch-data/)

**Developer-registered actions in copilot products**
- Intercom Fin: data connectors are set up in four phases (API, data, Fin, security) and Procedures are "the next evolution of Tasks", with access handled through an account manager; a procedure's connectors count as healthy at a >95% success rate and average response under 50 KB. [doc] (snippet) — [Intercom: set up data connectors](https://www.intercom.com/help/en/articles/9916497-how-to-set-up-data-connectors-for-fin); [Fin Procedures explained](https://www.intercom.com/help/en/articles/10257113-fin-procedures-explained); [Fin: data connectors in Procedures](https://fin.ai/help/en/articles/13976221-how-to-use-data-connectors-in-fin-procedures)
- Command AI (acquired by Amplitude, announced 15 October 2024): "actions" are either a callback or an API request, defined in the dashboard; callback actions are disabled automatically if the callback has not been provided in the user's session; Copilot "can teach users how a UI works and execute actions on their behalf"; TechCrunch described its AI co-browsing as "effectively taking control of their mouse". [doc]/[3p] (snippet) — [Command AI docs: actions](https://command.ai/docs/platform/building-blocks/actions/); [Amplitude press release](https://amplitude.com/press/amplitude-acquires-command-ai)
- CopilotKit: `useCopilotReadable` exposes app state and `useCopilotAction` exposes callable actions; both v1 hooks are now marked deprecated in favour of v2 (`useFrontendTool`). [doc] (snippet) — [CopilotKit: useCopilotAction](https://docs.copilotkit.ai/reference/v1/hooks/useCopilotAction)

### Inferences
- For a point-and-guide product the useful declarative artefact is not an action API but a route hint ("billing lives at Settings → Billing"). WebMCP tools describe actions an agent can execute, which is a different product shape from guiding a human's click; a registered tool's name and description are still good intent vocabulary when present.
- Realistic stance for 2026: detect and consume (`modelContext` tools, `data-testid`, an llms.txt or OpenAPI file if the customer has one) but never require. Asking an early customer to adopt an origin-trial API whose namespace changed three months ago would be a poor trade.
- Developer-registered actions are how incumbents got depth, and they are why those deployments take weeks. A product whose pitch is "one script tag" competes by not needing them.

### Gaps
- Whether a third-party in-page script (as opposed to the browser's agent or an extension) can enumerate a page's registered WebMCP tools is not stated in the docs I read.
- assistant-ui, Vercel AI SDK tool calling and OpenAPI-based "actions": not researched before the search budget ran out.
- No measured WebMCP adoption figure later than July 2026.

---

## 7. Help-content ingestion: how do AI support vendors ingest docs, tickets and tours at onboarding, and how good is it?

### Takeaway
Ingesting public help content is the zero-effort baseline every AI support vendor starts with, and it explicitly cannot see behind a login. It gives intent and vocabulary, not element-level knowledge, and published quality numbers are inconsistent and mostly vendor- or competitor-sourced.

### Cited Findings
- Intercom Fin syncs public websites only; content behind a login cannot be imported ("Fin won't be able to access or import it"); up to 100 websites; synced content is read-only and edited at source. [doc] (snippet) — [Intercom: syncing and managing public URLs](https://www.intercom.com/help/en/articles/9357945-syncing-and-managing-public-urls)
- Fin PDFs are not re-synced: "you'll need to remove and re-add the PDF if you make changes". [doc] (snippet) — [Intercom: knowledge FAQs](https://www.intercom.com/help/en/articles/9357957-knowledge-faqs)
- Fin resolution-rate figures conflict: 51% average (a competitor citing a 2025 report), 67% "late 2025" (another summary), and 80% as Intercom's own internal result. No authoritative 2026 average found. [3p]/[doc] (snippet) — [Fini comparison](https://www.usefini.com/guides/top-ai-email-agents-intercom-proprietary-knowledge-base-integration); [Intercom: knowledge management for AI support](https://www.intercom.com/help/en/articles/11782981-mastering-knowledge-management-for-great-ai-support)
- Zendesk AI agents historically used only help-center content and can now also use external content via Knowledge or the Federated Search API. [doc] (snippet) — [Zendesk: multiple knowledge sources in AI agents](https://support.zendesk.com/hc/en-us/articles/9957739307930-Announcing-support-for-multiple-knowledge-sources-in-AI-agents)
- Decagon ingestion is described as pulling from help centers, Confluence, Google Drive, SharePoint, past support tickets and agent macros, with procedures written afterwards; typical deployment is quoted at about 3–6 weeks for Decagon and 4–10 weeks for Sierra. Third-party and competitor sources. [3p] (snippet) — [eesel: Decagon knowledge base setup](https://www.eesel.ai/blog/decagon-knowledge-base-setup); [Twig comparison](https://www.twig.so/blog/decagon-vs-sierra-vs-twig-implementation-speed)
- Anthropic's guidance (19 September 2024): if the knowledge base is under about 200,000 tokens (about 500 pages) "you can just include the entire knowledge base in the prompt", and prompt caching makes this "significantly faster and more cost-effective", "reducing latency by > 2x and costs by up to 90%". [doc] — [Anthropic: contextual retrieval](https://www.anthropic.com/news/contextual-retrieval)

### Inferences
- Help articles answer "what is the user trying to do and what is it called", and often contain a prose route ("go to Settings, then Billing"). They are frequently stale relative to the UI, so they should bias the model, never override what the live DOM shows.
- Because a typical SaaS help center fits within a cached prompt, stuffing plus caching is the correct default; retrieval becomes worthwhile only when the corpus outgrows the cache-friendly size or when per-step prompt size is the latency bottleneck.
- Support tickets are the richest source of real user phrasing for goals, but exporting them brings personal data and a DPA conversation; it is a later-stage ask.

### Gaps
- Ingestion of video tutorials and import of existing DAP tours (Pendo/Appcues/WalkMe exports) as a knowledge source: nothing found.
- No independent accuracy benchmark for help-content-grounded UI guidance.

---

## 8. Latency engineering independent of site knowledge: what are the real numbers for caching, small models, streaming, speculation, on-device and edge inference?

### Takeaway
The big, published levers are (a) skipping the model entirely on a validated cache hit (tens of milliseconds versus seconds), (b) using a non-reasoning small model, whose time to first token is around 0.6–1.2 s versus several seconds to first answer token for reasoning modes even at low effort, and (c) prompt caching with cache reads priced at 2.5–10% of input. On-device models in Chrome are desktop-only with heavy hardware requirements and cannot be the primary path.

### Cited Findings

**Prompt caching (Anthropic, as retrieved 2026-11-12)**
- TTL is 5 minutes by default, refreshed at no cost on each use, with a 1-hour option; writes cost 1.25x (5 min) or 2x (1 h) base input; reads cost 0.1x for most models, 0.05x for Opus 5.5 and Sonnet 5.5, and 0.025x for Fable/Mythos 5.1 and 5.2. [doc] — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Listed prices per million tokens (base input / cache read / output): Fable 5.2 $8 / $0.20 / $40; Opus 5.5 $4 / $0.20 / $20; Sonnet 5.5 $2 / $0.10 / $10; Haiku 5.5 (prompts ≤100K tokens) $0.10 / $0.01 / $0.50; Haiku 4.5 $1 / $0.10 / $5. Re-check against the live table before quoting. [doc] — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Mechanics: up to 4 breakpoints; prefix order tools → system → messages; hits require a 100% identical prefix; lookback of 20 blocks; minimum cacheable length 512 tokens on the newest models (4,096 on Haiku 4.5, Opus 4.5/4.6); caches are isolated per workspace; a cache entry is available only after the first response starts; pre-warming with `max_tokens: 0` is recommended; the docs say you "generally see improved time-to-first-token for long documents" (no percentage). [doc] — [Claude docs: prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Model choice and measured latency**
- Claude Haiku 4.5 non-reasoning, time to first token by provider: Google Vertex 0.62 s, Anthropic 1.17 s, Azure 1.42 s, Bedrock 1.50 s (Artificial Analysis, 5-day average; the model is now marked deprecated there). An earlier snapshot showed about 91–102 output tokens/s. [3p] — [Artificial Analysis: Claude 4.5 Haiku providers](https://artificialanalysis.ai/models/claude-4-5-haiku/providers)
- Claude Haiku 5.5 with reasoning effort: time to first *answer* token (includes thinking) 6.28 s at low effort, 11.39 s at medium, 182.88 s at max, on Anthropic's API (Artificial Analysis workloads, which average single-request and multi-turn agentic runs, so not directly comparable to a short UI prompt). I opened only the max-effort page; the low and medium figures are snippet-level. [3p] — (snippet) [AA: Haiku 5.5 low](https://artificialanalysis.ai/models/claude-haiku-5-5-low/providers); (snippet) [AA: Haiku 5.5 medium](https://artificialanalysis.ai/ko/models/claude-haiku-5-5-medium/providers); [AA: Haiku 5.5 max](https://artificialanalysis.ai/models/claude-haiku-5-5/providers)
- Gemini 3.5 Flash-Lite: about 406–456 output tokens/s but 6.1–6.6 s time to first token on Google's API; Gemini 3.1 Flash-Lite: 388.8 tokens/s and 5.18 s. Fast generation does not imply a fast first token. [3p] (snippet) — [AA: Gemini 3.5 Flash-Lite](https://artificialanalysis.ai/models/gemini-3-5-flash-lite); [AA: Gemini 3.1 Flash-Lite](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview)
- Lowest time-to-first-token entries in one Artificial Analysis listing are small open models: Llama 4 Scout 0.61 s, Gemma 3 12B 0.98 s, Llama 3.1 8B 1.01 s. [3p] (snippet) — [Artificial Analysis providers listing](https://artificialanalysis.ai/providers/cloudflare)
- Anthropic "fast mode" gives up to 2.5x higher output tokens/s on supported Opus models and targets output speed, not time to first token; Anthropic's latency guide recommends a faster model such as Haiku 5.5, fewer prompt/output tokens, and streaming. [doc] (snippet) — [Claude docs: fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode); [Claude docs: reduce latency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency)
- Small models on visual UI grounding (ScreenSpot-Pro): Ferret-UI Lite (3B) reports 53.3%; an aggregator lists Holo2-4B 68.6%, Holo2-8B 71.4% and UI-Venus-1.5-2B 57.7% (aggregator rows not verified against papers). No latency figures in these sources, and the benchmark tests screenshot grounding only, not DOM-text element selection or multi-step flows. [doc]/[3p] (snippet) — [Ferret-UI Lite, arXiv 2509.26539](https://arxiv.org/html/2509.26539v1); [benchmarklist.com](https://benchmarklist.com/benchmarks/screenspot_pro/)
- Text snapshots are cheaper than screenshots: one comparison puts a login form at about 3,800 tokens as an accessibility snapshot versus 10,000+ as a screenshot. Third-party blog; ratios vary widely by source. [3p] (snippet) — [DEV: accessibility snapshots vs screenshots](https://dev.to/pointchecknote/browser-automation-with-claude-playwright-mcp-why-accessibility-snapshots-beat-screenshots-2pke)

**Streaming partial structured output**
- Anthropic fine-grained tool streaming: set `eager_input_streaming: true` on a tool and its input is streamed as generated, "without server-side buffering or JSON validation"; the accumulated input "might be invalid or incomplete JSON", so the client must tolerate partial parses. Available on all models. [doc] (snippet) — [Claude docs: fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)

**Skipping or predicting the model call**
- Stagehand: cached action replay about 50–100 ms versus 1–5 s for LLM inference (docs figure), with fallback to inference if the selector no longer resolves. [doc] (snippet for the numbers) — [Stagehand speed guide (mirror)](https://www.mintlify.com/browserbase/stagehand/best-practices/speed-optimization); [Stagehand v4 caching](https://docs.stagehand.dev/v4/best-practices/caching)
- Semantic caching in practice: production hit rates of 20–45% are reported against 60–70% in papers; a banking FAQ benchmark saw false-positive rates up to 99% for some embedding models at a 0.7 similarity threshold, 27.2% at 0.9 for e5-large-v2, and 3.8% for the best model after tuning; one team reported 67% hits, 73% cost reduction and a 0.8% false-positive rate after three months. Practitioner and vendor-affiliated sources. [3p] (snippet) — [InfoQ](https://www.infoq.com/articles/reducing-false-positives-retrieval-augmented-generation); [DEV](https://dev.to/gauravdagde/llm-semantic-caching-the-95-hit-rate-myth-and-what-production-data-actually-shows-8ga); [VentureBeat](https://venturebeat.com/orchestration/why-your-llm-bill-is-exploding-and-how-semantic-caching-can-cut-it-by-73)
- Speculative precomputation: "Speculative Actions" (ICLR 2026) reports up to 55% next-action prediction accuracy with a lossless commit-on-match design; SPAgent reports a 73.4% first-step hit rate. [doc] (snippet) — [arXiv 2510.04371](https://arxiv.org/abs/2510.04371); [arXiv 2511.20048](https://arxiv.org/html/2511.20048v1)
- Retrieval versus stuffing: Anthropic says under about 200K tokens, put the whole knowledge base in a cached prompt. [doc] — [Anthropic: contextual retrieval](https://www.anthropic.com/news/contextual-retrieval)

**On-device and edge**
- Chrome Prompt API (Gemini Nano): available to web pages from Chrome 148 and to extensions from Chrome 138; desktop only (Windows 10/11, macOS 13+, Linux, Chromebook Plus), not Chrome on Android or iOS; needs at least 22 GB free disk and either a GPU with more than 4 GB VRAM or 16 GB RAM with 4+ cores; languages en/ja/es/de/fr; structured output via `responseConstraint` (JSON Schema). Docs last updated 21 October 2026. [doc] — [Chrome: Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- Gemini Nano speed/quality: only an anecdotal blog figure (52 tokens/s, 384 ms average latency, hardware unstated). No source for the share of Chrome users whose devices qualify. [3p] (snippet) — [onpiste blog](https://onpiste-website.pages.dev/blog/17-chrome-nano-ai-benchmarks)
- WebLLM/WebGPU: 41.1 tokens/s for Llama 3.1 8B on an M3 Max (about 71% of native); small-model downloads of roughly 200–850 MB and a 3–10 s initialisation window on first use are reported by blogs. [doc]/[3p] (snippet) — [WebLLM paper, arXiv 2412.15803](https://arxiv.org/html/2412.15803v1); [tianpan.co](https://tianpan.co/blog/2026-04-17-browser-native-llm-inference-webgpu)
- Cloudflare Workers AI: Cloudflare reports p90 time per token falling from about 100 ms to 20–30 ms after an architecture change and says prefix caching lowers time to first token; no absolute Workers AI TTFT is published. [vendor] (snippet) — [Cloudflare blog: high-performance LLMs](https://blog.cloudflare.com/high-performance-llms/)

### Inferences
- A rough per-step budget from these numbers: a validated cache hit can point in well under 200 ms; a non-reasoning small model with a cached prompt and the target field streamed first can point in roughly 1 s; any reasoning mode, even "low", is likely several seconds before the first answer token. The current design (large model, low effort) is therefore probably paying mostly for thinking time, not for output tokens. This should be measured on the product's own prompts; the Artificial Analysis workloads are not the same shape.
- Order the structured output so the target element reference is the first field, stream it eagerly, move the pointer on the partial parse, and let the sentence follow.
- Exact-key caching on (customer, normalised goal cluster, screen signature) → element descriptor, validated against the live DOM before pointing, avoids the false-positive problem that makes pure embedding-similarity caches risky. Use embeddings only to map the user's wording to a goal cluster, and treat a miss or a failed validation as a normal model call.
- Speculation fits this product unusually well because the human's read-and-click time (seconds) is idle: precompute the next step for the predicted next screen while the user is reading the current instruction. Hit rates around 50% in the literature imply roughly half of steps could feel instant, at the cost of extra model calls.
- 5-minute cache TTL is short for a low-traffic customer; the 1-hour TTL (2x write) plus pre-warming when the widget opens avoids a cold first step. Per-workspace cache isolation means one shared system prefix per customer is the unit to keep warm.
- Chrome's built-in model is unusable as the primary path (no mobile, heavy hardware floor, unknown eligible share) but could serve a cheap local classifier later. Edge deployment helps network round-trip only; inference time dominates.

### Gaps
- No published latency for the current large Claude models at low effort on short prompts, and no non-reasoning Haiku 5.5 TTFT figure on Artificial Analysis pages I could read.
- No public benchmark of current small models on DOM-text element selection (the task this product actually performs); ScreenSpot-Pro is screenshot-based.
- No authoritative Gemini Nano quality or tokens/s data and no eligible-device share.
- No Workers AI absolute TTFT.

---

## 9. Third-party-script security requirements: what will shape onboarding regardless of approach?

### Takeaway
Every comparable vendor documents the same package: exact CSP hosts for `script-src` and `connect-src`, nonce support for inline bootstrap or styles, a first-party proxy or CNAME option, an allowed-domains list, in-browser masking, and SOC 2 / DPA / subprocessor paperwork. A script that reads the DOM will be asked the session-replay questions even if it records nothing.

### Cited Findings
- Pendo CSP: `script-src` needs `cdn.pendo.io` plus account-specific content hosts; `connect-src` needs `data.pendo.io`, the content host and `app.pendo.io`; `'unsafe-eval'` is needed only for custom code blocks, Resource Center integrations or classic guides; `'unsafe-inline'` in `style-src` can be replaced by a nonce passed as `inlineStyleNonce`; regional hosts differ (EU, US1, Japan, Australia); a CNAME setup (for example `content.pendo.example.com`, `data.pendo.example.com`) is arranged through Pendo Support. [doc] — [Pendo: Content Security Policy](https://support.pendo.io/hc/en-us/articles/360032209131)
- Pendo also offers a content proxy that serves guide content from a Pendo-controlled domain instead of `storage.googleapis.com` for stricter CSPs. [doc] (snippet) — [Pendo: content proxy for stricter CSP rules](https://support.pendo.io/hc/en-us/articles/42058593231899-Use-the-content-proxy-for-stricter-CSP-rules)
- Fullstory CSP: `edge.fullstory.com` and `rs.fullstory.com` in `script-src` and `connect-src` (EU accounts use `eu1` subdomains); the inline bootstrap needs `'unsafe-inline'` or a nonce; Fullstory recommends testing with a report-only header first; "Relay" is an open-source service for sending capture traffic through the customer's own domain. [doc] (snippet) — [Fullstory: CSP](https://help.fullstory.com/hc/en-us/articles/360020622854); [Fullstory Relay](https://help.fullstory.com/hc/en-us/articles/360046112593)
- Intercom: "fully supports strict CSPv3" (nonce-based `script-src`); the Messenger has a trusted-domains list, and if it is left blank the Messenger can appear on any domain; logged-in users are protected with Identity Verification (`user_hash`) or JWT-based Messenger Security. [doc] (snippet) — [Intercom: using Intercom with CSP](https://www.intercom.com/help/en/articles/3894-what-domains-do-i-need-to-whitelist); [Intercom: trusted domains](https://www.intercom.com/help/en/articles/4418-list-trusted-domains-you-use-with-intercom)
- PostHog CSP: `script-src` and `connect-src` `https://*.posthog.com`, `worker-src` `blob:`/`data:`; nonces are supported via `prepare_external_dependency_script`; with a reverse proxy you allow your proxy domain instead; PostHog advises against being stricter than the wildcard because subdomains may change. The page does not mention SRI or pinned versions. [doc] — [PostHog: content security policy](https://posthog.com/docs/advanced/content-security-policy)
- PostHog reverse proxy: serving through the customer's own subdomain "typically increases event capture by 10-30%" because ad blockers block known analytics domains; choose a neutral subdomain name. [doc] (snippet) — [PostHog: deploy a reverse proxy](https://posthog.com/docs/advanced/proxy)
- Meticulous requires CSP exceptions and that its script be the first to load, in the initial server HTML, with no `async`/`defer`. [doc] — [Meticulous: recorder script](https://app.meticulous.ai/docs/how-to/recorder-script.md)
- SRI versus auto-update: hash-based enforcement is "more secure but impractical for frequently changing or dynamically updated third-party scripts"; PCI DSS 4.0.1 requirements 6.4.3 and 11.6.1 require an inventory, authorisation and integrity monitoring of payment-page scripts. Compliance-vendor sources. [3p] (snippet) — [Jscrambler](https://jscrambler.com/?p=6002); [Report URI](https://blog.report-uri.com/pci-dss-4-0-1-and-requirements-6-4-3-and-11-6-1-what-changed-for-payment-page-scripts/)
- Typical buyer privacy questions (Vanta): what customer data is collected and shared; where it is stored and transferred; subprocessor list; applicable regulations; retention; "Do you use customer data to train AI models?"; DSAR support; what happens at termination. Buyers typically also request a SOC 2 Type 2 report, ISO/IEC 27001, DPAs and security policies. [3p] — [Vanta: privacy questions in enterprise security reviews](https://www.vanta.com/resources/privacy-questions-enterprise-security-reviews)
- Masking in the browser is the accepted standard: PostHog states privacy controls run client-side so "masked data is never sent over the network"; Pendo AI tagging sanitises DOM content "client-side, in your browser" before any AI call. [doc] — [PostHog: replay privacy](https://posthog.com/docs/session-replay/privacy); [Pendo AI tagging](https://support.pendo.io/hc/en-us/articles/52003588343963)
- WebMCP tools are gated by a `tools` Permissions Policy defaulting to `self`. [doc] — [Chrome: WebMCP](https://developer.chrome.com/docs/ai/webmcp)

### Inferences
- Minimum onboarding kit for any snippet-based approach: one stable script host and one API host (so the CSP change is two lines), a nonce-compatible loader with no `eval` and no inline styles that need `'unsafe-inline'`, a publishable key bound to an allowed-origin list, a versioned (pinnable) bundle URL for customers who want SRI alongside the default auto-updating URL, and a first-party proxy recipe.
- The security-review packet should pre-answer the Vanta list plus the DOM-specific questions: exactly which DOM fields leave the browser, that values are never read, how masking works and that it runs client-side, which model provider is a subprocessor, retention, region, and that customer data does not train shared models.
- The CSP change is itself an engineering ticket at many companies, so "one script tag" is often "one script tag plus a CSP pull request plus a security review". This is the strongest argument for the extension trial: it defers all three until the buyer is convinced.

### Gaps
- Shadow DOM isolation (what closed mode does and does not protect, and whether reviewers accept it as isolation): not sourced because the search budget ran out. Treat any claim here as unverified.
- SOC 2 timing expectations for early-stage vendors and whether a self-hosting option is demanded in practice: no source.
- Whether any vendor publishes SRI hashes for a pinned snippet version: not found for Pendo, Fullstory, Intercom or PostHog.

---

## 10. For a typical B2B SaaS app (React/Next.js SPA behind a login), which approaches can actually produce a usable map of the logged-in UI, ranked by coverage and by customer effort?

### Takeaway
Only four approaches see the real logged-in UI: passive learning through the installed widget, authenticated cloud exploration, capture from the admin's own browser, and recorded demonstrations. Help content and declarative files add intent but no screen-level map, build-time integration adds stability but no behaviour, and an unauthenticated crawl yields essentially nothing.

### Cited Findings
- Public crawlers cannot see behind a login (Intercom: content behind a login cannot be imported). [doc] (snippet) — [Intercom: syncing public URLs](https://www.intercom.com/help/en/articles/9357945-syncing-and-managing-public-urls)
- Authenticated crawling to a page/action graph is shipped by QA.tech (screenshot, source action, depth and found actions per iteration; login state reused from a login test). [doc] — [QA.tech: crawling](https://docs.qa.tech/core-concepts/crawling)
- In-session DOM capture as the admin navigates is shipped by Pendo AI tagging. [doc] (snippet) — [Pendo: Tag with AI](https://support.pendo.io/hc/en-us/articles/54741747298459)
- One-snippet autocapture of all interactions with retroactive definition is shipped by Heap and Pendo. [vendor]/[doc] — [Heap](https://heap.io/blog/how-autocapture-actually-works); [Pendo](https://support.pendo.io/hc/en-us/articles/360032293971)
- Minified production selectors are unreadable and unstable in React apps, which is why Sentry and Fullstory stamp component names at build time. [doc] — [Sentry blog](https://blog.sentry.io/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/)

### Inferences
Ranking by eventual coverage of logged-in screens (my judgement from the evidence above):
1. Passive learning via the installed widget: all roles, tenants, flags and data states that real users reach; grows with traffic; cold start.
2. Authenticated cloud exploration: broad for one role and one tenant; misses data-dependent and permission-gated states; hours to days.
3. Capture in the admin's browser (extension or author mode): whatever the admin visits, with their real data and permissions.
4. Record-by-demonstration: exactly the N flows recorded, at high precision.
5. Build-time/source integration: complete inventory of routes and components, but no runtime labels, state or routes-to-goal.
6. Declarative exposure: only what the developer registers.
7. Help content: intent and names, sometimes prose routes; no element identifiers.
8. Unauthenticated crawl: login page and marketing site only.

Ranking by customer effort, least first: help-center URL → extension install by an admin → recording flows → script tag (plus CSP and review) with passive learning → test credentials for cloud exploration → data attributes/build plugin → repo access → registering actions or WebMCP tools.

### Gaps
- No vendor publishes coverage percentages for any of these on real SaaS apps; the coverage ranking is reasoned, not measured.

---

## 11. Which approaches need zero customer engineering time, which need one script tag, and which need a build step or credentials? (The ladder, and what each rung buys)

### Takeaway
There is a clean ladder: URL only → admin's browser extension → recorded flows → script tag → credentials → build step → repo/registered actions. The first three rungs need no engineer and no security review; the script tag is the first rung that reaches end users and the first that triggers CSP and vendor review.

### Cited Findings
- Rung evidence, zero engineering: public help-content sync (Intercom, Zendesk). [doc] (snippet) — [Intercom](https://www.intercom.com/help/en/articles/9357945-syncing-and-managing-public-urls); [Zendesk](https://support.zendesk.com/hc/en-us/articles/9957739307930-Announcing-support-for-multiple-knowledge-sources-in-AI-agents)
- Zero engineering, admin's browser: preview before snippet (Userflow, Fullstory, Usetiful, Product Fruits, HelpHero). [doc] — [Userflow](https://help.userflow.com/docs/userflow-chrome-extension); [Fullstory](https://help.fullstory.com/hc/en-us/articles/37802698713367)
- One script tag: Userpilot lists plain snippet, Segment, Google Tag Manager and npm as install routes; the snippet goes before `</head>` on each page. [vendor] (snippet) — [Userpilot implementation guide](https://userpilot.com/blog/?p=183038)
- Script tag implies CSP edits at the customer (Pendo, Fullstory, PostHog, Intercom, Meticulous all document them). [doc] — [Pendo CSP](https://support.pendo.io/hc/en-us/articles/360032209131); [PostHog CSP](https://posthog.com/docs/advanced/content-security-policy)
- Credentials rung: QA Wolf and Octomind ask for environment plus test credentials; 2FA usually needs a human or a TOTP secret. [doc] — [QA Wolf](https://docs.qawolf.com/qawolf/Full-Service-The-First-Three-Months); [Browserbase](https://docs.browserbase.com/guides/authentication)
- Build-step rung: Sentry/Fullstory annotation plugins; Pendo custom attributes "work with your development team". [doc] — [Sentry](https://blog.sentry.io/improving-developer-experience-from-unreadable-css-selectors-to-clear-component-names/); [Pendo](https://support.pendo.io/hc/en-us/articles/20116813908763)
- Registered-actions rung: Intercom data connectors (four setup phases), Command AI actions, CopilotKit hooks. [doc] (snippet) — [Intercom](https://www.intercom.com/help/en/articles/9916497-how-to-set-up-data-connectors-for-fin); [Command AI](https://command.ai/docs/platform/building-blocks/actions/)

### Inferences

| Rung | Customer does | Who at the customer | What it buys | What it does not buy |
|---|---|---|---|---|
| 0 | Enters domain / help-center URL, uploads docs | Anyone | Intent vocabulary, prose routes, product naming | Any logged-in screen |
| 1 | Installs a Chrome extension and opens their app | Admin, PM, support lead | Product running on their real logged-in app; screens and transitions captured as they click; no credentials, no CSP change | Reaching end users; anything the admin did not visit |
| 2 | Records the top N workflows (via rung 1 or author mode) | Support or product person | High-precision routes for the highest-volume questions | Long tail |
| 3 | Adds one script tag + CSP entries + allowed origins; passes security review | Developer + security | End-user reach; live DOM correctness; passive learning across all roles and tenants; per-step cache | Stable identifiers; pre-launch coverage of rarely used screens |
| 4 | Provides staging URL + test account, handles 2FA/SSO, lists "do not touch" areas | Engineer or IT + security | Pre-launch broad map without waiting for traffic; regression re-crawls | Other roles/tenants; data-dependent states; safety on production |
| 5 | Adds stable attributes or a build plugin; code review and release | Front-end team | Durable element identifiers; route manifest; caches survive redesigns | Behaviour/usage knowledge |
| 6 | Grants repo access or registers actions / WebMCP tools | Engineering + security | Deep structural knowledge; executable actions | Speed of onboarding; requires ongoing maintenance |

### Gaps
- Time-to-complete for each rung is not published by any vendor in a comparable form (QA Wolf's 5/15/20-day timeline is the only concrete one, and it is for a managed service).

---

## 12. Which approach lets a prospect see the product working on their own app before any developer installs anything?

### Takeaway
A browser extension that injects the widget into the prospect's own signed-in tab is the established answer in adjacent products and is the only approach found that needs no credentials, no developer and no CSP change. Its ceiling is enterprise extension policy and Chrome Web Store review.

### Cited Findings
- Userflow: preview "directly in your app before installing the Userflow JavaScript snippet". [doc] — [Userflow](https://help.userflow.com/docs/userflow-chrome-extension)
- Fullstory: preview "on any website" "without modifying your site's code" (Chrome and Edge). [doc] — [Fullstory](https://help.fullstory.com/hc/en-us/articles/37802698713367)
- Product Fruits: "full functionality with the exception of segmentation". [vendor] (snippet) — [Chrome Web Store](https://chrome.google.com/webstore/detail/product-fruits-editor/blfcndbglccbobmkepikmbmobcehhkkf)
- Constraints: Manifest V3 bans remotely hosted logic; broad host permissions bring extra review; admins can block or allow-list extensions through `ExtensionSettings`. [doc] (snippet) — [Chrome: improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security); [Google admin help](https://support.google.com/chrome/a/answer/6177431)
- The alternative that also needs no developer is cloud exploration with shared test credentials (QA.tech, Octomind), which moves the trust cost to credential sharing. [doc] (snippet) — [QA.tech](https://docs.qa.tech/core-concepts/knowledge); [Octomind](https://octomind.dev/docs/first-steps)

### Inferences
- The extension trial has a second payoff: the prospect's own clicking during the trial is first-party capture that pre-seeds the site map, so the product is already "warm" when the script tag lands.
- A sensible fallback for prospects who cannot install extensions is a vendor-run demo in a cloud browser using a test account the prospect logs into themselves through a live view (Browserbase's "log in manually once" pattern), so the vendor never holds the password.
- A dev-mode flag on the snippet (only renders for a given user or query parameter) is a low-risk first production step after the extension, but it still requires the developer and the CSP change, so it does not answer this question.

### Gaps
- No evidence on how many B2B buyers are blocked from installing extensions, or on Safari/Firefox demand for the trial.

---

## 13. Which combinations are complementary?

### Takeaway
The approaches divide cleanly by job: live DOM reading for correctness, help content for intent, recordings and passive transitions for routes and speed, build-time attributes for durability. The robust architecture treats every stored artefact as a hint that is validated against the live DOM, exactly as browser-automation caches do.

### Cited Findings
- Replay-then-fallback is the published pattern: Stagehand replays the cached selector and "falls back to full inference" if it no longer resolves. [doc] — [Stagehand caching](https://docs.stagehand.dev/v4/best-practices/caching)
- QA.tech combines crawl-built graph, continuous updates from PRs and prior knowledge from similar products. [vendor] (snippet) — [QA.tech blog](https://qa.tech/blog/knowledge-graphs-for-ai-agents)
- Pendo combines retroactive capture, AI-suggested tags from in-session DOM capture, and developer-supplied attributes for stability. [doc] — [Pendo AI tagging](https://support.pendo.io/hc/en-us/articles/52003588343963); [Pendo custom attributes](https://support.pendo.io/hc/en-us/articles/20116813908763)
- Small knowledge bases belong in a cached prompt rather than behind retrieval. [doc] — [Anthropic: contextual retrieval](https://www.anthropic.com/news/contextual-retrieval)
- Next-step prediction is right about half the time in published agent settings, enough to hide latency behind user think time. [doc] (snippet) — [arXiv 2510.04371](https://arxiv.org/abs/2510.04371)

### Inferences
- Recommended stack, in order of adoption: (1) live DOM each step (already built) as ground truth; (2) help docs and customer notes in a cached system prompt for intent; (3) extension capture during the trial to seed screens and routes; (4) recorded top-N flows as verified routes; (5) after install, a structure-only transition log that learns routes per customer, feeds an exact-key (goal cluster, screen) → element cache and drives speculative precomputation; (6) optional stable attributes for customers who want durability; (7) opportunistic use of WebMCP tools, `data-testid` or OpenAPI where they already exist.
- Authenticated cloud exploration is best positioned as an optional pre-launch accelerator and a regression check ("did the billing route change?") for customers with a staging environment, not as the default.
- Things that do not combine well: semantic-similarity caching on free text without live validation (false positives would point users at the wrong control); stored CSS selectors as the primary identifier in a React app with hashed class names.

### Gaps
- No public example of a guidance product running this full combination; the design is assembled from adjacent categories.

---

## 14. What are the deal-breaking risks of each approach, and how do they compare overall?

### Takeaway
Each approach has one risk that can end a deal: shared credentials and destructive clicks for cloud exploration, low reach and IT blocks for extensions, staleness for recordings, consent law for passive capture, engineering time and repo sensitivity for code integration, immaturity for WebMCP, and blindness to the logged-in UI for content ingestion. The comparison table below summarises all nine approaches.

### Cited Findings
- Cloud exploration: 2FA "usually require[s] human intervention"; SSO logins may be blocked by identity providers; QA Wolf relies on the customer to point out "anything to avoid"; QA.tech's crawling docs carry no destructive-action guidance; agent prompt-injection success was 11.2% with mitigations in Anthropic's August 2025 pilot. [doc] — [Browserbase](https://docs.browserbase.com/guides/authentication); [Momentic](https://momentic.ai/docs/guides/auth/overview); [QA Wolf](https://docs.qawolf.com/qawolf/Full-Service-The-First-Three-Months); [QA.tech](https://docs.qa.tech/core-concepts/crawling); [Anthropic](https://www.anthropic.com/news/claude-for-chrome)
- Extension: admin policy can block all but allow-listed extensions; remote logic is prohibited. [doc] (snippet) — [Google admin help](https://support.google.com/chrome/a/answer/6177431); [Chrome MV3 security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
- Recordings and selectors: flagged tags "are more likely to break when your application's code changes". [doc] — [Pendo AI tagging](https://support.pendo.io/hc/en-us/articles/52003588343963)
- Passive capture: CNIL treats session-replay purposes as subject to prior consent; US CIPA suits target replay. [doc]/[3p] (snippet) — [CNIL](https://www.cnil.fr/en/session-replay-cnil-launches-public-consultation-its-draft-recommendation); [FlexyConsent](https://flexyconsent.com/blog/session-replay-heatmap-tools-consent-guide/)
- Code integration: source code is among the most sensitive assets; annotation plugins are React-only. [3p]/[doc] (snippet) — [Rewind](https://rewind.com/blog/top-github-compliance-concerns/); [Sentry plugin](https://socket.dev/npm/package/@sentry/babel-plugin-component-annotate)
- WebMCP: origin trial, API namespace changed in July 2026, "close to zero deployment on real websites" as of July 2026. [doc]/[3p] — [Chrome](https://developer.chrome.com/docs/ai/webmcp); [Spronta](https://www.spronta.com/blog/state-of-webmcp-july-2026/)
- Content ingestion: cannot import content behind a login. [doc] (snippet) — [Intercom](https://www.intercom.com/help/en/articles/9357945-syncing-and-managing-public-urls)
- Any snippet: CSP changes and buyer privacy questions including AI training on customer data. [doc]/[3p] — [Pendo CSP](https://support.pendo.io/hc/en-us/articles/360032209131); [Vanta](https://www.vanta.com/resources/privacy-questions-enterprise-security-reviews)

### Inferences

Comparison table (cells are my synthesis of the cited findings in sections 1–9; "IDs" means stable element identifiers; "routes" means known paths to a goal).

| # | Approach | Maturity / adoption (Nov 2026) | Logged-in coverage | Stable IDs | Routes to goal | Latency / cost effect | Security / privacy exposure | Customer must do or grant at onboarding | Deal-breaking risk |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Authenticated cloud exploration | Mature in AI QA (QA.tech, Octomind, Momentic, QA Wolf); tooling mature (Browserbase/Stagehand, Browser Use, Skyvern, Playwright) | Broad for one role/tenant; misses data- and permission-gated states | No (derived from DOM) | Partial (graph of pages/actions; goals inferred) | Pre-computed map enables caching before launch; crawl cost is vendor-side | Vendor holds credentials or session; agent acts on customer system | Staging/prod URL, test account, 2FA/SSO workaround, possible bot/IP allow-list, "do not touch" list | Credential custody; destructive clicks; SSO/2FA blocks; prompt injection |
| 2 | Extension in admin's own session | Established as preview/authoring channel in DAPs (Userflow, Fullstory, Usetiful, Product Fruits, HelpHero; Pendo AI tagging) | What the admin visits, with real data and permissions | No | Yes for flows the admin walks | Seeds caches before install | Low: no credentials shared; DOM leaves admin's browser after client-side masking | Install extension, grant site access, click around | Extension blocked by IT; MV3 no remote code; only the installer sees it |
| 3 | Record-by-demonstration | Mature (Tango, Scribe, Supademo, DAP builders); AI re-grounding emerging | Exactly N recorded flows | No (selector/anchor) unless paired with #5 | Yes, high precision | Recorded route can skip planning; needs live validation | Low to medium (screenshots/HTML copies may contain data) | Minutes per flow from support/product staff; a capture surface (#2 or #3-rung snippet) | Staleness when UI changes; long tail uncovered |
| 4 | Passive learning after install | Capture mechanics mature (Heap, PostHog, Pendo, rrweb); no guidance product found documenting it | Highest over time (all roles/tenants/states); cold start | No | Yes (most-used paths; labelled when guided) | Largest: enables LLM-free cache hits and speculation | Medium to high: consent law for replay-like capture; labels may hold personal data | Script tag, CSP, consent/privacy decision, security review | GDPR/ePrivacy consent, CIPA exposure, enterprise objection to behavioural capture |
| 5 | Source code / build-time | Mature technique (Sentry, Fullstory plugins; test-id conventions); React-centric | Complete inventory of routes/components; no runtime state | Yes (best of all) | No | Makes caches and recordings durable | Build plugin: low. Repo read: high | Add attributes or plugin, code review, release; or grant repo access | Engineering time; repo access refused; framework lock-in |
| 6 | Declarative exposure (WebMCP, llms.txt, registered actions) | WebMCP in Chrome/Edge origin trial, API still changing; llms.txt on ~9% of top sites and rarely fetched; registered actions mature inside incumbents | Only what is declared | Yes for declared tools | Only if authored | Tool calls can replace multi-step guidance where they exist | Low (customer controls exposure) | Developer designs, registers and maintains tools/actions | Immature standard; real engineering per customer |
| 7 | Help-content ingestion | Universal baseline for AI support vendors | None behind login | No | Prose routes only, often stale | Fits in cached prompt; cheap | Low (public content); tickets raise personal-data issues | Give URL or upload docs; optionally export tickets | Does not know the UI; staleness |
| 8 | Latency engineering (no site knowledge) | Prompt caching, streaming tool input, small models all generally available; Chrome built-in AI desktop-only | n/a | n/a | n/a | Cache read 2.5–10% of input price; non-reasoning small-model TTFT about 0.6–1.2 s vs seconds for reasoning modes | Model provider as subprocessor | Nothing | Accuracy loss if the model is too small for grounding (unmeasured) |
| 9 | Script-security package | Standard across Pendo, Fullstory, Intercom, PostHog | n/a | n/a | n/a | First-party proxy can improve reliability | This is the mitigation layer | CSP entries, allowed origins, review of SOC 2/DPA/data flow | Missing SOC 2/DPA or `unsafe-eval` needs can stall the deal |

### Gaps
- No quantified failure rates for any risk except the August 2025 prompt-injection figures; all other risk rankings are qualitative.
- Items not sourced because the search budget ran out are listed in sections 2, 4, 5, 6 and 9 and should be treated as open.
