import type { SiteContext } from "../shared/types.ts";

// A site is needed for every request, and reading one means a trip to the
// database, which can be slow when the database has been idle. So each site
// is kept in memory for a while.
//
// A step of a guide must never wait on that trip if it can be helped: the
// visitor is watching for the pointer. A caller in a hurry is handed the copy
// already held, even a stale one, and the fresh copy is fetched after the
// response. A caller with time, such as the widget loading on a page, waits
// for the fresh copy, which is what makes a change to a site take effect.

export interface SiteCacheOptions {
  /** A held site is fresh for this long. */
  keepMs: number;
  /** A held site older than this is never handed out, even to a caller in a hurry. */
  maxStaleMs: number;
  /** After a failed refresh, how long before the next one is tried. */
  retryMs?: number;
  now?: () => number;
}

type Load = () => Promise<SiteContext | undefined>;
/** Finishes work after the response has gone, like waitUntil on a Worker. */
export type Later = (work: Promise<unknown>) => void;

export function createSiteCache(options: SiteCacheOptions) {
  const now = options.now ?? Date.now;
  const retryMs = options.retryMs ?? 10_000;
  const kept = new Map<string, { at: number; site: SiteContext | undefined }>();
  /** One fetch per site at a time, however many requests are waiting on it. */
  const loading = new Map<string, Promise<SiteContext | undefined>>();

  const refresh = (id: string, load: Load): Promise<SiteContext | undefined> => {
    let pending = loading.get(id);
    if (!pending) {
      pending = load()
        .then((site) => {
          if (kept.size > 1000) kept.clear();
          kept.set(id, { at: now(), site });
          return site;
        })
        .finally(() => loading.delete(id));
      loading.set(id, pending);
    }
    return pending;
  };

  /**
   * The site with this id, or undefined when there is none. Pass `later` when
   * the caller cannot wait: a held copy is returned at once and brought up to
   * date afterwards. If the fetch fails and a copy is held, that copy is used.
   */
  return async function get(id: string, load: Load, later?: Later): Promise<SiteContext | undefined> {
    const held = kept.get(id);
    const age = held ? now() - held.at : Infinity;
    if (held && age < options.keepMs) return held.site;

    // "No such site" is never served stale: a site that was just made must show up.
    if (later && held?.site && age < options.maxStaleMs) {
      later(
        refresh(id, load).catch((error) => {
          console.error(`Couldn't refresh ${id}:`, error instanceof Error ? error.message : error);
          // Keep what is held, and do not try again on every request while the database is down.
          if (kept.get(id) === held) held.at = now() - options.keepMs + retryMs;
        }),
      );
      return held.site;
    }

    try {
      return await refresh(id, load);
    } catch (error) {
      if (!held) throw error;
      console.error(`Couldn't read ${id}, so the copy held from before is used:`, error instanceof Error ? error.message : error);
      held.at = now() - options.keepMs + retryMs;
      return held.site;
    }
  };
}
