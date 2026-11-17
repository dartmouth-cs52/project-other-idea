"use client";

import { useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "cn";
import { FormAlert, failureFrom, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ControlName } from "@/lib/app-api";
import { hostOf, neverTouchList, neverTouchSuggestions, neverTouchTicked, type SuggestedControl } from "@/lib/setup";
import { Back, Primary, StepFrame } from "./frame";
import type { SetupSite } from "./types";
import type { SetupPages } from "./use-reading";

/** Pages listed before "Show all". */
const PAGES_SHOWN = 8;

const key = (item: { label: string }) => item.label.trim().toLowerCase();

/**
 * Step 3. What the reading found, and the controls Haptic should never point
 * at: what it found plus the usual ones. Until the list has been saved they all
 * start ticked. After that the ticks show what is saved. Continue saves exactly
 * the ticked ones among these, taking off any unticked, and leaves alone what
 * the owner ruled out elsewhere. Skip saves nothing.
 */
export function LearnedStep({ site, pages, onChange, onBack, onNext }: { site: SetupSite; pages: SetupPages; onChange: (site: SetupSite) => void; onBack: () => void; onNext: () => void }) {
  const reading = pages.reading;
  const host = hostOf(site.origin);
  const [all, setAll] = useState(false);
  // Added on this screen. The rest comes from the reading on every render, so controls it finds later still show.
  const [added, setAdded] = useState<SuggestedControl[]>([]);
  // What the person changed here, by name. Anything not changed shows what is saved.
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);

  const read = reading?.read ?? 0;
  const list = reading?.pages ?? [];
  const saved = Boolean(site.setup?.neverTouchSaved);
  const suggested = neverTouchSuggestions([...(reading?.risky ?? []), ...added]);
  const ticked = (item: SuggestedControl) => changed[key(item)] ?? neverTouchTicked(item, site.blocked, saved);
  const toggle = (item: SuggestedControl) => setChanged((now) => ({ ...now, [key(item)]: !ticked(item) }));

  function add(event: FormEvent) {
    event.preventDefault();
    const label = adding.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!label) return;
    if (!suggested.some((other) => key(other) === key({ label }))) setAdded((now) => [...now, { label }]);
    setChanged((now) => ({ ...now, [key({ label })]: true }));
    setAdding("");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const next = neverTouchList(suggested, suggested.filter(ticked), site.blocked) as ControlName[];
    const same = next.length === site.blocked.length && next.every((control, i) => key(control) === key(site.blocked[i]!) && (control.role ?? "") === (site.blocked[i]!.role ?? ""));
    try {
      let blocked = site.blocked;
      if (!same) blocked = (await api<{ blocked: ControlName[] }>(`/sites/${site.id}/blocked`, { method: "PUT", body: { controls: next } })).blocked;
      // From now on the ticks show what is saved, even if nothing is.
      const { setup } = await api<{ setup: SetupSite["setup"] }>(`/sites/${site.id}/setup`, { method: "PUT", body: { neverTouchSaved: true } });
      onChange({ ...site, blocked, setup });
      onNext();
    } catch (failure) {
      setError(failureFrom("Couldn't save the list", failure));
      setBusy(false);
    }
  }

  const lead =
    read === 0
      ? `Haptic couldn't read the public pages of ${host}. It learns each page from the live page once the script is on, so guides still work.`
      : `It read ${read} ${read === 1 ? "page" : "pages"} on ${host} and found ${(reading?.controls ?? 0).toLocaleString()} buttons, links and fields.${
          reading?.signIn ? ` Haptic learns the ${reading.signIn === 1 ? "page that needs" : `${reading.signIn} pages that need`} sign-in from the live page once the script is on, with no password.` : ""
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
      after={
        error && (
          <div className="max-w-xl">
            <FormAlert failure={error} />
          </div>
        )
      }
    >
      {list.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Pages read">
          <ul className="grid grid-cols-1 gap-x-6 gap-y-0 rounded-xl border bg-card px-4 py-2 sm:grid-cols-2">
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
            const on = ticked(item);
            return (
              <li key={`${item.role ?? ""} ${item.label}`}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(item)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    on ? "border-foreground/40 bg-card text-foreground" : "border-dashed bg-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  {on ? <Check className="size-4" /> : <Plus className="size-4" />}
                  {item.label}
                  {item.path && <span className="font-normal text-muted-foreground">{item.path}</span>}
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
      </section>
    </StepFrame>
  );
}
