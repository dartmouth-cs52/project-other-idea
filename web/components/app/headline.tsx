"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Info, Minus } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/app-api";
import { countChange, duration, durationChange, hostOf, rateChange, utcDayLabel, type Change } from "@/lib/setup";
import type { Headline as HeadlineData } from "@/worker/insights";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, Panel, PanelEmpty } from "./parts";

/**
 * The numbers at the top of a site's dashboard, for the chosen range: four of
 * them, each against the same number of days before, and a count for each day.
 * They are asked for again whenever `refreshKey` changes, and the ones on
 * screen stay while newer ones are on their way.
 */
export function useHeadline(siteId: string | null, days: number, refreshKey: string | number | undefined) {
  const [data, setData] = useState<HeadlineData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteId) return;
    let live = true;
    api<HeadlineData>(`/sites/${siteId}/metrics?days=${days}`)
      .then((result) => live && (setData(result), setError(null)))
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [siteId, days, refreshKey]);

  return { data, error: data ? null : error };
}

/** The four numbers, in a row. While another range loads, the numbers on screen stay, dimmed, so nothing jumps. */
export function HeadlineTiles({ data, days, error }: { data: HeadlineData | null; days: number; error?: string | null }) {
  if (error && !data) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">{error}</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-[148px] rounded-xl" />
        ))}
      </div>
    );
  }
  const stale = data.days !== days;
  const period = `the previous ${data.days} days`;
  const rate = (p: HeadlineData["now"]) => (p.counted ? p.countedFinished / p.counted : null);
  const { now, before } = data;
  const finishRate = rate(now);

  return (
    <div className={cn("grid grid-cols-1 gap-4 transition-opacity duration-200 sm:grid-cols-2 xl:grid-cols-4", stale && "opacity-60")} aria-busy={stale}>
      <Tile label="Guides finished" better="up" value={now.finished.toLocaleString()} about="Guides where the person reached the end. The number billing counts, free during early access." change={countChange(now.finished, before.finished, period)} />
      <Tile
        label="Finish rate"
        better="up"
        value={finishRate === null ? null : `${Math.round(finishRate * 100)}%`}
        empty="No guides to count yet"
        about="Of the questions Haptic could guide, the share that finished."
        change={rateChange(finishRate, rate(before), period)}
      />
      <Tile
        label="Couldn't guide"
        better="down"
        value={now.unguided.toLocaleString()}
        about="Questions Haptic couldn't guide: stuck, not in the help docs, given up on, or said it didn't help."
        context={now.started ? `${Math.round((now.unguided / now.started) * 100)}% of ${now.started.toLocaleString()} questions` : undefined}
        change={countChange(now.unguided, before.unguided, period)}
      />
      <Tile
        label="Median time to finish"
        better="down"
        value={now.medianMsToFinish === null ? null : duration(now.medianMsToFinish)}
        empty="No finished guides yet"
        about="From the question to the last step."
        change={durationChange(now.medianMsToFinish, before.medianMsToFinish, period)}
      />
    </div>
  );
}

/**
 * Guides started and finished, a bar for each day of the range. When the numbers couldn't be had, the panel says
 * why in place of the chart, as the tiles above it do, instead of holding a chart's place for good.
 */
export function HeadlineChart({ data, error }: { data: HeadlineData | null; error?: string | null }) {
  const failed = !data && error;
  return (
    <Panel
      title={
        <>
          Guides each day <span className="text-sm font-normal text-muted-foreground">in UTC</span>
        </>
      }
      aside={
        !failed && (
          <ul className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground" aria-hidden />
              Started
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-foreground" aria-hidden />
              Finished
            </li>
          </ul>
        )
      }
    >
      {failed ? <PanelEmpty>{error}</PanelEmpty> : <div className="px-5 pb-4">{data ? <DailyChart daily={data.daily} /> : <Skeleton className="h-[168px]" />}</div>}
    </Panel>
  );
}

/** The change as two parts: what moved, such as "Up 12%", and against what, such as "on the previous 30 days". */
function partsOf(text: string): [string, string] {
  const found = /^(.*?) ((?:on|as|in|than) the previous .*)$/.exec(text);
  return found ? [found[1]!, found[2]!] : [text, ""];
}

/**
 * One number, with its name above it. What the number counts is one press or
 * hover away, on the small mark beside the name, and not spelled out on every
 * tile. Under the number is which way it moved against the days before: green
 * when that is the way it should go, red when it is not, grey when it did not
 * move. `better` says which way is good, since more finished guides is good
 * and more questions Haptic couldn't guide is not. The arrow and the words say
 * the same as the colour, so nobody has to tell red from green to read it.
 */
function Tile({
  label,
  value,
  empty = "None yet",
  about,
  context,
  change,
  better,
}: {
  label: string;
  value: string | null;
  empty?: string;
  /** What the number counts, for the mark beside its name. */
  about: string;
  /** A few words of the number's own, such as what it is a share of. */
  context?: string;
  change: Change | null;
  better: "up" | "down";
}) {
  const Icon = change?.direction === "up" ? ArrowUpRight : change?.direction === "down" ? ArrowDownRight : Minus;
  const tone = !change || change.direction === "same" ? "text-muted-foreground" : change.direction === better ? "text-success" : "text-destructive";
  const [moved, against] = change ? partsOf(change.text) : ["", ""];
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-5" data-metric={label}>
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        <About label={label}>{about}</About>
      </span>
      {value === null ? (
        <span className="text-2xl font-medium tracking-[-0.02em] text-muted-foreground">{empty}</span>
      ) : (
        // Keyed by the number, so a new one arrives from just below. That is the only sign the page gives that it changed.
        <span key={value} className="text-4xl font-medium tracking-[-0.03em] motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
          {value}
        </span>
      )}
      {change && (
        <span className="flex items-start gap-1 text-sm">
          <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden />
          <span>
            <span className={cn("font-medium", tone)}>{moved}</span>
            {against && <span className="text-muted-foreground"> {against}</span>}
          </span>
        </span>
      )}
      {context && <span className="text-xs leading-4 text-muted-foreground">{context}</span>}
    </div>
  );
}

/**
 * What a number counts, in an Ink bubble on the small mark beside its name: one hover away with a mouse, and one
 * press away on a touch screen or from the keyboard, where a second press or a press elsewhere puts it away. It is a
 * popover and not a tooltip, since a tooltip never opens on a touch screen. The mark is 14px, and what answers a
 * press is 24px across around it, held to the label's line so the tile doesn't grow.
 */
function About({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={0}
        aria-label={`What ${label.toLowerCase()} counts`}
        className="-mx-1 -my-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Info className="size-3.5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={4} className="isolate z-50">
          <Popover.Popup className="z-50 w-fit max-w-xs origin-(--transform-origin) rounded-md bg-foreground px-3 py-1.5 text-xs text-background outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            {children}
            <Popover.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=top]:-bottom-2.5" />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** For a site no one has asked anything yet: what the top of the dashboard will hold, and when. */
export function HeadlineWaiting({ origin }: { origin?: string }) {
  const items = [
    ["Guides finished", "Each guide where the person reached the end. The number billing counts, free during early access."],
    ["Finish rate", "Of the questions Haptic could guide, the share that finished."],
    ["Couldn't guide", "Questions Haptic couldn't guide: stuck, not in your help docs, given up on, or said it didn't help. What to fix first."],
    ["Median time to finish", "From the question to the last step."],
  ];
  return (
    <section className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-medium">Your numbers start with the first question</h2>
          <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
            A minute after someone asks Haptic something{origin ? ` on ${hostOf(origin)}` : ""}, these show here, each against the days before, with a chart
            of every day. Try it yourself to see the first one.
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-card p-5 sm:grid-cols-2">
          {items.map(([name, what]) => (
            <div key={name} className="flex flex-col gap-1">
              <dt className="text-sm font-medium">{name}</dt>
              <dd className="text-sm leading-5 text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
        {origin && (
          <a href={origin} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "xl", className: "self-start" })}>
            Ask Haptic something on {hostOf(origin)}
            <ExternalLink />
          </a>
        )}
      </Card>
    </section>
  );
}

const HEIGHT = 168;
const AXIS = 36;
const BOTTOM = 24;
const TOP = 8;

/** The largest value rounded up to a clean axis top: 1, 2, 5 or 10 times a power of ten. */
function niceTop(max: number): number {
  if (max <= 4) return Math.max(max, 1);
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

/** The chart's days are UTC days, named in UTC, so the last one is named by its date, not "Today". */
const dayName = (day: string, short = false) => utcDayLabel(day, undefined, !short);

/** One column per day: started in Muted text grey, finished in Ink over it from the same baseline. */
function DailyChart({ daily }: { daily: HeadlineData["daily"] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]!.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const top = niceTop(Math.max(0, ...daily.map((day) => Math.max(day.started, day.finished))));
  const plot = Math.max(0, width - AXIS);
  const band = daily.length ? plot / daily.length : 0;
  const bar = Math.max(1, Math.min(24, band - 2));
  const y = (value: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - value / top);
  const base = y(0);
  const column = (x: number, value: number) => {
    const h = base - y(value);
    if (h <= 0) return "";
    const r = Math.min(4, h, bar / 2);
    return `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + bar - r}Q${x + bar},${base - h} ${x + bar},${base - h + r}V${base}Z`;
  };
  const ticks = top <= 4 ? [0, top] : [0, top / 2, top];
  const shown = active === null ? null : daily[active];
  const total = daily.reduce((sum, day) => ({ started: sum.started + day.started, finished: sum.finished + day.finished }), { started: 0, finished: 0 });

  return (
    <div ref={box} className="relative" data-daily-chart>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Guides each day over the last ${daily.length} days: ${total.started} started, ${total.finished} finished. The table below has every day.`}
          tabIndex={0}
          className="block rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onFocus={() => setActive(daily.length - 1)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setActive((index) => Math.max(0, (index ?? daily.length) - 1));
            if (event.key === "ArrowRight") setActive((index) => Math.min(daily.length - 1, (index ?? -1) + 1));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={AXIS} x2={width} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={AXIS - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-xs tabular-nums">
                {tick.toLocaleString()}
              </text>
            </g>
          ))}
          {daily.map((day, index) => {
            const x = AXIS + index * band + (band - bar) / 2;
            return (
              <g key={day.day}>
                {active === index && <rect x={AXIS + index * band} y={TOP} width={band} height={base - TOP} className="fill-muted" />}
                <path d={column(x, day.started)} className="fill-muted-foreground" />
                <path d={column(x, Math.min(day.finished, top))} className="fill-foreground" />
                <rect x={AXIS + index * band} y={0} width={band} height={HEIGHT} fill="transparent" onPointerEnter={() => setActive(index)} />
              </g>
            );
          })}
          {daily.length > 0 && (
            <>
              <text x={AXIS} y={HEIGHT - 6} className="fill-muted-foreground text-xs">
                {dayName(daily[0]!.day, true)}
              </text>
              <text x={width} y={HEIGHT - 6} textAnchor="end" className="fill-muted-foreground text-xs">
                {dayName(daily[daily.length - 1]!.day, true)}
              </text>
            </>
          )}
        </svg>
      )}
      {shown && active !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 flex -translate-x-1/2 flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm"
          style={{ left: Math.min(Math.max(AXIS + active * band + band / 2, 90), width - 90) }}
          role="status"
        >
          <span className="text-xs text-muted-foreground">{dayName(shown.day)}</span>
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full bg-muted-foreground" aria-hidden />
            <span className="font-medium">{shown.started.toLocaleString()}</span>
            <span className="text-muted-foreground">started</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full bg-foreground" aria-hidden />
            <span className="font-medium">{shown.finished.toLocaleString()}</span>
            <span className="text-muted-foreground">finished</span>
          </span>
        </div>
      )}
      <div className="sr-only">
      <table>
        <caption>Guides started and finished each day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Started</th>
            <th>Finished</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((day) => (
            <tr key={day.day}>
              <td>{dayName(day.day)}</td>
              <td>{day.started}</td>
              <td>{day.finished}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
