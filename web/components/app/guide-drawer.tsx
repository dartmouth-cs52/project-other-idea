"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, type Correction, type GuideDetail } from "@/lib/app-api";
import { PointHereInstead } from "./guiding-rules";
import { GuideStatus, seconds, when } from "./parts";

/**
 * One guide, step by step, in a panel beside the page: what was pointed at,
 * what was said, and what the person did. While the guide is under way it is
 * asked for again each time `stamp` changes, so its steps arrive as they happen.
 */
export function GuideDrawer({
  siteId,
  guideId,
  stamp,
  onClose,
  onCorrected,
}: {
  siteId: string;
  guideId: string;
  stamp?: string;
  onClose: () => void;
  onCorrected?: (corrections: Correction[]) => void;
}) {
  const [guide, setGuide] = useState<GuideDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<GuideDetail>(`/sites/${siteId}/guides/${guideId}`).then(
      (result) => live && (setGuide(result), setError(null)),
      (failure: Error) => live && setError(failure.message),
    );
    return () => {
      live = false;
    };
  }, [siteId, guideId, stamp]);

  const shown = guide?.id === guideId ? guide : null;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto">
        <SheetHeader className="gap-2 border-b p-5 pr-12">
          <SheetTitle className="text-lg leading-6">{shown?.question ?? "Guide"}</SheetTitle>
          <SheetDescription render={<div />} className="flex flex-col gap-1">
            {shown ? (
              <>
                <span className="flex flex-wrap items-center text-foreground">
                  <GuideStatus outcome={shown.outcome} helped={shown.helped} step={shown.steps.length ? shown.steps[shown.steps.length - 1]!.n : null} />
                  {shown.helped !== null && <span className="text-muted-foreground">, {shown.helped ? "said it helped" : "said it did not help"}</span>}
                </span>
                <span>
                  Asked on {shown.started_path}
                  {shown.origin ? ` at ${shown.origin}` : ""}, {when(shown.started_at)}
                </span>
              </>
            ) : (
              <span>{error && !guide ? error : "Loading the guide"}</span>
            )}
          </SheetDescription>
        </SheetHeader>
        {shown && (
          <div className="flex flex-col gap-4 p-5">
            {shown.cancelled_steps > 0 && (
              <p className="text-sm leading-5 text-muted-foreground">
                {shown.cancelled_steps === 1 ? "One step was" : `${shown.cancelled_steps} steps were`} asked again because the page changed while Haptic was answering. Pages that load slowly after a
                click cause this.
              </p>
            )}
            {shown.steps.length === 0 && <p className="text-sm text-muted-foreground">{shown.outcome === "under_way" ? "Haptic is working out the first step." : "This guide ended before its first step."}</p>}
            <ol className="flex flex-col gap-3">
              {shown.steps.map((step) => (
                <li key={step.n} className="flex flex-col gap-2 rounded-xl border bg-card p-4 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      Step {step.n + 1} on {step.path}
                    </span>
                    <span className="tabular-nums">pointer after {seconds(step.ms_to_target)}</span>
                  </div>
                  {step.event && <p className="text-sm text-muted-foreground">{step.strayed ? `Wrong click. ${step.event}` : step.event}</p>}
                  <p className="text-sm">
                    {step.target_label ? (
                      <>
                        Pointed at <span className="font-medium">{step.target_label}</span>
                        {step.target_context ? <span className="text-muted-foreground"> in {step.target_context}</span> : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Pointed at nothing</span>
                    )}
                  </p>
                  <p className="w-fit max-w-full rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">{step.said}</p>
                  <PointHereInstead siteId={siteId} guideId={guideId} step={step.n} path={step.path} onSaved={(corrections) => onCorrected?.(corrections)} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
