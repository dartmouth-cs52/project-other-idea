import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";

export const metadata = { title: "Docs" };

const HOST = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000").replace(/\/$/, "");

function Code({ children }: { children: string }) {
  return <pre className="my-3 overflow-x-auto rounded-lg bg-ink p-4 font-mono text-[13px] leading-relaxed text-white">{children}</pre>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-8 pb-4">
      <h2 className="mb-3 font-display font-normal tracking-[-0.02em] text-[30px] leading-tight">{title}</h2>
      <div className="space-y-3 text-ink">{children}</div>
    </section>
  );
}

const TOC = [
  ["install", "Install"],
  ["frameworks", "Frameworks"],
  ["origins", "Allowed origins"],
  ["appearance", "Appearance"],
  ["api", "JavaScript API"],
  ["attributes", "HTML attributes"],
  ["knowledge", "Teaching Haptic your app"],
  ["csp", "Content Security Policy"],
  ["privacy", "What Haptic sends"],
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/">
            <Logo />
          </Link>
          <Link href="/dashboard" className="text-ink-muted hover:text-ink">
            Dashboard
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-10 md:grid-cols-[180px_1fr]">
        <nav className="hidden md:block">
          <ul className="sticky top-24 space-y-2 text-ink-muted">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="max-w-2xl">
          <h1 className="mb-2 font-display font-normal tracking-[-0.02em] text-[48px] leading-none">Haptic docs</h1>
          <p className="mb-6 text-ink-muted">Haptic adds a guide to your web app. Your users ask how to do something and a pointer walks them through it, one click at a time.</p>

          <Section id="install" title="Install">
            <p>Create a site in the dashboard, then add its script tag to every page of your app, just before the closing body tag:</p>
            <Code>{`<script src="${HOST}/sdk/haptic.js" data-key="pk_live_..." async></script>`}</Code>
            <p>The script loads asynchronously, does nothing heavy until someone opens Haptic, and adds one element to your page. When your app loads with the key, the site in your dashboard changes to Installed.</p>
          </Section>

          <Section id="frameworks" title="Frameworks">
            <p>
              <strong>Next.js.</strong> Use <code>next/script</code> in your root layout so it loads on every route:
            </p>
            <Code>{`import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="${HOST}/sdk/haptic.js" data-key="pk_live_..." strategy="afterInteractive" />
      </body>
    </html>
  );
}`}</Code>
            <p>
              <strong>React, Vue, Svelte and other single-page apps.</strong> Put the tag in your <code>index.html</code>. Haptic follows route changes on its own, including ones made with <code>history.pushState</code>.
            </p>
          </Section>

          <Section id="origins" title="Allowed origins">
            <p>
              The key in the snippet is public. What stops someone else from using it is the list of allowed origins on the site&apos;s Install tab. Haptic only starts on pages served from those origins. Add each one with its scheme and host, like <code>https://app.acme.com</code>, plus <code>http://localhost:3000</code> for development. <code>https://*.acme.com</code> covers every subdomain.
            </p>
          </Section>

          <Section id="appearance" title="Appearance and placement">
            <p>
              Use the site&apos;s Appearance settings to choose the launcher color, label, style, position, screen margins and Ask bar width. The launcher and Ask bar can use different positions. Changes reach the SDK through its normal session request, so the install tag stays the same.
            </p>
            <p>
              The default is a labeled pill at the bottom right. Six positions are available, including bottom center for apps that already have a support widget in a corner. Select Hidden to use a button in your own navigation, then call <code>Haptic.open()</code> when that button is clicked.
            </p>
          </Section>

          <Section id="api" title="JavaScript API">
            <p>
              Once loaded, Haptic is available as <code>window.Haptic</code>:
            </p>
            <Code>{`Haptic.open();                       // show the Ask bar
Haptic.ask("How do I add a teammate?"); // start a guide
Haptic.stop();                       // stop the current guide
Haptic.setContext({ role: "admin", plan: "growth" }); // facts about the user
const off = Haptic.on("done", ({ goal, steps }) => analytics.track("guide_done", { goal, steps }));`}</Code>
            <p>
              <code>setContext</code> helps Haptic tailor answers, for example to say a page is admin-only. Events: <code>open</code>, <code>close</code>, <code>step</code>, <code>done</code>, <code>stop</code>, <code>error</code>. To open Haptic from your own help button, set the launcher to Hidden under Appearance and call <code>Haptic.open()</code>.
            </p>
            <p>
              Visitors who find the launcher in the way can hide it with the small × that appears when they hover over it. It shrinks to a dot in the same corner, and one click on the dot brings it back. Haptic remembers the choice for that visitor. <code>Haptic.open()</code> and your shortcut still work while it&apos;s a dot.
            </p>
          </Section>

          <Section id="attributes" title="HTML attributes">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <code>data-haptic-ignore</code> keeps an element and everything inside it out of what Haptic sees. Use it for areas with sensitive content.
              </li>
              <li>
                <code>data-haptic-label=&quot;Create API key&quot;</code> names an element that has no readable label, like an icon button.
              </li>
              <li>
                <code>data-haptic-id=&quot;create-key&quot;</code> gives an element a stable name that shows up in Haptic&apos;s view of the page.
              </li>
              <li>
                <code>data-shortcut=&quot;Alt+H&quot;</code> on the script tag adds a keyboard shortcut that opens the Ask bar. <code>Mod</code> means Cmd on Mac and Ctrl elsewhere.
              </li>
            </ul>
          </Section>

          <Section id="knowledge" title="Teaching Haptic your app">
            <p>Haptic reads the page your user is on: its buttons, links, headings and short text. Two things help it with the rest of your app:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Learned pages.</strong> As people use your app, Haptic records an outline of each page and which button led to which page. A label is only used after several different people have seen it, so one person&apos;s own content never is. Review or hide labels on the Knowledge tab.
              </li>
              <li>
                <strong>Notes.</strong> A few sentences about where things live, such as &quot;API keys are under Settings, Organization, Developer. Only admins see that page.&quot;
              </li>
            </ul>
            <p>Accessible markup helps too. Buttons with an aria-label or visible text are easier to point at than bare icons.</p>
          </Section>

          <Section id="csp" title="Content Security Policy">
            <p>If your app sets a Content-Security-Policy header, allow Haptic&apos;s script and API:</p>
            <Code>{`script-src  ${HOST}
connect-src ${HOST}`}</Code>
          </Section>

          <Section id="privacy" title="What Haptic sends">
            <ul className="list-disc space-y-2 pl-5">
              <li>Labels of buttons, links and form fields, headings, and short visible text from the current page, with emails and long numbers masked.</li>
              <li>Never the values typed into fields, never password fields, never table cells, never anything under data-haptic-ignore.</li>
              <li>The user&apos;s question, which appears in your dashboard&apos;s Activity list.</li>
              <li>
                A random ID that Haptic keeps in your site&apos;s localStorage under <code>haptic.v1.visitor</code>. Haptic only stores a hash of it, to count how many different people saw a label. It isn&apos;t linked to your users&apos; accounts.
              </li>
            </ul>
          </Section>
        </article>
      </div>
    </div>
  );
}
