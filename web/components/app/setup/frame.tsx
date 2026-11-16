"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stepLabel, type SetupStepId } from "@/lib/setup";

/**
 * One screen of the setup: "Step 2 of 5", one heading, a line under it, the
 * screen's own content, then Back and one primary button. The heading takes
 * the focus when the screen arrives, so a screen reader starts there and Enter
 * presses the primary button.
 */
export function StepFrame({
  step,
  title,
  lead,
  mark,
  children,
  actions,
  focusHeading = true,
}: {
  step: SetupStepId;
  title: ReactNode;
  lead?: ReactNode;
  /** Shown before the title, such as the green tick once a step is done. */
  mark?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** False when the screen puts the focus in a field of its own. */
  focusHeading?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) heading.current?.focus({ preventScroll: true });
  }, [focusHeading]);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">{stepLabel(step)}</p>
        <h1 ref={heading} tabIndex={-1} className="flex items-start gap-3 text-4xl font-medium tracking-[-0.03em] text-balance outline-none">
          {mark && <span className="flex h-10 shrink-0 items-center">{mark}</span>}
          <span>{title}</span>
        </h1>
        {lead && <div className="max-w-[60ch] text-lg leading-7 text-pretty text-muted-foreground">{lead}</div>}
      </div>
      {children}
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

/** The one primary button on a screen. Enter presses it from anywhere that isn't a field or another button. */
export function Primary({ children, onClick, disabled, type = "button", className }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; className?: string }) {
  return (
    <>
      <Button type={type} size="xl" onClick={onClick} disabled={disabled} data-setup-primary className={className}>
        {children}
      </Button>
      {!disabled && (
        <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex" aria-hidden>
          press Enter <CornerDownLeft className="size-3.5" />
        </span>
      )}
    </>
  );
}

export function Back({ onClick, children = "Back" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <Button variant="secondary" size="xl" onClick={onClick}>
      {children}
    </Button>
  );
}

/** Enter anywhere on the page, outside a field, a button or a link, presses the screen's primary button. */
export function useEnterToContinue() {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, summary, [role='menu'], [role='menuitem'], [contenteditable='true']")) return;
      const primary = document.querySelector<HTMLButtonElement>("[data-setup-primary]:not(:disabled)");
      if (!primary) return;
      event.preventDefault();
      primary.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
