import Link from "next/link";
import { Arrow, Check, Pointer, Wordmark } from "./primitives";

export function Nav() {
  return (
    <>
      <div className="bg-ink px-4 py-2.5 text-center text-[13px] font-medium text-white">
        Haptic now learns your app from real traffic.{" "}
        <Link href="/docs#knowledge" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
          See how <Arrow className="size-3" />
        </Link>
      </div>
      <header className="sticky top-3 z-50 px-4">
        <nav className="mx-auto mt-3 flex h-[60px] max-w-[880px] items-center justify-between rounded-2xl border border-line bg-white/95 pr-2 pl-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-md">
          <Link href="/" aria-label="Haptic home">
            <Wordmark />
          </Link>
          <div className="hidden items-center gap-7 text-[14px] font-medium text-ink/75 md:flex">
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <a href="#install" className="hover:text-ink">
              Install
            </a>
            <a href="#privacy" className="hover:text-ink">
              Privacy
            </a>
            <Link href="/docs" className="hover:text-ink">
              Docs
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden h-10 items-center px-3 text-[14px] font-medium text-ink/75 hover:text-ink sm:inline-flex">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-dark h-11! rounded-xl! px-4! text-[14px]!">
              Start free
            </Link>
          </div>
        </nav>
      </header>
    </>
  );
}

const QUESTIONS = "where do I create an API key? · how do I invite my team? · where did billing go? · can I export this? · how do I turn on two-factor? · ";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-20 pb-10 sm:pt-28">
      {/* A slow circle of the questions people ask. */}
      <svg viewBox="0 0 300 300" className="orbit pointer-events-none absolute top-24 -left-24 hidden size-[300px] text-ink/45 lg:block xl:left-[4%]" aria-hidden="true">
        <defs>
          <path id="orbit-path" d="M150,150 m-118,0 a118,118 0 1,1 236,0 a118,118 0 1,1 -236,0" />
        </defs>
        <text className="text-[15px]" fill="currentColor" style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}>
          <textPath href="#orbit-path">{QUESTIONS}</textPath>
        </text>
      </svg>

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <p className="eyebrow mb-6 text-ink-muted">Haptic for web apps</p>
        <h1 className="display text-[64px] sm:text-[96px] lg:text-[112px]">
          Don’t explain,
          <br />
          <em>just point.</em>
        </h1>
        <p className="mx-auto mt-8 max-w-[30rem] text-[19px] leading-[1.35] font-medium sm:text-[21px]">The AI guide that shows your users where to click, in any web app.</p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="btn btn-dark w-full max-w-[240px] sm:w-auto">
            <Pointer on="dark" size={16} />
            Start free
          </Link>
          <a href="#how" className="btn btn-outline w-full max-w-[240px] border-ink/15! bg-white sm:w-auto">
            See it work
          </a>
        </div>
        <p className="mt-5 text-[13px] text-ink-muted">One script tag. Works with React, Next.js, Vue and plain HTML.</p>
      </div>

      <HeroRibbon />
    </section>
  );
}

const RAW = [
  "ok so where do I even make an api key",
  "i've looked under profile and account already",
  "is it in settings somewhere?",
  "need it for the staging deploy today",
];
const STEPS = ["Settings", "Organization", "Developer", "Create key"];

function HeroRibbon() {
  const raw = RAW.join("  ·  ");
  return (
    <div className="relative mt-24 mb-6 sm:mt-28" aria-hidden="true">
      <div className="ribbon">
        {/* What Haptic just did, cycling. */}
        <div className="chip-cycle absolute -top-14 left-1/2 grid -translate-x-1/2 text-[13px] font-semibold">
          {["Pointed at Settings", "Waited for your click", "Followed you to Developer"].map((label) => (
            <span key={label} className="inline-flex items-center gap-1.5 justify-self-center rounded-full bg-ink px-3.5 py-1.5 whitespace-nowrap text-white shadow-lg">
              <Check />
              {label}
            </span>
          ))}
        </div>

        <div className="flex items-center">
          <div className="ribbon-half flex-1 py-3 text-[17px] font-medium text-ink/35 sm:text-[19px]">
            <div className="ribbon-track">
              <span>{raw}</span>
              <span>{raw}</span>
            </div>
          </div>

          <div className="relative z-10 mx-[-2px] flex h-[62px] shrink-0 items-center gap-2.5 rounded-full border-[1.5px] border-ink bg-white px-5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
            <Pointer size={22} />
            <span className="text-[17px] font-semibold tracking-tight">Haptic</span>
          </div>

          <div className="ribbon-half flex-1 bg-ink py-4 text-[17px] font-semibold text-white sm:text-[19px]">
            <div className="ribbon-track" style={{ animationDuration: "26s" }}>
              {[0, 1].map((copy) => (
                <span key={copy} className="inline-flex items-center gap-4">
                  {STEPS.map((step, i) => (
                    <span key={step} className="inline-flex items-center gap-4">
                      <span className="inline-flex items-center gap-2">
                        <Pointer on="dark" size={16} />
                        {step}
                      </span>
                      {i < STEPS.length - 1 && <span className="text-white/40">›</span>}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-2 pr-12 pl-4 text-white/60">
                    <Check /> Key created
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
