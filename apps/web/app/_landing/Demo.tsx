"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Pointer } from "./primitives";

// A scripted walkthrough of a made-up app, drawn the way Haptic draws on a
// real one: the question goes into the Ask bar, the pointer flies to each
// control, the caption explains it, and the screen changes as if clicked.

type IconName = "home" | "rocket" | "logs" | "chart" | "gear" | "users" | "group" | "audit" | "shield" | "bank" | "send" | "card" | "grid" | "file" | "bell" | "search" | "share" | "more" | "download" | "plus";

interface Action {
  id: string;
  label?: string;
  icon?: IconName;
  primary?: boolean;
}

interface Screen {
  path: string;
  nav: string;
  title: string;
  actions?: Action[];
  tabs?: string[];
  tab?: string;
  rows?: { label: string; meta: string; action?: Action }[];
  menu?: { anchor: string; items: { id: string; label: string; kind?: "toggle" | "button"; on?: boolean }[] };
  toast?: string;
}

interface Step {
  screen: Screen;
  /** data-target of the element to point at. Absent on the final step. */
  target?: string;
  caption: string;
}

interface Scenario {
  tab: string;
  app: string;
  domain: string;
  nav: { label: string; icon: IconName }[];
  question: string;
  steps: Step[];
}

const SCENARIOS: Scenario[] = [
  {
    tab: "Developer platform",
    app: "Acme Cloud",
    domain: "console.acme.dev",
    nav: [
      { label: "Overview", icon: "home" },
      { label: "Deployments", icon: "rocket" },
      { label: "Logs", icon: "logs" },
      { label: "Usage", icon: "chart" },
      { label: "Settings", icon: "gear" },
    ],
    question: "How do I create an API key?",
    steps: [
      {
        screen: {
          path: "/overview",
          nav: "Overview",
          title: "Overview",
          rows: [
            { label: "api-gateway", meta: "Deployed 4m ago" },
            { label: "billing-worker", meta: "Deployed 1h ago" },
            { label: "web", meta: "Deployed yesterday" },
          ],
        },
        target: "nav:Settings",
        caption: "Open Settings in the sidebar.",
      },
      {
        screen: {
          path: "/settings",
          nav: "Settings",
          title: "Settings",
          tabs: ["General", "Members", "Billing", "Developer"],
          tab: "General",
          rows: [
            { label: "Organization name", meta: "Acme" },
            { label: "Default region", meta: "us-east-1" },
            { label: "Time zone", meta: "UTC" },
          ],
        },
        target: "tab:Developer",
        caption: "Click the Developer tab.",
      },
      {
        screen: {
          path: "/settings/developer",
          nav: "Settings",
          title: "Settings",
          tabs: ["General", "Members", "Billing", "Developer"],
          tab: "Developer",
          actions: [{ id: "create", label: "Create key", primary: true }],
          rows: [
            { label: "Production", meta: "sk_live_••••4f2a" },
            { label: "Staging", meta: "sk_test_••••91cc" },
          ],
        },
        target: "action:create",
        caption: "Click Create key to make a new API key.",
      },
      {
        screen: {
          path: "/settings/developer",
          nav: "Settings",
          title: "Settings",
          tabs: ["General", "Members", "Billing", "Developer"],
          tab: "Developer",
          actions: [{ id: "create", label: "Create key", primary: true }],
          rows: [
            { label: "New key", meta: "sk_live_••••e7d0" },
            { label: "Production", meta: "sk_live_••••4f2a" },
            { label: "Staging", meta: "sk_test_••••91cc" },
          ],
          toast: "Key created",
        },
        caption: "Your key is ready. Copy it now, since it's only shown once.",
      },
    ],
  },
  {
    tab: "Admin console",
    app: "Northwind",
    domain: "admin.northwind.app",
    nav: [
      { label: "Dashboard", icon: "home" },
      { label: "Members", icon: "users" },
      { label: "Groups", icon: "group" },
      { label: "Audit log", icon: "audit" },
      { label: "Security", icon: "shield" },
    ],
    question: "How do I invite a teammate?",
    steps: [
      {
        screen: { path: "/dashboard", nav: "Dashboard", title: "Dashboard", rows: [{ label: "Active seats", meta: "42 of 50" }, { label: "Pending invites", meta: "3" }, { label: "SSO", meta: "Enabled" }] },
        target: "nav:Members",
        caption: "Open Members in the sidebar.",
      },
      {
        screen: {
          path: "/members",
          nav: "Members",
          title: "Members",
          actions: [{ id: "search", icon: "search" }, { id: "more", icon: "more" }],
          rows: [
            { label: "Avery Lin", meta: "Admin" },
            { label: "Jordan Pike", meta: "Member" },
            { label: "Sam Okafor", meta: "Member" },
          ],
        },
        target: "action:more",
        caption: "Open the more menu, the three dots at the top right.",
      },
      {
        screen: {
          path: "/members",
          nav: "Members",
          title: "Members",
          actions: [{ id: "search", icon: "search" }, { id: "more", icon: "more" }],
          rows: [
            { label: "Avery Lin", meta: "Admin" },
            { label: "Jordan Pike", meta: "Member" },
            { label: "Sam Okafor", meta: "Member" },
          ],
          menu: { anchor: "more", items: [{ id: "invite", label: "Invite member" }, { id: "import", label: "Import from CSV" }, { id: "export", label: "Export list" }] },
        },
        target: "menu:invite",
        caption: "Choose Invite member.",
      },
      {
        screen: {
          path: "/members/invite",
          nav: "Members",
          title: "Members",
          actions: [{ id: "search", icon: "search" }, { id: "more", icon: "more" }],
          rows: [
            { label: "Avery Lin", meta: "Admin" },
            { label: "Jordan Pike", meta: "Member" },
            { label: "Sam Okafor", meta: "Member" },
          ],
          toast: "Invite form open",
        },
        caption: "Type their email and press Send. They'll get the invite right away.",
      },
    ],
  },
  {
    tab: "Fintech",
    app: "Ledgerly",
    domain: "app.ledgerly.co",
    nav: [
      { label: "Home", icon: "home" },
      { label: "Accounts", icon: "bank" },
      { label: "Payments", icon: "send" },
      { label: "Cards", icon: "card" },
      { label: "Settings", icon: "gear" },
    ],
    question: "Where's last month's statement?",
    steps: [
      {
        screen: { path: "/home", nav: "Home", title: "Home", rows: [{ label: "Checking", meta: "•••• 2291" }, { label: "Savings", meta: "•••• 8034" }, { label: "Card spend", meta: "This month" }] },
        target: "nav:Accounts",
        caption: "Open Accounts in the sidebar.",
      },
      {
        screen: {
          path: "/accounts",
          nav: "Accounts",
          title: "Checking",
          tabs: ["Activity", "Statements", "Details"],
          tab: "Activity",
          rows: [
            { label: "Card payment", meta: "Oct 9" },
            { label: "Transfer in", meta: "Oct 8" },
            { label: "Payroll", meta: "Oct 1" },
          ],
        },
        target: "tab:Statements",
        caption: "Click the Statements tab.",
      },
      {
        screen: {
          path: "/accounts/statements",
          nav: "Accounts",
          title: "Checking",
          tabs: ["Activity", "Statements", "Details"],
          tab: "Statements",
          rows: [
            { label: "September 2026", meta: "PDF", action: { id: "sep", icon: "download" } },
            { label: "August 2026", meta: "PDF", action: { id: "aug", icon: "download" } },
            { label: "July 2026", meta: "PDF", action: { id: "jul", icon: "download" } },
          ],
        },
        target: "row:sep",
        caption: "Click the download icon next to September 2026.",
      },
      {
        screen: {
          path: "/accounts/statements",
          nav: "Accounts",
          title: "Checking",
          tabs: ["Activity", "Statements", "Details"],
          tab: "Statements",
          rows: [
            { label: "September 2026", meta: "PDF", action: { id: "sep", icon: "download" } },
            { label: "August 2026", meta: "PDF", action: { id: "aug", icon: "download" } },
            { label: "July 2026", meta: "PDF", action: { id: "jul", icon: "download" } },
          ],
          toast: "Downloading statement",
        },
        caption: "Your September statement is downloading as a PDF.",
      },
    ],
  },
  {
    tab: "Analytics",
    app: "Metricly",
    domain: "metricly.io",
    nav: [
      { label: "Dashboards", icon: "grid" },
      { label: "Reports", icon: "file" },
      { label: "Explore", icon: "chart" },
      { label: "Alerts", icon: "bell" },
    ],
    question: "How do I share this dashboard?",
    steps: [
      {
        screen: {
          path: "/dashboards/weekly-growth",
          nav: "Dashboards",
          title: "Weekly growth",
          actions: [{ id: "share", icon: "share" }, { id: "more", icon: "more" }],
          rows: [
            { label: "Signups", meta: "+12% week over week" },
            { label: "Activation", meta: "+4%" },
            { label: "Churn", meta: "−1%" },
          ],
        },
        target: "action:share",
        caption: "Click the share icon at the top right.",
      },
      {
        screen: {
          path: "/dashboards/weekly-growth",
          nav: "Dashboards",
          title: "Weekly growth",
          actions: [{ id: "share", icon: "share" }, { id: "more", icon: "more" }],
          rows: [
            { label: "Signups", meta: "+12% week over week" },
            { label: "Activation", meta: "+4%" },
            { label: "Churn", meta: "−1%" },
          ],
          menu: { anchor: "share", items: [{ id: "public", label: "Anyone with the link", kind: "toggle" }, { id: "copy", label: "Copy link", kind: "button" }] },
        },
        target: "menu:public",
        caption: "Turn on Anyone with the link.",
      },
      {
        screen: {
          path: "/dashboards/weekly-growth",
          nav: "Dashboards",
          title: "Weekly growth",
          actions: [{ id: "share", icon: "share" }, { id: "more", icon: "more" }],
          rows: [
            { label: "Signups", meta: "+12% week over week" },
            { label: "Activation", meta: "+4%" },
            { label: "Churn", meta: "−1%" },
          ],
          menu: { anchor: "share", items: [{ id: "public", label: "Anyone with the link", kind: "toggle", on: true }, { id: "copy", label: "Copy link", kind: "button" }] },
        },
        target: "menu:copy",
        caption: "Click Copy link.",
      },
      {
        screen: {
          path: "/dashboards/weekly-growth",
          nav: "Dashboards",
          title: "Weekly growth",
          actions: [{ id: "share", icon: "share" }, { id: "more", icon: "more" }],
          rows: [
            { label: "Signups", meta: "+12% week over week" },
            { label: "Activation", meta: "+4%" },
            { label: "Churn", meta: "−1%" },
          ],
          toast: "Link copied",
        },
        caption: "The link is on your clipboard. Anyone with it can view this dashboard.",
      },
    ],
  },
];

// Timeline, in milliseconds.
const TYPE_MS = 38;
const THINK_MS = 650;
const FLY_DELAY_MS = 380;
const DWELL_MS = 2300;
const PRESS_MS = 220;
const DONE_MS = 3200;

type Phase = { kind: "typing"; chars: number } | { kind: "thinking" } | { kind: "step"; index: number; pressing: boolean };

interface Geometry {
  pointer: { x: number; y: number };
  ring: { x: number; y: number; w: number; h: number };
  caption: { x: number; y: number };
}

export function Demo() {
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "typing", chars: 0 });
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [visible, setVisible] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const scenario = SCENARIOS[active]!;

  // Only run while the demo is on screen.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.25 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drive the timeline.
  useEffect(() => {
    if (!visible) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout>;
    const next = (fn: () => void, ms: number) => {
      timer = setTimeout(fn, ms);
    };
    if (phase.kind === "typing") {
      if (reduce || phase.chars >= scenario.question.length) next(() => setPhase({ kind: "thinking" }), reduce ? 600 : 500);
      else next(() => setPhase({ kind: "typing", chars: phase.chars + 1 }), TYPE_MS);
    } else if (phase.kind === "thinking") {
      next(() => setPhase({ kind: "step", index: 0, pressing: false }), THINK_MS);
    } else {
      const step = scenario.steps[phase.index]!;
      if (!step.target) {
        next(() => {
          if (!pinned) setActive((active + 1) % SCENARIOS.length);
          setGeometry(null);
          setPhase({ kind: "typing", chars: 0 });
        }, DONE_MS);
      } else if (!phase.pressing) {
        next(() => setPhase({ ...phase, pressing: true }), FLY_DELAY_MS + DWELL_MS);
      } else {
        next(() => setPhase({ kind: "step", index: phase.index + 1, pressing: false }), PRESS_MS);
      }
    }
    return () => clearTimeout(timer);
  }, [phase, visible, scenario, active, pinned]);

  const step = phase.kind === "step" ? scenario.steps[phase.index] : undefined;
  const screen = step?.screen ?? scenario.steps[0]!.screen;

  const measure = useCallback(() => {
    const root = stage.current;
    if (!root || !step?.target) return;
    const el = root.querySelector<HTMLElement>(`[data-target="${CSS.escape(step.target)}"]`);
    if (!el) return;
    const base = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = r.left - base.left;
    const y = r.top - base.top;
    const tip = { x: x + Math.min(r.width * 0.65, Math.max(r.width - 10, r.width / 2)), y: y + r.height * 0.7 };
    const captionWidth = caption.current?.offsetWidth ?? 260;
    const captionHeight = caption.current?.offsetHeight ?? 110;
    const below = y + r.height + 30;
    const cy = below + captionHeight > base.height - 8 ? Math.max(8, y - captionHeight - 18) : below;
    const cx = Math.min(Math.max(8, x), base.width - captionWidth - 8);
    const target: Geometry = { pointer: tip, ring: { x: x - 4, y: y - 4, w: r.width + 8, h: r.height + 8 }, caption: { x: cx, y: cy } };
    setGeometry((current) => {
      if (current) return target;
      // First point of a run: start at the launcher, then fly on the next frame.
      requestAnimationFrame(() => requestAnimationFrame(() => setGeometry(target)));
      const start = { x: base.width - 70, y: base.height - 34 };
      return { pointer: start, ring: { x: start.x, y: start.y, w: 0, h: 0 }, caption: target.caption };
    });
  }, [step]);

  // Point once the new screen has rendered, after a short beat.
  useLayoutEffect(() => {
    if (!step?.target) return;
    const timer = setTimeout(measure, FLY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [step, measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const choose = (index: number) => {
    setPinned(true);
    setActive(index);
    setGeometry(null);
    setPhase({ kind: "typing", chars: 0 });
  };

  const stepNumber = phase.kind === "step" ? phase.index + 1 : 0;
  const done = step && !step.target;
  const typing = phase.kind === "typing";
  const pointing = Boolean(step?.target && geometry);

  return (
    <div>
      <div role="tablist" aria-label="Kinds of apps" className="reveal mx-auto flex max-w-full flex-wrap justify-center gap-2">
        {SCENARIOS.map((item, index) => (
          <button
            key={item.tab}
            role="tab"
            aria-selected={index === active}
            onClick={() => choose(index)}
            className={`h-10 rounded-full border px-4 text-[14px] font-semibold transition-colors ${index === active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink/70 hover:border-ink/30 hover:text-ink"}`}
          >
            {item.tab}
          </button>
        ))}
      </div>

      <div className="reveal mx-auto mt-10 max-w-5xl">
        <div className="overflow-hidden rounded-[22px] border border-line bg-white shadow-[0_30px_80px_-30px_rgba(0,0,0,0.25)]">
          {/* Browser chrome. */}
          <div className="flex h-11 items-center gap-2 border-b border-line bg-canvas px-4">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-2.5 rounded-full bg-ink/12" />
            ))}
            <div className="mx-auto flex h-7 max-w-[60%] min-w-0 items-center rounded-md bg-white px-3 text-[12px] text-ink-muted">
              <span className="truncate">
                {scenario.domain}
                <span className="text-ink">{screen.path}</span>
              </span>
            </div>
          </div>

          <div ref={stage} className="relative h-[440px] overflow-hidden sm:h-[460px]" aria-hidden="true">
            <div className="flex h-full">
              <aside className="w-[118px] shrink-0 border-r border-line bg-paper p-2.5 sm:w-[200px] sm:p-4">
                <div className="mb-5 flex items-center gap-2 px-2 pt-1">
                  <span className="flex size-6 items-center justify-center rounded-md bg-ink text-[11px] font-bold text-white">{scenario.app[0]}</span>
                  <span className="truncate text-[13px] font-semibold">{scenario.app}</span>
                </div>
                <nav className="space-y-0.5">
                  {scenario.nav.map((item) => (
                    <div
                      key={item.label}
                      data-target={`nav:${item.label}`}
                      className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12px] sm:text-[13px] ${screen.nav === item.label ? "bg-ink/[0.06] font-semibold text-ink" : "text-ink/55"}`}
                    >
                      <Icon name={item.icon} />
                      <span className="truncate">{item.label}</span>
                    </div>
                  ))}
                </nav>
              </aside>

              <main key={`${active}-${screen.path}-${screen.tab ?? ""}`} className="demo-screen relative min-w-0 flex-1 p-4 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="truncate text-[17px] font-semibold sm:text-[20px]">{screen.title}</h4>
                  <div className="flex items-center gap-1.5">
                    {screen.actions?.map((action) =>
                      action.label ? (
                        <span key={action.id} data-target={`action:${action.id}`} className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-white sm:text-[13px]">
                          {action.label}
                        </span>
                      ) : (
                        <span key={action.id} data-target={`action:${action.id}`} className="relative flex size-8 items-center justify-center rounded-lg border border-line text-ink/70">
                          <Icon name={action.icon!} />
                          {screen.menu?.anchor === action.id && <Menu menu={screen.menu} />}
                        </span>
                      ),
                    )}
                  </div>
                </div>

                {screen.tabs && (
                  <div className="mt-4 flex gap-4 border-b border-line text-[12px] sm:gap-6 sm:text-[13px]">
                    {screen.tabs.map((tab) => (
                      <span key={tab} data-target={`tab:${tab}`} className={`-mb-px border-b-2 pb-2.5 whitespace-nowrap ${screen.tab === tab ? "border-ink font-semibold text-ink" : "border-transparent text-ink/50"}`}>
                        {tab}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-5 divide-y divide-line rounded-xl border border-line">
                  {screen.rows?.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
                      <span className="truncate text-[13px] font-medium sm:text-[14px]">{row.label}</span>
                      <span className="flex items-center gap-3">
                        <span className="hidden font-mono text-[12px] text-ink/45 sm:inline">{row.meta}</span>
                        {row.action && (
                          <span data-target={`row:${row.action.id}`} className="flex size-7 items-center justify-center rounded-md border border-line text-ink/70">
                            <Icon name={row.action.icon!} />
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                {screen.toast && (
                  <div className="demo-screen absolute bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold whitespace-nowrap text-white shadow-lg">
                    <Check /> {screen.toast}
                  </div>
                )}
              </main>
            </div>

            {/* Haptic's layer: ring, pointer, caption, Ask bar and launcher. */}
            <div
              className="demo-ring"
              style={{
                opacity: pointing ? 1 : 0,
                transform: `translate(${geometry?.ring.x ?? 0}px, ${geometry?.ring.y ?? 0}px)`,
                width: geometry?.ring.w ?? 0,
                height: geometry?.ring.h ?? 0,
              }}
            />
            <div
              className={`demo-pointer ${phase.kind === "step" && phase.pressing ? "pressing" : ""}`}
              style={{
                opacity: pointing ? 1 : 0,
                transform: `translate(${(geometry?.pointer.x ?? 0) - 3.5}px, ${(geometry?.pointer.y ?? 0) - 2.5}px)`,
              }}
            >
              <Pointer size={24} />
            </div>
            <div
              ref={caption}
              className="demo-caption w-[250px] rounded-xl bg-ink p-3.5 text-white shadow-[0_12px_32px_rgba(0,0,0,0.28)] sm:w-[270px]"
              style={
                // Next to the target while pointing, otherwise docked above the launcher.
                pointing && geometry
                  ? { opacity: 1, transform: `translate(${geometry.caption.x}px, ${geometry.caption.y}px)` }
                  : { opacity: done || phase.kind === "thinking" ? 1 : 0, left: "auto", top: "auto", right: 16, bottom: 68, transform: "none", transition: "opacity 240ms ease" }
              }
            >
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
                <span className={`size-1.5 rounded-full bg-white ${phase.kind === "thinking" ? "animate-pulse" : ""}`} />
                {phase.kind === "thinking" ? "Thinking…" : done ? "Done" : `Your turn · Step ${stepNumber}`}
              </div>
              <p className="mb-1 truncate text-[11px] text-white/50">{scenario.question}</p>
              <p className="text-[13px] leading-snug">{phase.kind === "thinking" ? " " : step?.caption}</p>
            </div>

            <div className="absolute right-4 bottom-4 z-50 flex flex-col items-end gap-2">
              {typing && (
                <div className="flex w-[250px] items-center gap-2 rounded-xl bg-ink py-1.5 pr-1.5 pl-3.5 text-[13px] text-white shadow-xl sm:w-[300px]">
                  <span className="min-w-0 flex-1 truncate">
                    {scenario.question.slice(0, phase.chars)}
                    <span className="ml-px inline-block h-4 w-px translate-y-[3px] animate-pulse bg-white" />
                  </span>
                  <span className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${phase.chars >= scenario.question.length ? "bg-white text-ink" : "bg-white/15 text-white/50"}`}>Ask</span>
                </div>
              )}
              <span className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-semibold text-white shadow-lg">
                <Pointer on="dark" size={15} />
                {phase.kind === "step" && !done ? "Stop" : "Ask"}
              </span>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[13px] text-ink-muted">A made-up app, scripted. On your app, Haptic works from the live page.</p>
      </div>
    </div>
  );
}

function Menu({ menu }: { menu: NonNullable<Screen["menu"]> }) {
  return (
    <div className="demo-screen absolute top-10 right-0 z-10 w-[210px] rounded-xl border border-line bg-white p-1.5 text-left shadow-[0_16px_40px_rgba(0,0,0,0.14)]">
      {menu.items.map((item) =>
        item.kind === "toggle" ? (
          <div key={item.id} className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] text-ink">
            <span>{item.label}</span>
            <span data-target={`menu:${item.id}`} className={`relative h-5 w-9 rounded-full transition-colors ${item.on ? "bg-ink" : "bg-ink/15"}`}>
              <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${item.on ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </div>
        ) : item.kind === "button" ? (
          <div key={item.id} className="p-1">
            <span data-target={`menu:${item.id}`} className="block rounded-lg bg-ink py-2 text-center text-[13px] font-semibold text-white">
              {item.label}
            </span>
          </div>
        ) : (
          <div key={item.id} data-target={`menu:${item.id}`} className="rounded-lg px-2.5 py-2 text-[13px] text-ink hover:bg-canvas">
            {item.label}
          </div>
        ),
      )}
    </div>
  );
}

const PATHS: Record<IconName, string> = {
  home: "M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z",
  rocket: "M12 15l-3-3c1-4 4-8 10-9-1 6-5 9-9 10zM9 12H5l3-4h4M12 15v4l4-3v-4",
  logs: "M5 6h14M5 12h14M5 18h9",
  chart: "M5 20V10M12 20V4M19 20v-7",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3 3-5 6-5s6 2 6 5M16 4a3.5 3.5 0 0 1 0 7M18 15c2 .5 3 2.5 3 5",
  group: "M4 6h7v7H4zM13 6h7v7h-7zM8 15h8v6H8z",
  audit: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  bank: "M3 9l9-5 9 5M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18",
  send: "M4 12l16-8-6 16-2-7z",
  card: "M3 6h18v12H3zM3 10h18",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  file: "M6 3h9l4 4v14H6zM14 3v5h5",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  plus: "M12 5v14M5 12h14",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={PATHS[name]} />
    </svg>
  );
}
