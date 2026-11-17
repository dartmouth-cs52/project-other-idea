import { cn } from "@/lib/utils";

/**
 * The Haptic pointer. One path, drawn on a 24px grid, shared with
 * `assets/pointer.svg` and the widget in `src/widget/ui.ts`.
 */
export const POINTER_PATH =
  "M3.271 4.871A1.678 1.678 0 0 1 5.604 2.907L19.822 9.597A1.678 1.678 0 0 1 19.705 12.684L13.956 14.875A.622.622 0 0 0 13.643 15.139L10.506 20.431A1.678 1.678 0 0 1 7.444 20.021Z";

/** Where the tip sits inside the 24px box. */
export const POINTER_TIP = { x: 3.81, y: 3.14 };

export function Pointer({
  className,
  bordered = false,
}: {
  className?: string;
  /** The white border the live pointer always carries. The plain mark has none. */
  bordered?: boolean;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-6 shrink-0 overflow-visible", className)}>
      <path
        d={POINTER_PATH}
        fill="currentColor"
        stroke={bordered ? "var(--pointer-border)" : "none"}
        strokeWidth={bordered ? 3 : 0}
        strokeLinejoin="round"
        style={{ paintOrder: "stroke" }}
      />
    </svg>
  );
}
