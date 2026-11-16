import { Command } from "cmdk";
import { format, parseISO } from "date-fns";
import { Calendar, Check, ChevronsUpDown, Pencil, Upload, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Input } from "./form";
import { Popover } from "./overlay";

// Inputs that aren't one HTML element: a searchable combobox, chips, date
// pickers, a drop zone for files and click-to-edit text.

export interface Option {
  value: string;
  label: string;
  hint?: string;
  group?: string;
}

const triggerClass =
  "flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-line-strong bg-panel px-2.5 text-left text-[13px] shadow-xs hover:bg-sunken/50 focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none";

function OptionList({ options, selected, onPick, placeholder }: { options: Option[]; selected: string[]; onPick: (v: string) => void; placeholder: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <Command className="flex flex-col" loop>
      <Command.Input placeholder={placeholder} className="h-9 border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-ink-3" />
      <Command.List className="max-h-64 overflow-y-auto p-1">
        <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-3">No matches.</Command.Empty>
        {groups.map((g) => (
          <Command.Group key={g} heading={g || undefined} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:uppercase">
            {options
              .filter((o) => (o.group ?? "") === g)
              .map((o) => (
                <Command.Item
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ""} ${o.value}`}
                  onSelect={() => onPick(o.value)}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] data-[selected=true]:bg-sunken"
                >
                  <Check className={cn("size-3.5 shrink-0", selected.includes(o.value) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                  {o.hint ? <span className="ml-auto truncate pl-3 text-xs text-ink-3">{o.hint}</span> : null}
                </Command.Item>
              ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  );
}

/** A select you can type into to filter. */
export function Combobox({ value, onChange, options, placeholder = "Select…", searchPlaceholder = "Search…", id, className, "aria-label": ariaLabel, disabled }: { value: string | null; onChange: (v: string) => void; options: Option[]; placeholder?: string; searchPlaceholder?: string; id?: string; className?: string; "aria-label"?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
      trigger={
        <button type="button" id={id} role="combobox" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} className={cn(triggerClass, disabled && "cursor-not-allowed opacity-50", className)}>
          <span className={cn("truncate", !current && "text-ink-3")}>{current?.label ?? placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" />
        </button>
      }
    >
      <OptionList
        options={options}
        selected={value ? [value] : []}
        placeholder={searchPlaceholder}
        onPick={(v) => {
          onChange(v);
          setOpen(false);
        }}
      />
    </Popover>
  );
}

/** Pick several, shown as removable chips. */
export function MultiSelect({ value, onChange, options, placeholder = "Add…", id, "aria-label": ariaLabel }: { value: string[]; onChange: (v: string[]) => void; options: Option[]; placeholder?: string; id?: string; "aria-label"?: string }) {
  const [open, setOpen] = useState(false);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-line-strong bg-panel p-1 shadow-xs">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded bg-sunken py-0.5 pr-1 pl-2 text-[12.5px]">
          {labelOf(v)}
          <button type="button" aria-label={`Remove ${labelOf(v)}`} onClick={() => onChange(value.filter((x) => x !== v))} className="cursor-pointer rounded text-ink-3 hover:text-ink">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Popover
        open={open}
        onOpenChange={setOpen}
        className="w-72 p-0"
        trigger={
          <button type="button" id={id} aria-label={ariaLabel} className="h-6 cursor-pointer rounded px-1.5 text-[12.5px] text-ink-3 hover:bg-sunken hover:text-ink">
            {placeholder}
          </button>
        }
      >
        <OptionList options={options} selected={value} placeholder="Search…" onPick={(v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])} />
      </Popover>
    </div>
  );
}

const dayPickerClasses = {
  root: "text-[13px]",
  months: "flex gap-4",
  month_caption: "flex h-8 items-center justify-center font-medium",
  nav: "absolute top-3 right-3 left-3 flex justify-between",
  button_previous: "size-7 grid place-items-center rounded hover:bg-sunken cursor-pointer",
  button_next: "size-7 grid place-items-center rounded hover:bg-sunken cursor-pointer",
  weekday: "size-8 text-[11px] font-normal text-ink-3",
  day: "size-8 p-0 text-center",
  day_button: "size-8 rounded-md hover:bg-sunken cursor-pointer",
  selected: "[&>button]:bg-brand [&>button]:text-brand-ink",
  range_middle: "[&>button]:bg-brand-soft [&>button]:text-ink",
  today: "font-semibold text-brand",
  outside: "text-ink-3 opacity-50",
  disabled: "opacity-30",
};

/** One date, stored as yyyy-mm-dd. */
export function DatePicker({ value, onChange, id, placeholder = "Pick a date", disabledBefore }: { value: string | null; onChange: (v: string) => void; id?: string; placeholder?: string; disabledBefore?: Date }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="relative p-3"
      trigger={
        <button type="button" id={id} className={triggerClass}>
          <span className={cn(!value && "text-ink-3")}>{value ? format(parseISO(value), "MMM d, yyyy") : placeholder}</span>
          <Calendar className="size-3.5 text-ink-3" />
        </button>
      }
    >
      <DayPicker
        mode="single"
        classNames={dayPickerClasses}
        selected={value ? parseISO(value) : undefined}
        disabled={disabledBefore ? { before: disabledBefore } : undefined}
        onSelect={(d) => {
          if (d) onChange(format(d, "yyyy-MM-dd"));
          setOpen(false);
        }}
      />
    </Popover>
  );
}

export interface Range {
  from: string | null;
  to: string | null;
}

/** A from and to date with presets, like every dashboard's date filter. */
export function DateRangePicker({ value, onChange, presets }: { value: Range; onChange: (v: Range) => void; presets?: { label: string; range: Range }[] }) {
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined = value.from ? { from: parseISO(value.from), to: value.to ? parseISO(value.to) : undefined } : undefined;
  const label = value.from ? `${format(parseISO(value.from), "MMM d")} – ${value.to ? format(parseISO(value.to), "MMM d, yyyy") : "…"}` : "Any date";
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="relative flex gap-3 p-3"
      align="start"
      trigger={
        <Button size="sm">
          <Calendar /> {label}
        </Button>
      }
    >
      {presets ? (
        <div className="flex w-36 flex-col gap-0.5 border-r border-line pr-3">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="cursor-pointer rounded px-2 py-1.5 text-left text-[13px] hover:bg-sunken"
              onClick={() => {
                onChange(p.range);
                setOpen(false);
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className="cursor-pointer rounded px-2 py-1.5 text-left text-[13px] text-ink-3 hover:bg-sunken"
            onClick={() => {
              onChange({ from: null, to: null });
              setOpen(false);
            }}
          >
            Clear dates
          </button>
        </div>
      ) : null}
      <DayPicker
        mode="range"
        numberOfMonths={2}
        classNames={dayPickerClasses}
        selected={selected}
        onSelect={(r) => onChange({ from: r?.from ? format(r.from, "yyyy-MM-dd") : null, to: r?.to ? format(r.to, "yyyy-MM-dd") : null })}
      />
    </Popover>
  );
}

/** Drag files here or click to browse. The file input itself is hidden, like most apps. */
export function FileDrop({ onFiles, accept, multiple, label = "Drop a file here, or click to browse", hint, id }: { onFiles: (files: File[]) => void; accept?: string; multiple?: boolean; label?: ReactNode; hint?: ReactNode; id?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-6 py-8 text-center hover:bg-sunken/60", over && "border-brand bg-brand-soft")}
    >
      <Upload className="size-5 text-ink-3" />
      <span className="text-[13px] font-medium">{label}</span>
      {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
      <input ref={input} id={id} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => onFiles(Array.from(e.target.files ?? []))} />
    </div>
  );
}

/** Text that turns into an input when clicked, and saves on Enter or blur. */
export function InlineEdit({ value, onSave, label, className, placeholder = "Add…" }: { value: string; onSave: (v: string) => void; label: string; className?: string; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing)
    return (
      <Input
        autoFocus
        aria-label={label}
        value={draft}
        className={cn("h-7", className)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <button
      type="button"
      aria-label={`Edit ${label}`}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cn("group inline-flex max-w-full cursor-text items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-sunken", className)}
    >
      <span className={cn("truncate", !value && "text-ink-3")}>{value || placeholder}</span>
      <Pencil className="size-3 shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />
    </button>
  );
}
