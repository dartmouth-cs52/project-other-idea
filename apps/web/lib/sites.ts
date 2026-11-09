import { DEFAULT_APPEARANCE, type SiteAppearance, type SiteKnowledge } from "@haptic/protocol";
import { cacheLife, cacheTag } from "next/cache";
import { env, hasSupabase } from "./env";

// Site lookup for the public API. Uses Supabase when it's configured and a
// built-in development site otherwise, so the SDK can be tried locally first.

export interface Site {
  id: string;
  orgId: string;
  name: string;
  allowedOrigins: string[];
  notes: string;
  appearance: SiteAppearance;
  voiceEnabled: boolean;
  learningEnabled: boolean;
  /** Why the site can't serve sessions right now, if it can't. */
  blockedReason?: string;
}

const DEV_SITE: Site = {
  id: "dev-site",
  orgId: "dev-org",
  name: "Local development",
  allowedOrigins: env.devOrigins,
  notes: process.env.HAPTIC_DEV_NOTES ?? "",
  appearance: DEFAULT_APPEARANCE,
  // Voice works locally as soon as an ElevenLabs key is configured.
  voiceEnabled: Boolean(env.elevenLabsApiKey),
  learningEnabled: true,
};

// Sites and their knowledge are cached for a minute in Next's shared cache,
// tagged per site. Dashboard saves call updateTag(siteTag(id)), so the next
// page load sees new settings and a rotated key stops working right away.
// A module-level Map wouldn't do: server actions and route handlers can run
// in separate module instances, so clearing one leaves the other stale.

export const siteTag = (siteId: string) => `site:${siteId}`;
const SITE_CACHE = { revalidate: 60, expire: 300 };

export async function getSiteByKey(key: string): Promise<Site | undefined> {
  if (env.devKey && key === env.devKey) return DEV_SITE;
  if (!hasSupabase()) return undefined;
  return cachedSiteByKey(key);
}

async function cachedSiteByKey(key: string): Promise<Site | undefined> {
  "use cache";
  cacheLife(SITE_CACHE);
  const { loadSiteByKey } = await import("./db/sites");
  const site = await loadSiteByKey(key);
  cacheTag(site ? siteTag(site.id) : `site-key:${key}`);
  return site;
}

/** Notes and learned site map for the prompt. */
export async function getSiteKnowledge(siteId: string, siteName: string): Promise<SiteKnowledge> {
  if (siteId === DEV_SITE.id) {
    const { renderSiteMap } = await import("./siteMap");
    return { siteName, notes: DEV_SITE.notes, siteMap: await renderSiteMap(siteId) };
  }
  if (!hasSupabase()) return { siteName };
  return cachedKnowledge(siteId, siteName);
}

async function cachedKnowledge(siteId: string, siteName: string): Promise<SiteKnowledge> {
  "use cache";
  cacheLife(SITE_CACHE);
  cacheTag(siteTag(siteId));
  const { loadKnowledge } = await import("./db/sites");
  return loadKnowledge(siteId, siteName);
}
