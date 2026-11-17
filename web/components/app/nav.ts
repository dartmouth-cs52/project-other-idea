"use client";

// Where each part of the dashboard lives. The site is fully static, so a page
// can't have the site's id in its path. Everything is one page, /dashboard/,
// and the address says the rest: ?site= for the site, ?view= for the page of
// it, ?guide= for the guide open beside it. With no site named it is the list
// of sites. A reload or a shared link comes back to the same place. Adding a
// site has screens of its own, at /dashboard/setup/.

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ChartNoAxesColumn, MessagesSquare, SearchX, Settings, type LucideIcon } from "lucide-react";

export type View = "overview" | "questions" | "gaps" | "knowledge" | "settings";

/** The pages of a site, in the order the sidebar lists them. */
export const VIEWS: readonly { id: View; name: string; icon: LucideIcon }[] = [
  { id: "overview", name: "Overview", icon: ChartNoAxesColumn },
  { id: "questions", name: "Questions", icon: MessagesSquare },
  { id: "gaps", name: "Gaps", icon: SearchX },
  { id: "knowledge", name: "Knowledge", icon: BookOpen },
  { id: "settings", name: "Settings", icon: Settings },
];

export const RANGES = [7, 30, 90] as const;

export function viewFrom(text: string | null): View {
  return VIEWS.find((view) => view.id === text)?.id ?? "overview";
}

export function daysFrom(text: string | null): number {
  const asked = Number(text);
  return RANGES.find((range) => range === asked) ?? 30;
}

/** The list of every site, which is where sign-in lands. It is kept in lib/dashboard.ts, where the Worker can reach it too. */
export { SITES_HREF } from "@/lib/dashboard";
/** The company's plan and what it has used, across every site. */
export const BILLING_HREF = "/dashboard/?view=billing";
/** Adding a site, on the setup screens, one question at a time. */
export const NEW_SITE_HREF = "/dashboard/setup/";

/** The address of one page of one site. */
export function siteHref(site: string, view: View = "overview", more?: Record<string, string | undefined>): string {
  const params = new URLSearchParams({ site });
  if (view !== "overview") params.set("view", view);
  for (const [name, value] of Object.entries(more ?? {})) if (value) params.set(name, value);
  return `/dashboard/?${params}`;
}

/**
 * Changes parts of the address and leaves the rest, without moving the page.
 * An empty value takes that part out. Opening something adds a step to Back.
 * Changing a filter does not.
 */
export function useAddress() {
  const router = useRouter();
  const params = useSearchParams();
  const set = useCallback(
    (changes: Record<string, string | undefined>, how: "push" | "replace" = "replace") => {
      const next = new URLSearchParams(params.toString());
      for (const [name, value] of Object.entries(changes)) {
        if (value) next.set(name, value);
        else next.delete(name);
      }
      const address = `/dashboard/${next.size ? `?${next}` : ""}`;
      if (how === "push") router.push(address, { scroll: false });
      else router.replace(address, { scroll: false });
    },
    [router, params],
  );
  return { params, set };
}
