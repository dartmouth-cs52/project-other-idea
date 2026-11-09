import Link from "next/link";
import { Heading, Pointer } from "./primitives";
import { InstallTabs } from "./InstallTabs";

const QUESTIONS: [string, string[]][] = [
  ["Where do I create an API key?", ["Settings", "Developer", "Create key"]],
  ["How do I invite my team?", ["Members", "More", "Invite member"]],
  ["Can I export this as CSV?", ["Export", "CSV"]],
  ["Where did billing go?", ["Account", "Billing"]],
  ["How do I turn on two-factor?", ["Profile", "Security", "Enable"]],
  ["How do I cancel my plan?", ["Account", "Manage plan", "Cancel"]],
  ["Where are last month's invoices?", ["Billing", "Invoices"]],
  ["How do I share this dashboard?", ["Share", "Anyone with the link"]],
  ["Can I change my workspace name?", ["Settings", "General"]],
  ["How do I connect Slack?", ["Integrations", "Slack", "Connect"]],
];

const STATS = [
  ["<1s", "from question to the first point"],
  ["1 line", "to install, in any web app"],
  ["0 tours", "to build, record or maintain"],
  ["36KB", "gzipped, loaded after your page"],
];

export function Questions() {
  const rows = [QUESTIONS.slice(0, 5), QUESTIONS.slice(5)];
  return (
    <section className="bg-ink py-24 text-white sm:py-32">
      <div className="px-4">
        <Heading tone="dark" eyebrow="From the first day" sub="The questions your support team answers every week, answered inside your product, on the page where people get stuck.">
          Questions it <em>answers.</em>
        </Heading>
      </div>

      <div className="mt-16 space-y-4">
        {rows.map((row, r) => (
          <div key={r} className="marquee">
            <div className={`marquee-track slow ${r === 1 ? "reverse" : ""}`}>
              {[0, 1].map((copy) => (
                <div key={copy} className="flex gap-4 pr-4" aria-hidden={copy === 1}>
                  {row.map(([question, path]) => (
                    <figure key={question} className="flex w-[320px] shrink-0 flex-col justify-between rounded-[28px] border border-white/10 bg-white/[0.04] p-7 sm:w-[380px]">
                      <blockquote className="display text-[30px] leading-[1.05]">&ldquo;{question}&rdquo;</blockquote>
                      <figcaption className="mt-8 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-white/70">
                        {path.map((step, i) => (
                          <span key={step} className="inline-flex items-center gap-2">
                            {i === path.length - 1 ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-ink">
                                <Pointer size={13} />
                                {step}
                              </span>
                            ) : (
                              step
                            )}
                            {i < path.length - 1 && <span className="text-white/35">›</span>}
                          </span>
                        ))}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-20 grid max-w-6xl gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map(([value, label]) => (
          <div key={value} className="reveal rounded-[28px] border border-white/10 p-7">
            <p className="display text-[56px]">{value}</p>
            <p className="mt-3 text-[15px] text-white/60">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Install() {
  return (
    <section id="install" className="scroll-mt-24 px-4 py-12">
      <div className="reveal mx-auto max-w-6xl rounded-[32px] bg-canvas px-6 py-16 sm:px-14 sm:py-20">
        <Heading eyebrow="Install" sub="Add the script, list the domains it may run on, and you’re live. Haptic follows route changes on its own, in single-page apps and classic ones.">
          Paste one line. <em>That’s the setup.</em>
        </Heading>
        <div className="mx-auto mt-12 max-w-3xl">
          <InstallTabs />
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-[13px] font-semibold">
            {["Chrome", "Safari", "Firefox", "Single-page apps", "Full page loads", "Shadow DOM", "Modal dialogs"].map((item) => (
              <span key={item} className="rounded-full border border-line bg-white px-3.5 py-1.5">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ["Does Haptic work with my framework?", "Yes. It's one script tag that reads the page in the browser, so it works with React, Next.js, Vue, Svelte, Angular, server-rendered apps and plain HTML. It follows route changes on its own."],
  ["Does it take screenshots?", "No. Haptic reads the page's elements and their labels, then points at the exact element. That's faster than sending an image, and it can't miss by a few pixels."],
  ["What does Haptic send to its servers?", "Labels of buttons, links and fields, headings, and short visible text, with emails and long numbers masked. Never what people type, never password fields, never table cells, and nothing inside elements marked data-haptic-ignore."],
  ["What if it can't find something?", "It says so plainly and tells the user where it looked. A confident wrong step costs more than an honest \"I don't see that here.\""],
  ["How does it know about pages the user isn't on?", "As people use your app, Haptic learns an outline of each page and which buttons lead where. A label is only used once several different people have seen it. You can also add notes about your product in the dashboard."],
  ["Can it click things for my users?", "Not yet. Haptic points and explains, and the user stays in control. Acting on the user's behalf will come later, only with their say-so."],
  ["Will it slow down or restyle my site?", "No. The script loads asynchronously, adds one element to the page, and keeps its styles inside a shadow root, so your CSS and ours never touch."],
];

export function Faq() {
  return (
    <section className="px-4 py-24 sm:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1fr_1.4fr]">
        <div className="reveal md:sticky md:top-32 md:self-start">
          <p className="eyebrow mb-5 text-ink-muted">FAQ</p>
          <h2 className="display text-[44px] sm:text-[64px]">
            Good <em>questions.</em>
          </h2>
          <p className="mt-6 max-w-xs text-[17px] text-ink-muted">
            Anything else is in the{" "}
            <Link href="/docs" className="font-semibold text-ink underline underline-offset-4">
              docs
            </Link>
            .
          </p>
        </div>
        <div className="reveal divide-y divide-line rounded-[32px] border border-line bg-white px-6 sm:px-8">
          {FAQ.map(([question, answer]) => (
            <details key={question} className="faq group py-6">
              <summary className="flex cursor-pointer items-center justify-between gap-6 text-[17px] font-semibold">
                {question}
                <span className="plus flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-[18px] leading-none">+</span>
              </summary>
              <p className="mt-3 max-w-xl pr-10 text-[16px] text-ink-muted">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="px-4 pb-12">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[40px] bg-ink px-6 py-24 text-center text-white sm:py-32">
        <div className="pointer-events-none absolute -top-48 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-white/[0.08] blur-3xl" />
        <div className="relative">
          <h2 className="display mx-auto max-w-5xl text-[52px] sm:text-[88px]">
            Your users have questions.
            <br />
            <em>Now they have a guide.</em>
          </h2>
          <p className="mx-auto mt-7 max-w-md text-[18px] font-medium text-white/65">Start free, paste one line, and watch the first question get answered with a point.</p>
          <div className="relative mt-10 inline-flex">
            <Link href="/signup" className="btn btn-light h-14! px-7! text-[16px]!">
              Start free
            </Link>
            <Pointer on="dark" size={28} className="absolute -right-5 -bottom-5" />
          </div>
        </div>
      </div>
    </section>
  );
}

const FOOTER: [string, [string, string][]][] = [
  ["Product", [["How it works", "/#how"], ["Install", "/#install"], ["Privacy", "/#privacy"], ["Start free", "/signup"]]],
  ["Developers", [["Docs", "/docs"], ["JavaScript API", "/docs#api"], ["HTML attributes", "/docs#attributes"], ["Content Security Policy", "/docs#csp"]]],
  ["Account", [["Sign in", "/login"], ["Dashboard", "/dashboard"], ["Billing", "/dashboard/billing"]]],
];

export function Footer() {
  return (
    <footer className="overflow-hidden px-4 pt-16">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 sm:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <p className="col-span-2 max-w-xs text-[15px] text-ink-muted sm:col-span-1">An AI guide for web apps. Your users ask, and Haptic shows them where to click.</p>
        {FOOTER.map(([title, links]) => (
          <div key={title}>
            <p className="mb-4 text-[13px] font-semibold">{title}</p>
            <ul className="space-y-2.5 text-[14px] text-ink-muted">
              {links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="hover:text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-16 flex max-w-6xl flex-wrap justify-between gap-2 border-t border-line pt-6 text-[13px] text-ink-muted">
        <span>© 2026 Haptic Labs</span>
        <span>Made for people halfway through a task.</span>
      </div>
      {/* The wordmark runs off the bottom of the page, like a signature. */}
      <div className="relative mx-auto mt-6 h-[0.86em] max-w-6xl overflow-hidden text-[min(36vw,460px)] leading-none" aria-hidden="true">
        <span className="display block leading-[0.9] tracking-[-0.055em]">Haptic</span>
        <Pointer size={96} className="absolute top-[6%] right-[1%] hidden size-[0.2em] sm:block" />
      </div>
    </footer>
  );
}
