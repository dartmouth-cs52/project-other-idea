"use server";

import { DEFAULT_APPEARANCE, DOCK_POSITIONS, type DockPosition, type PanelPosition } from "@haptic/protocol";
import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { normalizeOrigin } from "@/lib/origins";
import { siteTag } from "@/lib/sites";

export interface FormState {
  error?: string;
  saved?: boolean;
}

function text(form: FormData, name: string, max: number): string {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function dockPosition(form: FormData, name: string, fallback: DockPosition): DockPosition {
  const value = text(form, name, 20) as DockPosition;
  return DOCK_POSITIONS.includes(value) ? value : fallback;
}

function pixels(form: FormData, name: string, min: number, max: number, fallback: number): number {
  const raw = form.get(name);
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

/** Turn a list of origins, one per line, into clean origins or an error. */
function parseOrigins(raw: string): { origins: string[]; error?: string } {
  const origins: string[] = [];
  for (const line of raw.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean)) {
    if (line.includes("*")) {
      if (!/^https?:\/\/\*\.[a-z0-9.-]+(:\d+)?$/i.test(line)) return { origins, error: `"${line}" isn't a valid wildcard. Use https://*.example.com.` };
      origins.push(line.toLowerCase());
      continue;
    }
    const origin = normalizeOrigin(line);
    if (!origin) return { origins, error: `"${line}" isn't a valid origin. Use the scheme and host, like https://app.example.com.` };
    origins.push(origin);
  }
  return { origins: Array.from(new Set(origins)) };
}

/** First run: create the organization and its first site together. */
export async function createOrganizationAndSite(_state: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const orgName = text(form, "org", 80);
  const siteName = text(form, "site", 80);
  const url = text(form, "url", 300);
  if (!orgName || !siteName) return { error: "Name your organization and your site." };
  const origin = normalizeOrigin(url);
  if (!origin) return { error: "Enter your app's address, like https://app.example.com." };

  const { data: orgId, error } = await supabase.rpc("create_organization", { org_name: orgName });
  if (error || !orgId) return { error: "Couldn't create the organization. Try again." };

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .insert({ org_id: orgId, name: siteName, url: origin, allowed_origins: [origin], appearance: { ...DEFAULT_APPEARANCE } })
    .select("id")
    .single();
  if (siteError || !site) return { error: "Couldn't create the site. Try again." };
  redirect(`/dashboard/sites/${site.id}`);
}

export async function createSite(_state: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const orgId = text(form, "org_id", 64);
  const name = text(form, "site", 80);
  const origin = normalizeOrigin(text(form, "url", 300));
  if (!name || !origin) return { error: "Name the site and enter its address, like https://app.example.com." };
  const { data: site, error } = await supabase
    .from("sites")
    .insert({ org_id: orgId, name, url: origin, allowed_origins: [origin], appearance: { ...DEFAULT_APPEARANCE } })
    .select("id")
    .single();
  if (error || !site) return { error: "Couldn't create the site." };
  redirect(`/dashboard/sites/${site.id}`);
}

/** After a site changes: expire the API's cached copy and re-render the page. */
function changed(form: FormData) {
  updateTag(siteTag(text(form, "site_id", 64)));
  refresh();
}

export async function updateOrigins(_state: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const { origins, error } = parseOrigins(String(form.get("origins") ?? ""));
  if (error) return { error };
  if (origins.length === 0) return { error: "Add at least one origin, or Haptic won't load anywhere." };
  const { error: dbError } = await supabase.from("sites").update({ allowed_origins: origins }).eq("id", text(form, "site_id", 64));
  if (dbError) return { error: "Couldn't save." };
  changed(form);
  return { saved: true };
}

export async function updateKnowledge(_state: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("sites")
    .update({ notes: text(form, "notes", 8000), learning_enabled: form.get("learning") === "on" })
    .eq("id", text(form, "site_id", 64));
  if (error) return { error: "Couldn't save." };
  changed(form);
  return { saved: true };
}

export async function updateAppearance(_state: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  const accent = form.get("accent_mode") === "custom" ? text(form, "accent", 7) : "auto";
  if (accent !== "auto" && !/^#[0-9a-f]{6}$/i.test(accent)) return { error: "Pick an accent color as a hex value like #2f5bea." };
  const position = dockPosition(form, "position", DEFAULT_APPEARANCE.position);
  const requestedPanelPosition = text(form, "panelPosition", 20);
  const panelPosition: PanelPosition = requestedPanelPosition === "launcher" || DOCK_POSITIONS.includes(requestedPanelPosition as DockPosition)
    ? (requestedPanelPosition as PanelPosition)
    : DEFAULT_APPEARANCE.panelPosition;
  const launcherDisplay = text(form, "launcherDisplay", 12);
  const appearance = {
    accent,
    position,
    panelPosition,
    launcherStyle: launcherDisplay === "icon" ? ("icon" as const) : ("pill" as const),
    launcherLabel: text(form, "launcherLabel", 24) || DEFAULT_APPEARANCE.launcherLabel,
    showLauncher: launcherDisplay !== "hidden",
    edgeOffsetX: pixels(form, "edgeOffsetX", 0, 160, DEFAULT_APPEARANCE.edgeOffsetX),
    edgeOffsetY: pixels(form, "edgeOffsetY", 0, 160, DEFAULT_APPEARANCE.edgeOffsetY),
    panelWidth: pixels(form, "panelWidth", 280, 560, DEFAULT_APPEARANCE.panelWidth),
    ...(text(form, "greeting", 80) ? { greeting: text(form, "greeting", 80) } : {}),
  };
  const { error } = await supabase
    .from("sites")
    // The voice checkbox only appears while the voice feature flag is on.
    .update({ appearance, ...(form.has("voice") || env.voiceFeature ? { voice_enabled: form.get("voice") === "on" } : {}) })
    .eq("id", text(form, "site_id", 64));
  if (error) return { error: "Couldn't save." };
  changed(form);
  return { saved: true };
}

export async function rotateKey(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.rpc("rotate_site_key", { site: text(form, "site_id", 64) });
  changed(form);
}

export async function setLabelHidden(form: FormData) {
  const { supabase } = await requireUser();
  await supabase
    .from("outline_labels")
    .update({ hidden: form.get("hidden") === "true" })
    .eq("site_id", text(form, "site_id", 64))
    .eq("route", text(form, "route", 300))
    .eq("kind", text(form, "kind", 20))
    .eq("label", text(form, "label", 200));
  changed(form);
}

export async function deleteSite(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("sites").delete().eq("id", text(form, "site_id", 64));
  updateTag(siteTag(text(form, "site_id", 64)));
  redirect("/dashboard");
}
