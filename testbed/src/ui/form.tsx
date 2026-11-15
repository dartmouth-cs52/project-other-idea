import { Check, ChevronDown } from "lucide-react";
import { Checkbox as RCheckbox, RadioGroup as RRadio, Select as RSelect, Switch as RSwitch } from "radix-ui";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { usePortalContainer } from "./portal";

const fieldBase =
  "w-full rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-ink shadow-xs outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-sunken disabled:text-ink-3 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { prefix?: ReactNode; suffix?: ReactNode }>(
  function Input({ className, prefix, suffix, ...rest }, ref) {
    if (!prefix && !suffix) return <input ref={ref} className={cn(fieldBase, "h-8", className)} {...rest} />;
    return (
      <div className={cn("relative flex items-center", className)}>
        {prefix ? <span className="pointer-events-none absolute left-2.5 text-[13px] text-ink-3">{prefix}</span> : null}
        <input ref={ref} className={cn(fieldBase, "h-8", prefix && "pl-7", suffix && "pr-10")} {...rest} />
        {suffix ? <span className="pointer-events-none absolute right-2.5 text-xs text-ink-3">{suffix}</span> : null}
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2", className)} {...rest} />;
});

/** A plain <select>. Some forms use it, some use the custom Select below, like real apps do. */
export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function NativeSelect({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-8 pr-7", className)} {...rest}>
      {children}
    </select>
  );
});

export function Label({ children, htmlFor, className, optional }: { children: ReactNode; htmlFor?: string; className?: string; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={cn("text-[13px] font-medium text-ink", className)}>
      {children}
      {optional ? <span className="ml-1 font-normal text-ink-3">(optional)</span> : null}
    </label>
  );
}

/** Label, control, hint and error stacked. Pass a render function to get the generated id. */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} optional={optional}>
        {label}
      </Label>
      {typeof children === "function" ? children(id) : children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onCheckedChange, label, id, disabled, className }: { checked: boolean | "indeterminate"; onCheckedChange: (v: boolean) => void; label?: ReactNode; id?: string; disabled?: boolean; className?: string }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <RCheckbox.Root
        id={cid}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border border-line-strong bg-panel data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand disabled:opacity-50"
      >
        <RCheckbox.Indicator className="text-brand-ink">
          {checked === "indeterminate" ? <span className="block h-0.5 w-2 bg-current" /> : <Check className="size-3" strokeWidth={3} />}
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      {label ? (
        <label htmlFor={cid} className="cursor-pointer text-[13px] text-ink">
          {label}
        </label>
      ) : null}
    </span>
  );
}

export function Switch({ checked, onCheckedChange, label, description, disabled, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean; id?: string }) {
  const auto = useId();
  const sid = id ?? auto;
  const control = (
    <RSwitch.Root
      id={sid}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-line-strong transition-colors data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={sid} className="cursor-pointer text-[13px] font-medium text-ink">
          {label}
        </label>
        {description ? <p className="text-xs text-ink-3">{description}</p> : null}
      </div>
      {control}
    </div>
  );
}

export function RadioCards<T extends string>({ value, onValueChange, options, columns = 2, name }: { value: T; onValueChange: (v: T) => void; options: { value: T; label: ReactNode; description?: ReactNode; icon?: ReactNode; disabled?: boolean }[]; columns?: number; name?: string }) {
  return (
    <RRadio.Root value={value} onValueChange={(v) => onValueChange(v as T)} name={name} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <RRadio.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong bg-panel p-3 text-left hover:bg-sunken data-[state=checked]:border-brand data-[state=checked]:ring-2 data-[state=checked]:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {o.icon ? <span className="mt-0.5 text-ink-2 [&_svg]:size-5">{o.icon}</span> : null}
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-ink">{o.label}</span>
            {o.description ? <span className="text-xs text-ink-3">{o.description}</span> : null}
          </span>
        </RRadio.Item>
      ))}
    </RRadio.Root>
  );
}

export function RadioList<T extends string>({ value, onValueChange, options }: { value: T; onValueChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <RRadio.Root value={value} onValueChange={(v) => onValueChange(v as T)} className="flex flex-col gap-2">
      {options.map((o) => {
        const id = `radio-${o.value}`;
        return (
          <span key={o.value} className="flex items-center gap-2">
            <RRadio.Item id={id} value={o.value} className="grid size-4 cursor-pointer place-items-center rounded-full border border-line-strong bg-panel data-[state=checked]:border-brand">
              <RRadio.Indicator className="size-2 rounded-full bg-brand" />
            </RRadio.Item>
            <label htmlFor={id} className="cursor-pointer text-[13px]">
              {o.label}
            </label>
          </span>
        );
      })}
    </RRadio.Root>
  );
}

/** The custom dropdown select. It renders in a portal, away from the trigger. */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  className,
  id,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: T | "";
  onValueChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[] | { group: string; options: { value: T; label: ReactNode }[] }[];
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const grouped = options.length > 0 && "group" in options[0];
  const container = usePortalContainer();
  return (
    <RSelect.Root value={value || undefined} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <RSelect.Trigger id={id} aria-label={ariaLabel} className={cn(fieldBase, "flex h-8 cursor-pointer items-center justify-between gap-2 text-left data-[placeholder]:text-ink-3", className)}>
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <ChevronDown className="size-4 text-ink-3" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal container={container}>
        <RSelect.Content position="popper" sideOffset={4} className="z-[70] max-h-72 min-w-[var(--radix-select-trigger-width)] animate-in overflow-hidden rounded-md border border-line bg-panel shadow-lg">
          <RSelect.Viewport className="p-1">
            {grouped
              ? (options as { group: string; options: { value: T; label: ReactNode }[] }[]).map((g) => (
                  <RSelect.Group key={g.group}>
                    <RSelect.Label className="px-2 py-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{g.group}</RSelect.Label>
                    {g.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </RSelect.Group>
                ))
              : (options as { value: T; label: ReactNode; disabled?: boolean }[]).map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </SelectItem>
                ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

function SelectItem({ value, children, disabled }: { value: string; children: ReactNode; disabled?: boolean }) {
  return (
    <RSelect.Item
      value={value}
      disabled={disabled}
      className="relative flex cursor-pointer items-center rounded-sm py-1.5 pr-2 pl-7 text-[13px] outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-sunken"
    >
      <RSelect.ItemIndicator className="absolute left-2">
        <Check className="size-3.5" />
      </RSelect.ItemIndicator>
      <RSelect.ItemText>{children}</RSelect.ItemText>
    </RSelect.Item>
  );
}
