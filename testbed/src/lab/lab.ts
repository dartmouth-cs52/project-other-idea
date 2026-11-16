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

export const useLab = create<LabStore>()(
  persist(
    (set) => ({
      ...LAB_DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...LAB_DEFAULTS, open: true }),
    }),
    { name: "northpine-lab", version: 1 },
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

/** Lab settings can also come from the URL, so a test can open a page in a known state: ?lab.role=employee&lab.nav=rail */
export function applyLabParams(search: string) {
  const params = new URLSearchParams(search);
  const patch: Record<string, unknown> = {};
  for (const [key, raw] of params) {
    if (!key.startsWith("lab.")) continue;
    const name = key.slice(4) as keyof LabSettings;
    if (!(name in LAB_DEFAULTS)) continue;
    const current = LAB_DEFAULTS[name];
    patch[name] = typeof current === "boolean" ? raw === "1" || raw === "true" : typeof current === "number" ? Number(raw) : raw;
  }
  if (Object.keys(patch).length) useLab.getState().set(patch as Partial<LabSettings>);
}
