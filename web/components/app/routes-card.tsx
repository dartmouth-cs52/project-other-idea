"use client";

import { useState } from "react";
import { FormAlert, failureFrom, type Failure } from "@/components/form";
import { api, type RouteMetrics, type Site } from "@/lib/app-api";
import { Card, CardTitle, Segmented, seconds } from "./parts";

const MODES: { value: Site["routesMode"]; name: string; says: string }[] = [
  { value: "off", name: "Off", says: "Haptic asks the model at every step and keeps no routes." },
  {
    value: "shadow",
    name: "Watch only",
    says: "Haptic keeps routes and checks each one against the model, but the model always answers. The numbers above come from this.",
  },
  {
    value: "serve",
    name: "Answer from routes",
    says: "A route that finished guides on several networks confirmed answers on its own, when exactly one control on the page matches it. Anything else goes to the model, and so does a step your corrections or a taught route cover. A No to Did this help sends that route back to the model too.",
  },
];

/**
 * How often the same question comes up on the same screen, and whether
 * answering it from a verified route would be right (src/server/routes.ts).
 * Leads to the switch that turns serving on, which is worth it only when both
 * numbers are high.
 */
export function RoutesCard({ site, metrics, onChange }: { site: Site; metrics: RouteMetrics; onChange: (site: Site) => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "No data yet");
  const compared = metrics.agreed + metrics.disagreed;
  const mode = site.routesMode;
  const current = MODES.find((item) => item.value === mode) ?? MODES[1]!;

  async function choose(next: Site["routesMode"]) {
    if (next === mode || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { routesMode: next } }));
    } catch (failure) {
      setFailure(failureFrom("Couldn't change how routes are used", failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Questions asked again</CardTitle>
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        When the same question comes up on the same screen, Haptic can point from a route that finished guides on several networks confirmed,
        without asking the model. The pointer moves sooner and the step costs nothing.
      </p>
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Asked before on the same page", value: share(metrics.repeated_guides, metrics.guides) },
          { label: "Steps with a saved route", value: share(metrics.repeats, metrics.looked_up) },
          { label: "Steps that could skip the model", value: share(metrics.servable, metrics.looked_up) },
          { label: "Model agreed with the route", value: share(metrics.agreed, compared) },
        ].map((item) => (
          <div key={item.label} className="flex flex-col gap-1 bg-card p-4">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="text-2xl font-medium tracking-[-0.02em] tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      {metrics.served > 0 && (
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          {metrics.served.toLocaleString()} {metrics.served === 1 ? "step was" : "steps were"} answered from saved routes. The pointer moved after{" "}
          {seconds(metrics.served_ms)}, against {seconds(metrics.model_ms)} when the model answered. People used the control {share(metrics.served_used, metrics.served)} of
          the time.
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Segmented label="Saved routes" value={mode} onChange={(next) => void choose(next)} options={MODES} />
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">{current.says}</p>
        {mode !== "serve" && (
          <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
            Turn on Answer from routes once a fair share of steps could skip the model and it agrees with its routes nearly every time.
          </p>
        )}
        <FormAlert failure={failure} />
      </div>
    </Card>
  );
}
