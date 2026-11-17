"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/app-api";
import { countChange, duration, durationChange, hostOf, rateChange, utcDayLabel, type Change } from "@/lib/setup";
import type { Headline as HeadlineData } from "@/worker/insights";
import { Card } from "./parts";

/**
 * The top of a site's dashboard: four numbers for the chosen range, each
 * against the same number of days before, and a small chart of guides started
 * and finished each day. A site nobody has asked anything yet says what will
 * show here and when, rather than a row of zeros.
 */
export function Headline({ siteId, origin, days, ranges, refreshKey }: { siteId: string; origin?: string; days: number; ranges: ReactNode; refreshKey: number }) {
  const [data, setData] = useState<HeadlineData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<HeadlineData>(`/sites/${siteId}/metrics?days=${days}`)
      .then((result) => live && (setData(result), setError(null)))
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [siteId, days, refreshKey]);

  const title = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-2xl font-medium tracking-[-0.02em]">Last {days} days</h2>
      {ranges}
    </div>
  );

  if (error && !data) {
    return (
      <section className="flex flex-col gap-4">
        {title}
        <Card>
          <p className="text-base text-muted-foreground">{error}</p>
        </Card>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="flex flex-col gap-4">
        {title}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="h-[148px] rounded-xl border bg-muted" />
          ))}
        </div>
      </section>
    );
  }
  if (!data.asked) return <Waiting origin={origin} title={title} />;

  // While another range loads, the numbers on screen stay, dimmed, so nothing jumps.
  const stale = data.days !== days;
  const period = `the previous ${data.days} days`;
  const rate = (p: HeadlineData["now"]) => (p.counted ? p.countedFinished / p.counted : null);
  const { now, before } = data;
  const finishRate = rate(now);

  return (
    <section className={cn("flex flex-col gap-4 transition-opacity duration-200", stale && "opacity-60")} aria-busy={stale}>
      {title}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Guides finished" value={now.finished.toLocaleString()} note="The number billing counts. Free during early access." change={countChange(now.finished, before.finished, period)} />
        <Tile
          label="Finish rate"
          value={finishRate === null ? null : `${Math.round(finishRate * 100)}%`}
          empty="No guides to count yet"
          note="Of the questions Haptic could guide, the share that finished."
          change={rateChange(finishRate, rate(before), period)}
        />
        <Tile
          label="Questions Haptic couldn't guide"
          value={now.unguided.toLocaleString()}
          note={now.started ? `${Math.round((now.unguided / now.started) * 100)}% of ${now.started.toLocaleString()} questions. Stuck, not in the help docs, given up on, or said it didn't help.` : "Stuck, not in the help docs, given up on, or said it didn't help."}
          change={countChange(now.unguided, before.unguided, period)}
        />
        <Tile
          label="Median time to finish"
          value={now.medianMsToFinish === null ? null : duration(now.medianMsToFinish)}
          empty="No finished guides yet"
          note="From the question to the last step."
          change={durationChange(now.medianMsToFinish, before.medianMsToFinish, period)}
        />
      </div>
      <Card className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <h3 className="text-base font-medium">
            Guides started and finished, each day <span className="text-sm font-normal text-muted-foreground">in UTC</span>
          </h3>
          <ul className="flex items-center gap-4 text-sm text-muted-foreground" aria-label="Legend">
            <li className="flex items-center gap-2">
              <span className="size-2.5 rounded-[2px] bg-muted-foreground" aria-hidden />
              Started
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2.5 rounded-[2px] bg-foreground" aria-hidden />
              Finished
            </li>
          </ul>
        </div>
        <DailyChart daily={data.daily} />
      </Card>
    </section>
  );
}

function Tile({ label, value, empty = "None yet", note, change }: { label: string; value: string | null; empty?: string; note: string; change: Change | null }) {
  const Icon = change?.direction === "up" ? ArrowUpRight : change?.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted p-6" data-metric={label}>
      {/* Two lines kept for the label, so the numbers line up across the row when one label wraps. */}
      <span className="text-sm font-medium text-muted-foreground sm:min-h-10">{label}</span>
      {value === null ? <span className="text-2xl font-medium tracking-[-0.02em] text-muted-foreground">{empty}</span> : <span className="text-4xl font-medium tracking-[-0.03em]">{value}</span>}
      {change && (
        <span className="flex items-start gap-1 text-sm text-foreground">
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {change.text}
        </span>
      )}
      <span className="text-xs leading-4 text-muted-foreground">{note}</span>
    </div>
  );
}

/** For a site no one has asked anything yet: what the top of the dashboard will hold, and when. */
function Waiting({ origin, title }: { origin?: string; title: ReactNode }) {
  const items = [
    ["Guides finished", "Each guide where the person reached the end. The number billing counts, free during early access."],
    ["Finish rate", "Of the questions Haptic could guide, the share that finished."],
    ["Questions Haptic couldn't guide", "Stuck, not in your help docs, given up on, or said it didn't help. What to fix first."],
    ["Median time to finish", "From the question to the last step."],
  ];
  return (
    <section className="flex flex-col gap-4">
      {title}
      <Card>
        <div className="flex flex-col gap-2">
          <h3 className="text-2xl font-medium tracking-[-0.02em]">Your numbers start with the first question</h3>
          <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
            A minute after someone asks Haptic something{origin ? ` on ${hostOf(origin)}` : ""}, these show here, each against the days before, with a chart
            of every day. Try it yourself to see the first one.
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-4 rounded-lg border bg-card p-5 sm:grid-cols-2">
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
      <table className="sr-only">
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
  );
}
