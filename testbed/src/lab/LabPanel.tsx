import { FlaskConical, RotateCcw, X } from "lucide-react";
import { useEffect } from "react";
import { resetData } from "@/data/store";
import type { Plan, Role } from "@/data/types";
import { PLAN_LABELS, ROLE_LABELS } from "@/lib/access";
import { useLab, type Latency, type Locale, type NavVariant, type Theme } from "./lab";

// The test panel. It sits outside the app's own UI, bottom left, and uses
// plain elements so it looks like a dev tool and not part of Northpine.
// Every setting can also be set from the URL: ?lab.role=employee

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-[12px]">
      <span className="text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function Pick<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-6 rounded border border-zinc-700 bg-zinc-800 px-1 text-[12px] text-zinc-100">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-emerald-500" />;
}

export function LabPanel() {
  const s = useLab();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") s.set({ open: !useLab.getState().open });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  if (!s.open)
    return s.labButton ? (
      <button
        type="button"
        data-lab
        onClick={() => s.set({ open: true })}
        title="Test panel (Ctrl+Shift+L)"
        className="fixed bottom-3 left-[calc(var(--sidebar-w,0px)+12px)] z-[80] grid size-8 cursor-pointer place-items-center rounded-full bg-zinc-900 text-zinc-300 opacity-60 shadow-lg hover:opacity-100"
      >
        <FlaskConical className="size-4" />
        <span className="sr-only">Open test panel</span>
      </button>
    ) : null;

  return (
    <aside data-lab aria-label="Test panel" className="fixed bottom-3 left-3 z-[80] max-h-[85vh] w-72 overflow-y-auto rounded-lg bg-zinc-900 p-3 font-mono text-zinc-100 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold">
          <FlaskConical className="size-3.5" /> Test panel
        </span>
        <button type="button" onClick={() => s.set({ open: false })} className="cursor-pointer text-zinc-400 hover:text-zinc-100">
          <X className="size-4" />
          <span className="sr-only">Close test panel</span>
        </button>
      </div>

      <p className="mt-2 mb-1 text-[10px] tracking-wider text-zinc-500 uppercase">Who and what</p>
      <Row label="Role">
        <Pick<Role> value={s.role} onChange={(role) => s.set({ role })} options={(Object.keys(ROLE_LABELS) as Role[]).map((r) => [r, ROLE_LABELS[r]])} />
      </Row>
      <Row label="Plan">
        <Pick<Plan> value={s.plan} onChange={(plan) => s.set({ plan })} options={(Object.keys(PLAN_LABELS) as Plan[]).map((p) => [p, PLAN_LABELS[p]])} />
      </Row>

      <p className="mt-3 mb-1 text-[10px] tracking-wider text-zinc-500 uppercase">Network</p>
      <Row label="Latency">
        <Pick<Latency> value={s.latency} onChange={(latency) => s.set({ latency })} options={[["none", "None"], ["fast", "Fast (~200ms)"], ["slow", "Slow (~1.7s)"], ["random", "Random spikes"]]} />
      </Row>
      <Row label={`Failures ${Math.round(s.failureRate * 100)}%`}>
        <input type="range" min={0} max={0.5} step={0.05} value={s.failureRate} onChange={(e) => s.set({ failureRate: Number(e.target.value) })} className="w-24 accent-emerald-500" />
      </Row>

      <p className="mt-3 mb-1 text-[10px] tracking-wider text-zinc-500 uppercase">Layout</p>
      <Row label="Navigation">
        <Pick<NavVariant> value={s.nav} onChange={(nav) => s.set({ nav })} options={[["classic", "Classic"], ["renamed", "Renamed labels"], ["rail", "Icon rail"]]} />
      </Row>
      <Row label="Language">
        <Pick<Locale> value={s.locale} onChange={(locale) => s.set({ locale })} options={[["en", "English"], ["es", "Español (shell)"]]} />
      </Row>
      <Row label="Theme">
        <Pick<Theme> value={s.theme} onChange={(theme) => s.set({ theme })} options={[["light", "Light"], ["dark", "Dark"], ["system", "System"]]} />
      </Row>

      <p className="mt-3 mb-1 text-[10px] tracking-wider text-zinc-500 uppercase">Things in the way</p>
      <Row label="Native <dialog> modals">
        <Toggle value={s.nativeDialogs} onChange={(nativeDialogs) => s.set({ nativeDialogs })} />
      </Row>
      <Row label="Live activity feed">
        <Toggle value={s.liveFeed} onChange={(liveFeed) => s.set({ liveFeed })} />
      </Row>
      <Row label="Support chat bubble">
        <Toggle value={s.chatBubble} onChange={(chatBubble) => s.set({ chatBubble })} />
      </Row>
      <Row label="Fixed top banner">
        <Toggle value={s.banner} onChange={(banner) => s.set({ banner })} />
      </Row>
      <Row label="Lab button">
        <Toggle value={s.labButton} onChange={(labButton) => s.set({ labButton })} />
      </Row>

      <p className="mt-3 mb-1 text-[10px] tracking-wider text-zinc-500 uppercase">Haptic</p>
      <Row label="Load widget (reloads)">
        <Toggle
          value={s.widget}
          onChange={(widget) => {
            s.set({ widget });
            location.reload();
          }}
        />
      </Row>
      <input aria-label="Widget script URL" value={s.widgetSrc} onChange={(e) => s.set({ widgetSrc: e.target.value })} className="mt-1 h-6 w-full rounded border border-zinc-700 bg-zinc-800 px-1 text-[11px]" />
      <input aria-label="Widget site id" value={s.widgetSite} onChange={(e) => s.set({ widgetSite: e.target.value })} className="mt-1 h-6 w-full rounded border border-zinc-700 bg-zinc-800 px-1 text-[11px]" />

      <p className="mt-3 mb-1 text-[10px] tracking-wider text-zinc-500 uppercase">Data</p>
      <Row label="Seed">
        <input type="number" value={s.seed} onChange={(e) => s.set({ seed: Number(e.target.value) || 1 })} className="h-6 w-20 rounded border border-zinc-700 bg-zinc-800 px-1 text-[12px]" />
      </Row>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            resetData();
          }}
          className="flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded bg-zinc-800 text-[12px] hover:bg-zinc-700"
        >
          <RotateCcw className="size-3" /> Reset data
        </button>
        <button type="button" onClick={() => s.reset()} className="h-7 flex-1 cursor-pointer rounded bg-zinc-800 text-[12px] hover:bg-zinc-700">
          Reset panel
        </button>
      </div>
    </aside>
  );
}
