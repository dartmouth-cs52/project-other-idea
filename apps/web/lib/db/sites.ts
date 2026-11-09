import "server-only";
import { normalizeAppearance, type SiteAppearance, type SiteKnowledge } from "@haptic/protocol";
import { renderSiteMap } from "../siteMap";
import type { Site } from "../sites";
import { createAdminClient } from "../supabase/admin";

export function monthStart(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export function mergeAppearance(stored: unknown): SiteAppearance {
  return normalizeAppearance(stored);
}

interface Billing {
  subscription_status: string;
  trial_ends_at: string;
  monthly_turn_limit: number;
}

/** A trialing organization whose trial is over. */
export function trialEnded(org: Pick<Billing, "subscription_status" | "trial_ends_at">, now = Date.now()): boolean {
  return org.subscription_status === "trialing" && Date.parse(org.trial_ends_at) < now;
}

/** Why an organization can't serve sessions right now, or undefined if it can. */
export function billingBlock(org: Billing, turnsThisMonth: number, now = Date.now()): string | undefined {
  const status = org.subscription_status;
  if (trialEnded(org, now)) {
    return "This site's Haptic trial has ended.";
  }
  if (!["trialing", "active", "past_due"].includes(status)) {
    return "This site's Haptic subscription isn't active.";
  }
  if (turnsThisMonth >= org.monthly_turn_limit) {
    return "This site has used all of its Haptic questions for the month.";
  }
  return undefined;
}

export async function loadSiteByKey(key: string): Promise<Site | undefined> {
  const db = createAdminClient();
  const { data: site, error } = await db
    .from("sites")
    .select(
      "id, org_id, name, allowed_origins, notes, appearance, voice_enabled, learning_enabled, organizations(subscription_status, trial_ends_at, monthly_turn_limit)",
    )
    .eq("publishable_key", key)
    .maybeSingle();
  if (error) throw error;
  if (!site?.organizations) return undefined;

  const { data: usage } = await db
    .from("usage_monthly")
    .select("turns")
    .eq("org_id", site.org_id)
    .eq("month", monthStart())
    .maybeSingle();

  const blockedReason = billingBlock(site.organizations, usage?.turns ?? 0);
  return {
    id: site.id,
    orgId: site.org_id,
    name: site.name,
    allowedOrigins: site.allowed_origins,
    notes: site.notes,
    appearance: mergeAppearance(site.appearance),
    voiceEnabled: site.voice_enabled,
    learningEnabled: site.learning_enabled,
    ...(blockedReason ? { blockedReason } : {}),
  };
}

export async function loadKnowledge(siteId: string, siteName: string): Promise<SiteKnowledge> {
  const db = createAdminClient();
  const { data } = await db.from("sites").select("notes").eq("id", siteId).maybeSingle();
  return { siteName, notes: data?.notes ?? "", siteMap: await renderSiteMap(siteId) };
}
