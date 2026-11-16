"use client";

// Keeps a dashboard page up to date while it is open. The page asks the Worker
// what is happening every second and a half, which is one small query, and
// asks for the heavier numbers again only when the answer's stamp has changed.
// It stops asking while the tab is in the background and catches up at once
// when it comes back.

import { useEffect, useRef, useState } from "react";
import { api, clock, type Insights, type Live, type LiveGuide } from "@/lib/app-api";

/** How often an open page asks what is new. */
export const LIVE_MS = 1_500;

/**
 * Asks for `path` again and again while the tab is in view. `stamp` is the
 * answer's own mark of whether anything changed, so a page that polls and gets
 * the same thing back does not draw again. `failing` is true once two asks in
 * a row got no answer.
 */
export function usePolled<T extends object>(path: string | null, everyMs = LIVE_MS): { data: T | null; failing: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [failing, setFailing] = useState(false);
  const stamp = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!path) return;
    let live = true;
    let misses = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asking = false;

    async function ask() {
      if (asking) return;
      asking = true;
      try {
        const next = await api<T>(path!);
        if (!live) return;
        misses = 0;
        setFailing(false);
        // The whole answer is the mark when it carries none of its own.
        const mark = (next as { stamp?: string }).stamp ?? JSON.stringify(next);
        if (mark !== stamp.current) {
          stamp.current = mark;
          setData(next);
        }
      } catch {
        if (live && ++misses >= 2) setFailing(true);
      } finally {
        asking = false;
        if (live && document.visibilityState === "visible") timer = setTimeout(ask, everyMs);
      }
    }

    function onVisible() {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void ask();
    }

    stamp.current = undefined;
    void ask();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, everyMs]);

  return { data, failing };
}

/** A site's newest questions and the step each is on, kept current. */
export function useLive(siteId: string | null) {
  const { data, failing } = usePolled<Live>(siteId ? `/sites/${siteId}/live` : null);
  return { live: data, failing };
}

/**
 * A site's numbers for a time range, asked for again whenever `stamp` changes.
 * While a newer answer is on its way the last one stays on screen, so the page
 * never blinks empty. `error` is set only when there is nothing to show.
 */
export function useInsights(siteId: string | null, days: number, stamp: string | undefined) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!siteId) return;
    let live = true;
    api<Insights>(`/sites/${siteId}/insights?days=${days}&${clock()}`).then(
      (result) => live && (setData(result), setError(null)),
      (failure: Error) => live && setError(failure.message),
    );
    return () => {
      live = false;
    };
  }, [siteId, days, stamp, attempt]);

  return { data, error: data ? null : error, retry: () => (setError(null), setAttempt((count) => count + 1)) };
}

type Recent = Insights["recent"][number];

/** Whether a guide counts as unanswered, by the same rule as the Worker's count in worker/insights.ts. */
export function unanswered(row: Pick<Recent, "outcome" | "helped">): boolean {
  if (row.helped === true) return false;
  return row.helped === false || ["nothing_to_point_at", "loop", "step_limit", "error", "not_covered", "abandoned"].includes(row.outcome);
}

/**
 * The questions of the time range with the live ones laid over them, newest
 * first. The numbers are asked for again only after the live list changes, so
 * for a moment the live list knows more: a question that has just been asked,
 * or one that has just finished.
 */
export function withLive(recent: Recent[], live: LiveGuide[] | undefined, since: number): Recent[] {
  if (!live?.length) return recent;
  const fresh = new Map(live.map((guide) => [guide.id, guide]));
  const known = new Set(recent.map((row) => row.id));
  const merged = recent.map((row) => {
    const now = fresh.get(row.id);
    return now ? { ...row, outcome: now.outcome, helped: now.helped, step_count: Math.max(row.step_count, now.step_count) } : row;
  });
  const added: Recent[] = live
    .filter((guide) => !known.has(guide.id) && new Date(guide.started_at).getTime() >= since)
    .map((guide) => ({
      id: guide.id,
      question: guide.question,
      started_at: guide.started_at,
      started_path: guide.started_path,
      origin: null,
      step_count: guide.step_count,
      helped: guide.helped,
      outcome: guide.outcome,
      wrong_clicks: 0,
      ms_to_pointer: null,
    }));
  return [...added, ...merged].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
}
