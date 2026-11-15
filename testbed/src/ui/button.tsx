import { Slot, Tooltip as RTooltip } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { usePortalContainer } from "./portal";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link" | "subtle";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:brightness-110 shadow-sm",
  secondary: "bg-panel text-ink border border-line-strong hover:bg-sunken shadow-xs",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  subtle: "bg-sunken text-ink hover:bg-line",
  danger: "bg-danger text-white hover:brightness-110 shadow-sm",
  link: "text-brand underline-offset-2 hover:underline px-0 h-auto",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
  lg: "h-10 px-4 text-sm gap-2",
  icon: "size-8",
  "icon-sm": "size-7",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", asChild, loading, className, disabled, children, ...rest },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (rest.type ?? "button")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background,filter,color] select-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner /> : null}
          {children}
        </>
      )}
    </Comp>
  );
});

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={300}>{children}</RTooltip.Provider>;
}

/** A hover label. Some buttons in the app have nothing else, on purpose. */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  const container = usePortalContainer();
  if (!content) return <>{children}</>;
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal container={container}>
        <RTooltip.Content side={side} sideOffset={6} className="z-[60] max-w-64 animate-in rounded-md bg-ink px-2 py-1 text-xs text-bg shadow-lg">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  icon: ReactNode;
  /** The tooltip text. */
  label: string;
  /**
   * Whether the label is also the accessible name. Some real apps forget this,
   * which leaves the icon's class as the only clue. Default true.
   */
  named?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, named = true, variant = "ghost", size = "icon", ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <Button ref={ref} variant={variant} size={size} aria-label={named ? label : undefined} {...rest}>
        {icon}
      </Button>
    </Tooltip>
  );
});
