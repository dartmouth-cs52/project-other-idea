"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Pointer, POINTER_TIP } from "@/components/pointer";
import { Button } from "@/components/ui/button";
import { hostOf } from "@/lib/setup";
import { DoneMark } from "../parts";
import { Back, Primary, StepFrame } from "./frame";
import type { SetupPages } from "./use-reading";

/** Each page row's height, in pixels. The pointer moves by whole rows. */
const ROW = 44;
/** How long between one page appearing and the next, when a batch of several arrives at once. */
const REVEAL_MS = 320;
/** The pointer's size, in pixels, and where its tip sits inside that. */
const POINTER = 20;
const TIP = { x: (POINTER_TIP.x / 24) * POINTER, y: (POINTER_TIP.y / 24) * POINTER };
/** After this long, someone may move on while the reading carries on. */
const SKIP_AFTER_MS = 20_000;

/**
 * Step 2. The reading as it happens: every page as it is read, with its
 * number of buttons, links and fields, and the pointer moving down to the
 * newest. Pages arrive a few at a time, one request each, and are shown one
 * after another so a batch reads as a sequence. Every number is the reader's.
 */
export function ReadingStep({ origin, pages, onBack, onNext }: { origin: string; pages: SetupPages; onBack: () => void; onNext: () => void }) {
  const { reading, stalled, retry } = pages;
  const host = hostOf(origin);
  const list = usePagesInOrder(reading?.pages ?? []);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SKIP_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const done = Boolean(reading?.done);
  const all = reading?.pages.length ?? 0;
  const caughtUp = list.shown >= all;
  const shownPages = list.order.slice(0, list.shown);
  const controlsOf = new Map((reading?.pages ?? []).map((page) => [page.path, page.controls ?? 0]));
  const controlsShown = caughtUp && reading?.controls !== undefined ? reading.controls : shownPages.reduce((sum, path) => sum + (controlsOf.get(path) ?? 0), 0);
  const finished = done && caughtUp;

  if (done && (reading?.read ?? 0) === 0) {
    return (
      <StepFrame
        step="reading"
        title="Haptic couldn't read your site"
        lead={`${host} didn't answer, or it sends visitors somewhere else, such as a sign-in page. You can carry on. Haptic reads each page live once the script is on it, so guides still work.`}
        actions={
          <>
            <Back onClick={onBack} />
            <Button variant="secondary" size="xl" onClick={retry}>
              Try again
            </Button>
            <Primary onClick={onNext}>Continue anyway</Primary>
          </>
        }
      />
    );
  }

  const few = finished && (reading?.read ?? 0) < 3;
  const title = finished ? (few ? `Haptic read ${reading!.read} ${reading!.read === 1 ? "page" : "pages"}` : "Haptic read your site") : "Reading your site";
  const lead = finished
    ? few
      ? `Most of ${host} is probably behind sign-in. That is fine. Haptic learns those pages from the live page once the script is on.`
      : `It read ${reading!.read} public pages on ${host} and noted every button, link and field, so it knows what your product calls things.`
    : `Haptic opens the public pages of ${host} the way a visitor would and notes every button, link and field. It never signs in, types or sends anything.`;

  return (
    <StepFrame
      step="reading"
      mark={finished ? <DoneMark className="size-7 [&_svg]:size-4" /> : undefined}
      title={title}
      lead={lead}
      actions={
        <>
          <Back onClick={onBack} />
          {finished ? (
            <Primary onClick={onNext}>Continue</Primary>
          ) : stalled ? (
            <>
              <Button variant="secondary" size="xl" onClick={retry}>
                Try again
              </Button>
              <Primary onClick={onNext}>Continue anyway</Primary>
            </>
          ) : (
            <>
              <Primary disabled>Reading</Primary>
              {slow && (
                <Button variant="ghost" size="xl" onClick={onNext}>
                  Continue while it reads
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="grid grid-cols-3 divide-x rounded-xl border bg-muted">
        <Count label={list.shown === 1 ? "page read" : "pages read"} value={list.shown} />
        <Count label="controls found" value={controlsShown} />
        <Count label="need sign-in" value={reading?.signIn ?? 0} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          {finished ? (
            <span>Done.</span>
          ) : stalled ? (
            <span role="status">Reading stopped for now. Try again, or carry on and Haptic picks it up later.</span>
          ) : (
            <span className="shimmer" role="status">
              Reading your pages
            </span>
          )}
          <span className="tabular-nums">
            {list.shown} of {finished ? list.shown : `up to ${reading?.max ?? 30}`}
          </span>
        </div>
        <span className="block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${finished ? 100 : Math.min(100, (list.shown / (reading?.max || 30)) * 100)}%` }}
          />
        </span>
        <PageList paths={shownPages} reading={reading} waiting={!finished && !stalled} />
      </div>
    </StepFrame>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-3 sm:px-5 sm:py-4">
      <span className="text-2xl font-medium tracking-[-0.02em] tabular-nums">{value.toLocaleString()}</span>
      <span className="text-sm leading-5 text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * The pages in the order they arrived, and how many of them are showing. The
 * Worker sorts its list by path, so arrival is noted here, a tick at a time.
 */
function usePagesInOrder(pages: { path: string }[]) {
  const latest = useRef(pages);
  const [list, setList] = useState<{ order: string[]; shown: number }>({ order: [], shown: 0 });
  useEffect(() => {
    latest.current = pages;
  }, [pages]);
  useEffect(() => {
    const timer = setInterval(() => {
      setList((previous) => {
        const added = latest.current.map((page) => page.path).filter((path) => !previous.order.includes(path));
        const order = added.length ? [...previous.order, ...added] : previous.order;
        const shown = Math.min(previous.shown + 1, order.length);
        return order === previous.order && shown === previous.shown ? previous : { order, shown };
      });
    }, REVEAL_MS);
    return () => clearInterval(timer);
  }, []);
  return list;
}

function PageList({ paths, reading, waiting }: { paths: string[]; reading: SetupPages["reading"]; waiting: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const byPath = new Map((reading?.pages ?? []).map((page) => [page.path, page]));
  const newest = paths.length - 1;

  // Keeps the newest page in view as the list grows.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: element.scrollHeight, behavior: still ? "auto" : "smooth" });
  }, [paths.length]);

  return (
    // Six rows and the room under the last one for the pointer, so the list always scrolls by whole rows.
    <div ref={box} className="relative max-h-[276px] min-h-[188px] overflow-y-auto rounded-xl border bg-card" data-reading-list>
      <ul className="relative pb-3">
        {paths.map((path, index) => {
          const page = byPath.get(path);
          const controls = page?.controls;
          return (
            <li
              key={path}
              className={cn(
                "flex items-center gap-3 border-b px-4 pr-12 text-sm last:border-b-0 animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none",
                index === newest ? "text-foreground" : "text-foreground/80",
              )}
              style={{ height: ROW }}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{page?.title || path}</span>
                <span className="text-muted-foreground"> {path}</span>
              </span>
              {controls !== undefined && <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-muted px-2 text-xs tabular-nums text-muted-foreground">{controls} controls</span>}
            </li>
          );
        })}
        {waiting && (
          <li className="flex items-center px-4 text-sm text-muted-foreground" style={{ height: ROW }}>
            <span className="shimmer">{paths.length ? "Opening the next pages" : "Opening the first page"}</span>
          </li>
        )}
        {newest >= 0 && (
          // The pointer rests on the newest page's count, its tip on the count's lower right corner, and glides to each new one.
          <span
            className="pointer-events-none absolute text-pointer transition-[top] duration-500 ease-glide motion-reduce:transition-none"
            style={{ top: newest * ROW + ROW / 2 + 12 - TIP.y, right: 48 + TIP.x - POINTER, width: POINTER, height: POINTER }}
            aria-hidden
          >
            <Pointer bordered className="pointer-shadow size-5" />
          </span>
        )}
      </ul>
    </div>
  );
}
