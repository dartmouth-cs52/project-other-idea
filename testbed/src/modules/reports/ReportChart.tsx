import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { formatCompact, formatValue, type ChartKind, type Metric, type Result } from "./engine";

export const PALETTE = ["#17633a", "#3fae6c", "#8fd1a8", "#2456b8", "#7aa5f5", "#a15c00", "#f0a637", "#7d8781"];

const axis = { fontSize: 11, fill: "var(--np-ink-3)" };

/** recharts draws SVG, so the bars are in the DOM but carry no labels of their own. */
export function ReportChart({ result, chart, metric, timeSeries }: { result: Result; chart: ChartKind; metric: Metric; timeSeries: boolean }) {
  const top = timeSeries ? result.rows : result.rows.slice(0, 12);
  const data = top.map((r) => ({ name: r.label, value: Math.round(r.value * 100) / 100 }));
  const tooltip = <Tooltip formatter={(v) => formatValue(Number(v), metric)} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--np-line)", background: "var(--np-panel)" }} />;
  if (!data.length) return <p className="grid h-72 place-items-center text-[13px] text-ink-3">No transactions match these filters.</p>;

  if (chart === "pie") {
    const sorted = result.rows.slice(0, 7);
    const rest = result.rows.slice(7).reduce((s, r) => s + r.value, 0);
    const pie = [...sorted.map((r) => ({ name: r.label, value: r.value })), ...(rest > 0 ? [{ name: "Other", value: rest }] : [])];
    return (
      <div className="flex flex-col items-center gap-4 md:flex-row">
        <div className="h-72 w-full md:w-1/2">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius={60} outerRadius={110} paddingAngle={1} stroke="none">
                {pie.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              {tooltip}
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex w-full flex-col gap-1.5 md:w-1/2">
          {pie.map((d, i) => (
            <li key={d.name} className="flex items-center gap-2 text-[12.5px]">
              <span className="size-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="flex-1 truncate text-ink-2">{d.name}</span>
              <span className="tabular">{formatValue(d.value, metric)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 8 } };
  const x = <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: "var(--np-line)" }} interval={timeSeries ? "preserveStartEnd" : 0} angle={timeSeries ? 0 : -25} textAnchor={timeSeries ? "middle" : "end"} height={timeSeries ? 28 : 70} />;
  const y = <YAxis tick={axis} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => formatCompact(Number(v), metric)} />;
  const grid = <CartesianGrid stroke="var(--np-line)" vertical={false} />;
  return (
    <div className="h-80">
      <ResponsiveContainer>
        {chart === "line" ? (
          <LineChart {...common}>
            {grid}
            {x}
            {y}
            {tooltip}
            <Line type="monotone" dataKey="value" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
          </LineChart>
        ) : chart === "area" ? (
          <AreaChart {...common}>
            <defs>
              <linearGradient id="report-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PALETTE[0]} stopOpacity={0.35} />
                <stop offset="100%" stopColor={PALETTE[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            {grid}
            {x}
            {y}
            {tooltip}
            <Area type="monotone" dataKey="value" stroke={PALETTE[0]} strokeWidth={2} fill="url(#report-area)" />
          </AreaChart>
        ) : (
          <BarChart {...common}>
            {grid}
            {x}
            {y}
            {tooltip}
            <Bar dataKey="value" fill={PALETTE[0]} radius={[3, 3, 0, 0]} maxBarSize={44} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** The result as a plain table: group, value, transactions, share. */
export function ResultTable({ result, metric, groupLabel }: { result: Result; metric: Metric; groupLabel: string }) {
  const [all, setAll] = useState(false);
  const rows = all ? result.rows : result.rows.slice(0, 25);
  const share = metric === "sum" ? result.rows.reduce((s, r) => s + r.value, 0) : 0;
  return (
    <div>
      <div className="max-h-[520px] overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-sunken text-left text-[12px] text-ink-3">
            <tr>
              <th className="px-4 py-2 font-medium">{groupLabel}</th>
              <th className="px-4 py-2 text-right font-medium">{metric === "count" ? "Transactions" : metric === "average" ? "Average" : "Spend"}</th>
              {metric !== "count" ? <th className="px-4 py-2 text-right font-medium">Transactions</th> : null}
              {share ? <th className="w-40 px-4 py-2 font-medium">Share</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line last:border-0 hover:bg-sunken/50">
                <td className="max-w-80 truncate px-4 py-2">{r.label}</td>
                <td className="tabular px-4 py-2 text-right">{formatValue(r.value, metric)}</td>
                {metric !== "count" ? <td className="tabular px-4 py-2 text-right text-ink-2">{r.count.toLocaleString()}</td> : null}
                {share ? (
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(0, (r.value / share) * 100)}%` }} />
                      </span>
                      <span className="tabular w-10 text-right text-xs text-ink-3">{Math.round((r.value / share) * 100)}%</span>
                    </span>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length > 25 ? (
        <div className="border-t border-line px-4 py-2">
          <Button variant="link" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer rows" : `Show all ${result.rows.length} rows`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Two groupings make a pivot: one per row, one per column. With months across
 * the top it is far wider than the page, so it scrolls sideways with the first
 * column stuck in place. Columns past the right edge are off screen, on purpose.
 */
export function PivotTable({ result, metric, rowLabel }: { result: Result; metric: Metric; rowLabel: string }) {
  const pivot = result.pivot!;
  const colTotals = pivot.cols.map((c) => pivot.rows.reduce((s, r) => s + (pivot.cells.get(`${r.key}\u0000${c.key}`) ?? 0), 0));
  return (
    <div className="max-h-[560px] overflow-auto" role="region" aria-label="Pivot table" tabIndex={0}>
      <table className="border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 min-w-56 border-r border-b border-line bg-sunken px-3 py-2 text-left font-medium text-ink-3">{rowLabel}</th>
            {pivot.cols.map((c) => (
              <th key={c.key} className="sticky top-0 z-10 min-w-28 border-b border-line bg-sunken px-3 py-2 text-right font-medium whitespace-nowrap text-ink-3">
                {c.label}
              </th>
            ))}
            <th className="sticky top-0 z-10 min-w-28 border-b border-l border-line bg-sunken px-3 py-2 text-right font-semibold text-ink-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {pivot.rows.map((r) => (
            <tr key={r.key} className="group">
              <th scope="row" className="sticky left-0 z-10 max-w-64 truncate border-r border-b border-line bg-panel px-3 py-1.5 text-left font-normal group-hover:bg-sunken">
                {r.label}
              </th>
              {pivot.cols.map((c) => {
                const v = pivot.cells.get(`${r.key}\u0000${c.key}`);
                return (
                  <td key={c.key} className={cn("tabular border-b border-line px-3 py-1.5 text-right whitespace-nowrap group-hover:bg-sunken/60", !v && "text-ink-3")}>
                    {formatValue(v ?? 0, metric)}
                  </td>
                );
              })}
              <td className="tabular border-b border-l border-line px-3 py-1.5 text-right font-medium whitespace-nowrap group-hover:bg-sunken/60">{formatValue(r.total, metric)}</td>
            </tr>
          ))}
        </tbody>
        {metric !== "average" ? (
          <tfoot>
            <tr>
              <th className="sticky bottom-0 left-0 z-20 border-t border-r border-line bg-sunken px-3 py-2 text-left font-semibold">Total</th>
              {colTotals.map((v, i) => (
                <td key={i} className="tabular sticky bottom-0 border-t border-line bg-sunken px-3 py-2 text-right font-medium whitespace-nowrap">
                  {formatValue(v, metric)}
                </td>
              ))}
              <td className="tabular sticky bottom-0 border-t border-l border-line bg-sunken px-3 py-2 text-right font-semibold whitespace-nowrap">{formatValue(result.total, metric)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
