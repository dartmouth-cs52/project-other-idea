import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

// Small, plain building blocks for the dashboard. Neutral surfaces, one
// accent, thin borders.

export function Card({ title, description, children, actions }: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-ink text-white hover:bg-black disabled:opacity-50",
    secondary: "border border-line bg-white text-ink hover:bg-canvas disabled:opacity-50",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  }[variant];
  return <button className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 font-medium transition-colors ${styles} ${className}`} {...props} />;
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 block font-medium">
      {children}
      {hint && <span className="ml-2 font-normal text-ink-muted">{hint}</span>}
    </span>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="h-9 w-full rounded-lg border border-line bg-white px-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" {...props} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn"; children: ReactNode }) {
  const styles = { neutral: "bg-canvas text-ink-muted border-line", good: "bg-emerald-50 text-emerald-700 border-emerald-200", warn: "bg-amber-50 text-amber-800 border-amber-200" }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 3 L19 11 L12.4 12.6 L9 19 Z" fill="var(--color-accent)" />
      </svg>
      Haptic
    </span>
  );
}
