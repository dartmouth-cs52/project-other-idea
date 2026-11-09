import type { CSSProperties } from "react";
import { Check, Heading, Pointer } from "./primitives";

const STACKS = ["React", "Next.js", "Vue", "Svelte", "Angular", "Remix", "Astro", "Rails", "Django", "Laravel", "Phoenix", "Plain HTML"];

export function StackBand() {
  return (
    <section className="bg-ink py-16 text-white sm:py-20">
      <p className="eyebrow mb-10 text-center text-white/55">Works with the stack you already have</p>
      <div className="marquee">
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
              {STACKS.map((name) => (
                <span key={name} className="flex items-center gap-14 pr-14">
                  <span className="display text-[40px] whitespace-nowrap text-white/90 sm:text-[52px]">{name}</span>
                  <Pointer on="dark" size={14} className="opacity-40" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const ARTICLE = [
  "To create an API key, first make sure you have the Admin or Owner role in your organization. Members can't see the Developer section.",
  "1. Open Settings from the icon in the lower left of the sidebar. If your sidebar is collapsed, hover over it to expand it.",
  "2. Choose Organization. If you belong to more than one organization, check the switcher at the top first.",
  "3. Select the Developer tab. On smaller screens it may be inside the More menu.",
  "4. Click Create key, give it a name, and choose its scopes.",
  "5. Copy the key right away. For security it is only shown once.",
  "6. Store it somewhere safe, like your team's password manager.",
  "Still stuck? Contact support and include your organization ID, which you can find under Settings, General.",
];

export function ShowDontTell() {
  return (
    <section id="how" className="scroll-mt-24 px-4 py-24 sm:py-32">
      <Heading eyebrow="Why it works" sub="A help article makes people turn paragraphs into clicks. Haptic skips that step and points at the button.">
        Show, <em>don’t tell.</em>
      </Heading>

      <div className="reveal mx-auto mt-16 grid max-w-6xl gap-4 md:grid-cols-2">
        {/* The old way. */}
        <div className="relative flex h-[440px] flex-col overflow-hidden rounded-[32px] bg-canvas p-8 sm:p-10">
          <div className="flex items-baseline justify-between">
            <p className="text-[15px] font-semibold text-ink-muted">Help article</p>
            <p className="display text-[40px] text-ink/40">6 steps</p>
          </div>
          <div className="relative mt-6 flex-1 overflow-hidden [mask-image:linear-gradient(transparent,#000_20%,#000_70%,transparent)]">
            <div className="article-scroll space-y-4 font-display text-[19px] leading-snug text-ink/45 blur-[0.6px]">
              {[...ARTICLE, ...ARTICLE].map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        </div>

        {/* Haptic. */}
        <div className="relative flex h-[440px] flex-col overflow-hidden rounded-[32px] bg-ink p-8 text-white sm:p-10">
          <div className="flex items-baseline justify-between">
            <p className="text-[15px] font-semibold text-white/60">Haptic</p>
            <p className="display text-[40px]">
              &lt;1s <span className="text-[22px] text-white/50">to the first point</span>
            </p>
          </div>
          <div className="tell-stage relative mt-6 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[#141416]">
            <div className="flex h-9 items-center gap-1.5 border-b border-white/10 px-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-2 rounded-full bg-white/20" />
              ))}
              <span className="ml-3 h-4 w-40 rounded bg-white/8" />
            </div>
            <div className="flex h-[calc(100%-36px)]">
              <div className="w-[26%] space-y-2 border-r border-white/10 p-3">
                {["Overview", "Projects", "Usage", "Settings"].map((item) => (
                  <div key={item} className={`rounded-md px-2 py-1.5 text-[12px] ${item === "Settings" ? "bg-white/10 text-white" : "text-white/45"}`}>
                    {item}
                  </div>
                ))}
              </div>
              <div className="flex-1 p-4">
                <div className="mb-3 flex gap-4 border-b border-white/10 pb-2 text-[12px] text-white/45">
                  <span>General</span>
                  <span>Members</span>
                  <span className="text-white">Developer</span>
                </div>
                <div className="space-y-2">
                  {[70, 55, 62].map((w, i) => (
                    <div key={i} className="h-7 rounded-md bg-white/6" style={{ width: `${w}%` }} />
                  ))}
                </div>
                <div className="absolute top-[58%] right-[8%] rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-ink">Create key</div>
              </div>
            </div>
            {/* Ring, pointer and caption, looping. */}
            <div className="tell-ring absolute top-[58%] right-[8%] h-[34px] w-[86px] translate-x-[5px] translate-y-[-3px] rounded-[10px] border-2 border-white shadow-[0_0_0_1px_#0a0a0a,0_0_0_6px_rgba(255,255,255,0.12)]" />
            <div className="tell-pointer pointer-events-none absolute top-0 left-0" style={{ "--tx": "80cqw", "--ty": "64cqh" } as CSSProperties}>
              <Pointer on="dark" size={24} />
            </div>
            <div className="tell-caption absolute right-[6%] bottom-[7%] max-w-[230px] rounded-xl bg-white px-3.5 py-2.5 text-[13px] leading-snug text-ink shadow-xl">
              <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
                <span className="size-1.5 rounded-full bg-ink" /> Step 3
              </span>
              Click Create key to make a new API key.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    title: "Points at the real button",
    body: "Haptic reads the elements on the page, not a screenshot, so it lands on the exact control and scrolls to it when it's out of view.",
    visual: "snapshot",
  },
  {
    title: "Walks the whole path",
    body: "It waits for each click, then gives the next step, across menus, dialogs and full page loads, until the task is done.",
    visual: "path",
  },
  {
    title: "Learns your app from use",
    body: "Ask from any page. Haptic learns where things live from real traffic, and only keeps labels that many different people see.",
    visual: "map",
  },
  {
    title: "Fits any page",
    body: "Black and white by default. The pointer turns white on dark backgrounds and black on light ones. Or set your own accent color.",
    visual: "tone",
  },
] as const;

export function Features() {
  return (
    <section className="px-4 py-24 sm:py-32">
      <Heading eyebrow="What's inside" sub="No tours to build and no selectors to maintain. Paste the script and Haptic works on the page your user is looking at.">
        Everything a guide needs, <em>nothing it doesn’t.</em>
      </Heading>
      <div className="mx-auto mt-16 grid max-w-6xl gap-4 md:grid-cols-2">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="reveal flex flex-col overflow-hidden rounded-[32px] border border-line bg-white">
            <div className="h-[240px] border-b border-line bg-canvas">
              <FeatureVisual kind={feature.visual} />
            </div>
            <div className="p-8 sm:p-10">
              <h3 className="display text-[34px]">{feature.title}</h3>
              <p className="mt-3 max-w-md text-[16px] text-ink-muted">{feature.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FeatureVisual({ kind }: { kind: (typeof FEATURES)[number]["visual"] }) {
  if (kind === "snapshot") {
    return (
      <div className="relative flex h-full items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-1.5 font-mono text-[12px]">
          {[
            ['e11 link "Usage"', "→ /usage"],
            ['e12 tab "Developer"', "[Settings]"],
            ['e13 button "Create key"', "[API keys]"],
            ["e14 button icon:trash-2", "[API keys]"],
          ].map(([line, meta]) => (
            <div key={line} className={`flex justify-between rounded-lg px-3 py-2 ${line.startsWith("e13") ? "bg-ink text-white" : "bg-white text-ink/60"}`}>
              <span>{line}</span>
              <span className={line.startsWith("e13") ? "text-white/55" : "text-ink/35"}>{meta}</span>
            </div>
          ))}
        </div>
        <Pointer size={26} className="absolute top-[53%] left-[44%]" on="dark" />
      </div>
    );
  }
  if (kind === "path") {
    const steps: [string, string][] = [
      ["Settings", "/home"],
      ["Organization", "/settings"],
      ["Developer", "/settings/org"],
      ["Create key", "/settings/org/developer"],
    ];
    return (
      <div className="flex h-full items-center justify-center px-6">
        <ol className="relative w-full max-w-xs space-y-2.5">
          <span className="absolute top-4 bottom-4 left-[19px] w-px bg-ink/15" aria-hidden="true" />
          {steps.map(([step, path], i) => {
            const last = i === steps.length - 1;
            return (
              <li key={step} className={`relative flex items-center justify-between rounded-full py-1.5 pr-4 pl-1.5 text-[14px] font-semibold ${last ? "bg-ink text-white" : "border border-line bg-white"}`}>
                <span className="flex items-center gap-2.5">
                  <span className={`flex size-7 items-center justify-center rounded-full ${last ? "bg-white/15" : "bg-canvas"}`}>{last ? <Pointer on="dark" size={13} /> : <Check className="text-ink/45" />}</span>
                  {step}
                </span>
                <span className={`font-mono text-[11px] font-normal ${last ? "text-white/50" : "text-ink/35"}`}>{path}</span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }
  if (kind === "map") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 font-mono text-[12px] leading-relaxed text-ink/60 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <p className="mb-2 font-sans text-[11px] font-semibold tracking-[0.12em] text-ink/40 uppercase">Learned pages</p>
          <p>
            <span className="text-ink">/settings</span>: tabs General, Members, Developer
          </p>
          <p>
            <span className="text-ink">/billing</span>: buttons Manage plan, Download invoice
          </p>
          <p>
            <span className="text-ink">/projects/:id</span>: buttons Share, Export
          </p>
          <p className="text-ink/30 line-through">/projects/:id: heading &quot;Q3 launch plan&quot;</p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-2">
      <div className="relative flex items-center justify-center bg-white">
        <span className="rounded-lg border-2 border-ink px-4 py-2 text-[14px] font-semibold shadow-[0_0_0_1px_#fff,0_0_0_6px_rgba(10,10,10,0.08)]">Share</span>
        <Pointer size={26} className="absolute top-[52%] left-[58%]" />
      </div>
      <div className="relative flex items-center justify-center bg-ink">
        <span className="rounded-lg border-2 border-white px-4 py-2 text-[14px] font-semibold text-white shadow-[0_0_0_1px_#0a0a0a,0_0_0_6px_rgba(255,255,255,0.12)]">Share</span>
        <Pointer on="dark" size={26} className="absolute top-[52%] left-[58%]" />
      </div>
    </div>
  );
}

const PRIVACY = ["Never reads what people type", "Masks emails and long numbers", "Skips table data entirely", "Only learns labels many people see"];

export function Privacy() {
  return (
    <section id="privacy" className="scroll-mt-24 px-4 py-12">
      <div className="reveal mx-auto grid max-w-6xl items-center gap-10 rounded-[32px] bg-canvas p-8 sm:p-14 md:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="display text-[44px] sm:text-[56px]">
            Your users’ data <em>stays theirs.</em>
          </h2>
          <p className="mt-5 max-w-md text-[17px] text-ink-muted">Haptic sees labels, not content. Mark anything sensitive with one attribute and it&apos;s never read at all.</p>
          <a href="/docs#privacy" className="mt-7 inline-flex items-center gap-2 text-[15px] font-semibold underline-offset-4 hover:underline">
            What Haptic sends
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PRIVACY.map((item) => (
            <li key={item} className="flex items-start gap-3 rounded-2xl bg-white p-5 text-[15px] font-semibold">
              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                <Check className="size-3" />
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
