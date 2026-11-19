import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Plan, Role } from "@/data/types";

// The test panel's settings. Each one changes the app in a way that has tripped
// up a pointing guide somewhere: who you are, what you pay for, how slow the
// network is, what the navigation is called, and what else sits on the page.

export type Latency = "none" | "fast" | "slow" | "random";
export type NavVariant = "classic" | "renamed" | "rail";
export type Locale = "en" | "es";
export type Theme = "light" | "dark" | "system";

export interface LabSettings {
  open: boolean;
  role: Role;
  plan: Plan;
  latency: Latency;
  /** Chance from 0 to 1 that a load or save fails, to show error states. */
  failureRate: number;
  nav: NavVariant;
  locale: Locale;
  theme: Theme;
  /** Native <dialog>.showModal() instead of Radix's portaled dialogs. */
  nativeDialogs: boolean;
  /** A feed on the home page that changes the DOM every few seconds. */
  liveFeed: boolean;
  /** A fake support chat bubble in the bottom right corner. */
  chatBubble: boolean;
  /** A fixed banner across the top, covering the header's top edge. */
  banner: boolean;
  /** Show the small Lab button. Ctrl+Shift+L opens the panel either way. */
  labButton: boolean;
  /** Load the Haptic widget. */
  widget: boolean;
  widgetSrc: string;
  widgetSite: string;
  seed: number;
}

export const LAB_DEFAULTS: LabSettings = {
  open: false,
  role: "admin",
  plan: "growth",
  latency: "fast",
  failureRate: 0,
  nav: "classic",
  locale: "en",
  theme: "light",
  nativeDialogs: false,
  liveFeed: false,
  chatBubble: false,
  banner: false,
  labButton: true,
  widget: true,
  widgetSrc: import.meta.env.VITE_HAPTIC_SRC ?? "http://localhost:4000/widget.js",
  widgetSite: import.meta.env.VITE_HAPTIC_SITE ?? "site_testbed",
  seed: 52,
};

interface LabStore extends LabSettings {
  set: (patch: Partial<LabSettings>) => void;
  reset: () => void;
}

/**
 * The values each setting that is a choice may take. A setting can come from
 * the page's address, and it is kept for later visits, so a link with a value
 * the app doesn't know would break the demo for whoever opened it, on that
 * visit and every one after. Such a value is dropped instead.
 */
const CHOICES: Partial<Record<keyof LabSettings, readonly string[]>> = {
  role: ["admin", "finance", "manager", "employee", "auditor"] satisfies Role[],
  plan: ["starter", "growth", "enterprise"] satisfies Plan[],
  latency: ["none", "fast", "slow", "random"] satisfies Latency[],
  nav: ["classic", "renamed", "rail"] satisfies NavVariant[],
  locale: ["en", "es"] satisfies Locale[],
  theme: ["light", "dark", "system"] satisfies Theme[],
};

/** Haptic's own servers, the only ones a widget may be loaded from over the internet: the live one and staging. */
const WIDGET_HOSTS = new Set(["widget.joinhaptic.com", "haptic-widget-staging.joinhaptic.workers.dev"]);

/**
 * Whether the widget may be loaded from this address: the one this build was
 * made with, Haptic's live or staging server, a server on this machine, or
 * this page's own origin, which serves only Northpine's own files and is
 * where eval/browser.ts answers for a widget it builds. The address can come
 * from the page's URL and is kept for later visits, so any other would let a
 * link run whatever script it named on demo.joinhaptic.com, then and on every
 * visit after.
 */
export function trustedWidgetSrc(src: string): boolean {
  if (src === LAB_DEFAULTS.widgetSrc) return true;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  // Over http(s) only: a blob: address carries the origin of the page that made it, too.
  if (/^https?:$/.test(url.protocol) && typeof location !== "undefined" && url.origin === location.origin) return true;
  if (url.protocol === "https:") return WIDGET_HOSTS.has(url.hostname);
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/** Whether a value is one this setting can take, as the test panel itself would set it. */
function fits<K extends keyof LabSettings>(name: K, value: unknown): value is LabSettings[K] {
  const current = LAB_DEFAULTS[name];
  if (typeof current === "boolean") return typeof value === "boolean";
  if (typeof current === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    // The panel's slider runs from 0 to 0.5, and a seed is a whole number.
    if (name === "failureRate") return value >= 0 && value <= 0.5;
    return name !== "seed" || Number.isInteger(value);
  }
  if (typeof value !== "string") return false;
  if (name === "widgetSrc") return trustedWidgetSrc(value);
  // Own names only: a name every object has, such as toString or constructor, is no choice.
  return Object.hasOwn(CHOICES, name) ? CHOICES[name]!.includes(value) : true;
}

/**
 * The widget this build was made with. Saved settings are marked with it, so
 * after a deploy that changes the widget's address or site, the new tag wins
 * over the one an earlier visit left in the browser.
 */
const WIDGET_BUILD = `${LAB_DEFAULTS.widgetSrc} ${LAB_DEFAULTS.widgetSite}`;

export const useLab = create<LabStore>()(
  persist(
    (set) => ({
      ...LAB_DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...LAB_DEFAULTS, open: true }),
    }),
    {
      name: "northpine-lab",
      version: 1,
      partialize: (state) => ({ ...state, widgetBuild: WIDGET_BUILD }),
      merge: (saved, current) => {
        const { widgetBuild, ...rest } = (saved ?? {}) as Partial<LabSettings> & { widgetBuild?: string };
        if (widgetBuild !== WIDGET_BUILD) {
          delete rest.widgetSrc;
          delete rest.widgetSite;
        }
        // A value an earlier visit kept that no setting can take, such as one a link put there before links were
        // checked, goes back to the default rather than break the app or load a script from elsewhere.
        for (const name of Object.keys(rest) as (keyof LabSettings)[]) {
          if (Object.hasOwn(LAB_DEFAULTS, name) && !fits(name, rest[name])) delete rest[name];
        }
        return { ...current, ...rest };
      },
    },
  ),
);

/** Read settings outside React. */
export const lab = () => useLab.getState();

/** How long a simulated request takes, in milliseconds. */
export function latencyMs(): number {
  switch (lab().latency) {
    case "none":
      return 0;
    case "fast":
      return 150 + Math.random() * 150;
    case "slow":
      return 1400 + Math.random() * 600;
    case "random":
      return Math.random() < 0.7 ? 80 + Math.random() * 300 : 1000 + Math.random() * 2500;
  }
}

/**
 * Lab settings can also come from the URL, so a test can open a page in a known state: ?lab.role=employee&lab.nav=rail.
 * Anyone can send such a link, and what it sets is kept, so a value no setting can take is left out (`fits`).
 */
export function applyLabParams(search: string) {
  const params = new URLSearchParams(search);
  const patch: Record<string, unknown> = {};
  for (const [key, raw] of params) {
    if (!key.startsWith("lab.")) continue;
    const name = key.slice(4) as keyof LabSettings;
    // Own names only: ?lab.toString= or ?lab.__proto__= names something every object has, and no setting.
    if (!Object.hasOwn(LAB_DEFAULTS, name)) continue;
    const current = LAB_DEFAULTS[name];
    const value = typeof current === "boolean" ? raw === "1" || raw === "true" : typeof current === "number" ? Number(raw) : raw;
    if (fits(name, value)) patch[name] = value;
  }
  if (Object.keys(patch).length) useLab.getState().set(patch as Partial<LabSettings>);
}
