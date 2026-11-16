"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/app-api";
import type { SetupReading, SetupSite } from "./types";

/**
 * Keeps reading a new site's public pages while the setup is open, a few pages
 * per request, whichever screen is showing, so moving on early never leaves a
 * site with only its first page. The same loop as useReading in site-view.tsx.
 */
export function useSetupReading(site: SetupSite | null) {
  const [reading, setReading] = useState<SetupReading | null>(null);
  const [stalled, setStalled] = useState(false);
  const busy = useRef(false);
  const siteId = site?.id;
  const unfinished = Boolean(site?.reading && !site.reading.done);

  const run = useCallback(
    async (restart: boolean) => {
      if (!siteId || busy.current) return;
      busy.current = true;
      setStalled(false);
      try {
        let done = false;
        for (let round = 0; round < 25 && !done; round++) {
          const next = await api<SetupReading | null>(`/sites/${siteId}/read`, { method: "POST", body: restart && round === 0 ? { restart: true } : {} });
          setReading(next);
          done = !next || next.done;
        }
        // Out of rounds with pages still to read: say so, rather than seem to read for ever.
        if (!done) setStalled(true);
      } catch {
        setStalled(true);
      } finally {
        busy.current = false;
      }
    },
    [siteId],
  );

  useEffect(() => {
    if (!unfinished) return;
    const start = setTimeout(() => void run(false), 0);
    return () => clearTimeout(start);
  }, [unfinished, run]);

  // The reading from this page's own requests is the freshest. Until there is one, the site's.
  const current = reading && (!site?.reading || reading.read >= site.reading.read || reading.done) ? reading : (site?.reading ?? null);
  return { reading: current, stalled, retry: () => void run(true) };
}

export type SetupPages = ReturnType<typeof useSetupReading>;
