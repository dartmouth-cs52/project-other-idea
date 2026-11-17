import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SiteContext } from "../shared/types.ts";

// Site contexts live as JSON files in data/sites, written by the intake CLI
// and read by the server. A database replaces this once there are accounts.

export const SITES_DIR = fileURLToPath(new URL("../../data/sites/", import.meta.url));
const SITE_ID = /^site_[a-z0-9_]{3,40}$/;

const cache = new Map<string, { mtimeMs: number; site: SiteContext }>();

/** Reads a site, re-reading the file only when it has changed, so a refresh takes effect without a restart. */
export async function loadSite(id: string): Promise<SiteContext | undefined> {
  if (!SITE_ID.test(id)) return undefined;
  const file = `${SITES_DIR}${id}.json`;
  try {
    const { mtimeMs } = await stat(file);
    const cached = cache.get(id);
    if (cached?.mtimeMs === mtimeMs) return cached.site;
    const site = JSON.parse(await readFile(file, "utf8")) as SiteContext;
    cache.set(id, { mtimeMs, site });
    return site;
  } catch {
    return undefined;
  }
}

export async function saveSite(site: SiteContext): Promise<string> {
  if (!SITE_ID.test(site.id)) throw new Error(`"${site.id}" isn't a valid site id. Use site_ followed by lowercase letters, digits or underscores.`);
  await mkdir(SITES_DIR, { recursive: true });
  const file = `${SITES_DIR}${site.id}.json`;
  await writeFile(file, JSON.stringify(site, null, 2) + "\n");
  return file;
}

export async function listSiteIds(): Promise<string[]> {
  try {
    return (await readdir(SITES_DIR)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  } catch {
    return [];
  }
}
