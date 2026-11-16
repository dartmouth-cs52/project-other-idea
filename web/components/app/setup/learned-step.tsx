"use client";

import { useState, type FormEvent } from "react";
import { AlertCircleIcon, Check, Plus } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ControlName } from "@/lib/app-api";
import { hostOf, neverTouchSuggestions, type SuggestedControl } from "@/lib/setup";
import { Back, Primary, StepFrame } from "./frame";
import type { SetupSite } from "./types";
import type { SetupPages } from "./use-reading";

/** Pages listed before "Show all". */
const PAGES_SHOWN = 8;

const sameControl = (a: { label: string; role?: string }, b: { label: string; role?: string }) => a.label.toLowerCase() === b.label.toLowerCase() && (a.role ?? "") === (b.role ?? "");

/**
 * Step 3. What the reading found, and the controls Haptic should never point
 * at, filled in from what it found plus the usual ones. Continue saves them to
 * the site's "Never point at" list. Skip saves nothing.
 */
export function LearnedStep({ site, pages, onChange, onBack, onNext }: { site: SetupSite; pages: SetupPages; onChange: (site: SetupSite) => void; onBack: () => void; onNext: () => void }) {
  const reading = pages.reading;
  const host = hostOf(site.origin);
  const [all, setAll] = useState(false);
  const [suggested, setSuggested] = useState<SuggestedControl[]>(() => neverTouchSuggestions(reading?.risky ?? []));
  const [chosen, setChosen] = useState<SuggestedControl[]>(() => neverTouchSuggestions(reading?.risky ?? []));
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = reading?.read ?? 0;
  const list = reading?.pages ?? [];
  const toggle = (item: SuggestedControl) => setChosen((now) => (now.some((other) => sameControl(other, item)) ? now.filter((other) => !sameControl(other, item)) : [...now, item]));

  function add(event: FormEvent) {
    event.preventDefault();
    const label = adding.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!label) return;
    const item = { label };
    if (!suggested.some((other) => sameControl(other, item))) setSuggested((now) => [...now, item]);
    if (!chosen.some((other) => sameControl(other, item))) setChosen((now) => [...now, item]);
    setAdding("");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const merged: ControlName[] = [...site.blocked];
    for (const item of chosen) if (!merged.some((other) => sameControl(other, item))) merged.push(item.role ? { role: item.role, label: item.label } : { label: item.label });
    try {
      if (merged.length !== site.blocked.length) {
        const result = await api<{ blocked: ControlName[] }>(`/sites/${site.id}/blocked`, { method: "PUT", body: { controls: merged } });
        onChange({ ...site, blocked: result.blocked });
      }
      onNext();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  const lead =
    read === 0
      ? `Haptic couldn't read the public pages of ${host}. It learns each page from the live page once the script is on, so guides still work.`
      : `It read ${read} ${read === 1 ? "page" : "pages"} on ${host} and found ${(reading?.controls ?? 0).toLocaleString()} buttons, links and fields.${
          reading?.signIn ? ` ${reading.signIn} ${reading.signIn === 1 ? "page looks" : "pages look"} like ${reading.signIn === 1 ? "it needs" : "they need"} sign-in. Haptic learns those from the live page once the script is on, with no password.` : ""
        }`;

  return (
    <StepFrame
      step="learned"
      title="Here's what Haptic learned"
      lead={lead}
      actions={
        <>
          <Back onClick={onBack} />
          <Primary onClick={save} disabled={busy}>
            {busy ? "Saving" : "Continue"}
          </Primary>
          <Button variant="ghost" size="xl" onClick={onNext}>
            Skip
          </Button>
        </>
      }
    >
      {list.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Pages read">
          <ul className="grid gap-x-6 gap-y-0 rounded-xl border bg-card px-4 py-2 sm:grid-cols-2">
            {(all ? list : list.slice(0, PAGES_SHOWN)).map((page) => (
              <li key={page.path} className="flex min-w-0 items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{page.title || page.path}</span>
                  <span className="text-muted-foreground"> {page.path}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {list.length > PAGES_SHOWN && (
              <Button variant="ghost" size="sm" onClick={() => setAll(!all)} aria-expanded={all}>
                {all ? "Show fewer" : `Show all ${list.length}`}
              </Button>
            )}
            {!reading?.done && <span>Still reading. More pages show up here as they are read.</span>}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="never-touch">
        <div className="flex flex-col gap-1">
          <h2 id="never-touch" className="text-2xl font-medium tracking-[-0.02em]">
            Never touch <span className="text-base font-normal text-muted-foreground">optional</span>
          </h2>
          <p className="max-w-[60ch] text-base leading-6 text-muted-foreground">
            Haptic never points at a control with one of these names. If someone asks for one, it says it can&apos;t help with that here. You can change
            this any time on your dashboard.
          </p>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Controls to never point at">
          {suggested.map((item) => {
            const on = chosen.some((other) => sameControl(other, item));
            return (
              <li key={`${item.role ?? ""} ${item.label}`}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(item)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted",
                  )}
                >
                  {on ? <Check className="size-4" /> : <Plus className="size-4 text-muted-foreground" />}
                  {item.label}
                  {item.path && <span className={cn("font-normal", on ? "text-primary-foreground/70" : "text-muted-foreground")}>{item.path}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <form onSubmit={add} className="flex max-w-md gap-2">
          <Input
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            placeholder="Add another, such as Delete workspace"
            aria-label="Add a control to never point at"
            className="h-9 rounded-full bg-card px-3.5"
          />
          <Button type="submit" variant="secondary" size="lg" disabled={!adding.trim()}>
            Add
          </Button>
        </form>
        {error && (
          <Alert variant="destructive" className="max-w-xl">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </section>
    </StepFrame>
  );
}
