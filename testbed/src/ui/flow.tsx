import { Check, Lock, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { toast } from "sonner";
import { simulate } from "@/data/store";
import type { Plan } from "@/data/types";
import { useCan, useFeature, PLAN_LABELS, type Action, type Feature } from "@/lib/access";
import { cn } from "@/lib/cn";
import { useLab, latencyMs } from "@/lab/lab";
import { Button, Tooltip } from "./button";
import { ErrorState, LoadingBlock } from "./display";
import { ConfirmDialog } from "./overlay";

// Pieces of multi-step and save flows: the wizard stepper, the sticky save bar,
// the leave-without-saving guard, role and plan gates, the simulated loader and
// the toast helpers.

/** Steps across the top of a wizard. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full border text-[12px] font-semibold",
              i < current ? "border-brand bg-brand text-brand-ink" : i === current ? "border-brand text-brand" : "border-line-strong text-ink-3",
            )}
          >
            {i < current ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
          </span>
          <span className={cn("text-[13px] whitespace-nowrap", i === current ? "font-medium text-ink" : "text-ink-3")}>{s}</span>
          {i < steps.length - 1 ? <span className="mx-1 h-px w-6 bg-line-strong" /> : null}
        </li>
      ))}
    </ol>
  );
}

/** "Step 2 of 4", for wizards that don't show a stepper. */
export const stepOf = (i: number, n: number) => `Step ${i + 1} of ${n}`;

/**
 * A bar fixed to the bottom of the screen while a form has unsaved changes.
 * It covers whatever is under it, which is the point.
 */
export function SaveBar({ dirty, saving, onSave, onDiscard, message = "You have unsaved changes" }: { dirty: boolean; saving?: boolean; onSave: () => void; onDiscard: () => void; message?: string }) {
  if (!dirty) return null;
  return (
    <div role="region" aria-label="Unsaved changes" className="fixed inset-x-0 bottom-0 z-40 flex animate-in justify-center px-4 pb-4 md:left-[var(--sidebar-w,0px)]">
      <div className="flex w-full max-w-3xl items-center justify-between gap-4 rounded-lg bg-ink px-4 py-2.5 text-bg shadow-2xl">
        <span className="text-[13px]">{message}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="text-bg hover:bg-white/10 hover:text-bg" onClick={onDiscard}>
            Discard
          </Button>
          <Button size="sm" variant="primary" loading={saving} onClick={onSave}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Asks before leaving a page with unsaved changes, both in-app and on reload. */
export function UnsavedGuard({ when }: { when: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!when) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [when]);
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onOpenChange={(v) => !v && blocker.state === "blocked" && blocker.reset()}
      title="Leave without saving?"
      description="Your changes on this page will be lost."
      confirmLabel="Leave page"
      danger
      onConfirm={() => {
        if (blocker.state === "blocked") blocker.proceed();
      }}
    />
  );
}

/**
 * Renders the button enabled, or disabled with a tooltip saying which role is
 * needed. The button stays on the page either way.
 */
export function RoleGate({ action, children }: { action: Action; children: (allowed: boolean) => ReactNode }) {
  const { allowed, reason } = useCan(action);
  if (allowed) return <>{children(true)}</>;
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex">
        {children(false)}
      </span>
    </Tooltip>
  );
}

/** Replaces a section with an upgrade prompt when the plan doesn't include it. */
export function PlanGate({ feature, title, children, compact }: { feature: Feature; title: string; children: ReactNode; compact?: boolean }) {
  const { enabled, needs } = useFeature(feature);
  if (enabled) return <>{children}</>;
  return <UpgradePrompt title={title} needs={needs} compact={compact} />;
}

export function UpgradePrompt({ title, needs, compact }: { title: string; needs: Plan; compact?: boolean }) {
  const setLab = useLab((s) => s.set);
  if (compact)
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3">
        <Lock className="size-3.5" /> {PLAN_LABELS[needs]} plan
        <Button variant="link" size="sm" onClick={() => setLab({ plan: needs })}>
          Upgrade
        </Button>
      </span>
    );
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong bg-panel px-6 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand">
        <Sparkles className="size-5" />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="max-w-sm text-[13px] text-ink-3">This comes with the {PLAN_LABELS[needs]} plan, and your workspace isn't on it yet. Upgrade to turn it on for everyone.</p>
      <Button variant="primary" onClick={() => setLab({ plan: needs })}>
        Upgrade to {PLAN_LABELS[needs]}
      </Button>
    </div>
  );
}

/**
 * Pretends to fetch the page's data. Shows a skeleton for as long as the test
 * panel's latency says, and sometimes fails. Pass a key that changes when the
 * page or its filters change.
 */
export function useSimulatedLoad(key: unknown): { loading: boolean; error: string | null; retry: () => void } {
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const failureRate = useLab((s) => s.failureRate);
  useEffect(() => {
    let live = true;
    setState({ loading: true, error: null });
    const t = setTimeout(() => {
      if (!live) return;
      setState(Math.random() < failureRate ? { loading: false, error: "We couldn't load this page." } : { loading: false, error: null });
    }, latencyMs());
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(key), attempt]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry };
}

/** Wraps a page body in the loading and error states. */
export function Loader({ loadKey, children, rows }: { loadKey: unknown; children: () => ReactNode; rows?: number }) {
  const { loading, error, retry } = useSimulatedLoad(loadKey);
  if (loading) return <LoadingBlock rows={rows} />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  return <>{children()}</>;
}

/**
 * Runs a change through the fake server, then toasts. With `undo`, the toast
 * has an Undo button.
 */
export async function act<T>(work: () => T, opts: { success: string; undo?: () => void; error?: string } = { success: "Saved" }): Promise<T | undefined> {
  try {
    const result = await simulate(work);
    toast.success(opts.success, opts.undo ? { action: { label: "Undo", onClick: opts.undo } } : undefined);
    return result;
  } catch (e) {
    toast.error(opts.error ?? (e instanceof Error ? e.message : "That didn't work."));
    return undefined;
  }
}

export { toast };
