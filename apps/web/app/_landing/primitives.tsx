import type { ReactNode } from "react";

/** Haptic's pointer, the same shape the SDK draws. Black on light, white on dark. */
export function Pointer({ on = "light", size = 22, className = "" }: { on?: "light" | "dark"; size?: number; className?: string }) {
  const fill = on === "light" ? "#0a0a0a" : "#ffffff";
  const edge = on === "light" ? "#ffffff" : "#0a0a0a";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M3.5 2.5 L19.5 11 L12.2 12.6 L8.6 19.5 Z" fill={fill} stroke={edge} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ on = "light" }: { on?: "light" | "dark" }) {
  return (
    <span className="inline-flex items-center gap-2 text-[19px] font-semibold tracking-tight">
      <Pointer on={on} size={20} />
      Haptic
    </span>
  );
}

/** Serif section heading. Wrap the turn of phrase in <em> for the italic. */
export function Heading({ eyebrow, children, sub, align = "center", tone = "light" }: { eyebrow?: string; children: ReactNode; sub?: ReactNode; align?: "center" | "left"; tone?: "light" | "dark" }) {
  const muted = tone === "light" ? "text-ink-muted" : "text-white/60";
  return (
    <div className={`reveal ${align === "center" ? "mx-auto text-center" : ""} max-w-3xl`}>
      {eyebrow && <p className={`eyebrow mb-5 ${muted}`}>{eyebrow}</p>}
      <h2 className="display text-[44px] sm:text-[64px]">{children}</h2>
      {sub && <p className={`mt-6 text-[17px] font-medium sm:text-[19px] ${align === "center" ? "mx-auto" : ""} max-w-xl ${muted}`}>{sub}</p>}
    </div>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
