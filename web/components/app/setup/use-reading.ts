"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/app-api";
import type { SetupReading, SetupSite } from "./types";

/**
 * Keeps reading a new site's public pages while the setup is open, a few pages
 * per request, whichever screen is showing, so moving on early never leaves a
 * site with only its first page. The same loop as useReading in site-view.tsx.
 *
 * When the address changes, addressChanged stops the reads for the old one,
 * mid-request too, and forgets what they found, then reads the new one. A
 * batch of the old site's pages can still be on its way, and is never shown.
 */
export function useSetupReading(site: SetupSite | null) {
  // How many times the address has changed here. What a run finds counts only for the address it began on.
  const [address, setAddress] = useState(0);
  const [found, setFound] = useState<{ address: number; reading: SetupReading | null; stalled: boolean } | null>(null);
  const running = useRef<AbortController | null>(null);
  const siteId = site?.id;
  const unfinished = Boolean(site?.reading && !site.reading.done);

  const run = useCallback(
    async (restart: boolean) => {
      if (!siteId || running.current) return;
      const mine = new AbortController();
      running.current = mine;
      const live = () => running.current === mine;
      const stall = () => setFound((previous) => ({ address, reading: previous?.address === address ? previous.reading : null, stalled: true }));
      setFound((previous) => (previous?.address === address ? { ...previous, stalled: false } : null));
      try {
        let done = false;
        for (let round = 0; round < 25 && !done; round++) {
          const next = await api<SetupReading | null>(`/sites/${siteId}/read`, { method: "POST", body: restart && round === 0 ? { restart: true } : {}, signal: mine.signal });
          if (!live()) return;
          setFound({ address, reading: next, stalled: false });
          done = !next || next.done;
        }
        // Out of rounds with pages still to read: say so, rather than seem to read for ever.
        if (!done) stall();
      } catch {
        if (live()) stall();
      } finally {
        if (live()) running.current = null;
      }
    },
    [siteId, address],
  );

  // Starts again for a new address too, as run changes with it.
  useEffect(() => {
    if (!unfinished) return;
    const start = setTimeout(() => void run(false), 0);
    return () => clearTimeout(start);
  }, [unfinished, run]);

  const addressChanged = useCallback(() => {
    running.current?.abort();
    running.current = null;
    setFound(null);
    setAddress((count) => count + 1);
  }, []);

  // The reading from this page's own requests is the freshest. Until there is one, the site's.
  const reading = found?.address === address ? found.reading : null;
  const current = reading && (!site?.reading || reading.read >= site.reading.read || reading.done) ? reading : (site?.reading ?? null);
  return { reading: current, stalled: found?.address === address && found.stalled, retry: () => void run(true), addressChanged };
}

export type SetupPages = ReturnType<typeof useSetupReading>;
