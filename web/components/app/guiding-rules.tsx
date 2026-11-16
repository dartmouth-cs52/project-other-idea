"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "cn";
import { FieldError, FieldLabel, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ControlName, type Correction, type Site } from "@/lib/app-api";
import { Card, CardTitle, when } from "./parts";

// What a company changes about how Haptic guides on its site. Corrections are
// made from a guide's steps ("Point here instead"). The list of controls Haptic
// must never point at is kept here. Both reach visitors within a minute.

/** The kinds of control a person can name, in the words the dashboard uses. */
const KINDS: { role: string; name: string }[] = [
  { role: "", name: "Any kind" },
  { role: "button", name: "Button" },
  { role: "link", name: "Link" },
  { role: "tab", name: "Tab" },
  { role: "menuitem", name: "Menu item" },
  { role: "textbox", name: "Text field" },
  { role: "select", name: "Dropdown" },
  { role: "checkbox", name: "Checkbox" },
];

/** How a control is named on the dashboard: the button "Send invite". */
export function controlName(control: ControlName): string {
  const kind = KINDS.find((item) => item.role === control.role && item.role);
  return kind ? `the ${kind.name.toLowerCase()} "${control.label}"` : `"${control.label}"`;
}

const inputClass = "h-11 bg-card px-3.5 md:text-base";
const selectClass = "h-11 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** The same words the server uses when a control has no name. */
const NO_LABEL = "Name the control by the words on it.";

/** What ties the words box to its error, from useFieldErrors. */
type ControlProps = { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

/**
 * A control typed by hand: the words on it and, if it helps, its kind. `button`,
 * if given, sits beside the two on a wide screen and under them on a phone. The
 * error line stays right under the words on every screen.
 */
function ControlFields({
  id,
  value,
  onChange,
  error,
  control,
  button,
}: {
  id: string;
  value: ControlName;
  onChange: (value: ControlName) => void;
  error?: string;
  control: ControlProps;
  button?: ReactNode;
}) {
  return (
    <div className={cn("grid gap-2", button ? "sm:grid-cols-[minmax(0,1fr)_auto_auto]" : "sm:grid-cols-[minmax(0,1fr)_auto]")}>
      <FieldLabel htmlFor={control.id} required className="sm:col-start-1 sm:row-start-1">
        Words on the control
      </FieldLabel>
      <Input {...control} required value={value.label} maxLength={80} onChange={(event) => onChange({ ...value, label: event.target.value })} className={cn(inputClass, "sm:col-start-1 sm:row-start-2")} />
      <FieldError id={control.id} error={error} className="sm:col-start-1 sm:row-start-3" />
      <Label htmlFor={`${id}-kind`} className="sm:col-start-2 sm:row-start-1">
        Kind
      </Label>
      <select id={`${id}-kind`} value={value.role ?? ""} onChange={(event) => onChange({ ...value, role: event.target.value || undefined })} className={cn(selectClass, "sm:col-start-2 sm:row-start-2")}>
        {KINDS.map((kind) => (
          <option key={kind.role} value={kind.role}>
            {kind.name}
          </option>
        ))}
      </select>
      {button && <div className="grid sm:col-start-3 sm:row-start-2">{button}</div>}
    </div>
  );
}

/**
 * "Point here instead" for one step of a guide. The page itself is not kept
 * with a guide, so it offers the controls known on that page, from the
 * crawl and from visits, and a way to name any other.
 */
export function PointHereInstead({ siteId, guideId, step, path, onSaved }: { siteId: string; guideId: string; step: number; path: string; onSaved: (corrections: Correction[]) => void }) {
  const [open, setOpen] = useState(false);
  const [controls, setControls] = useState<ControlName[] | null>(null);
  const [filter, setFilter] = useState("");
  const [typed, setTyped] = useState<ControlName>({ label: "" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState<ControlName | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = `fix-${guideId}-${step}`;
  const fields = useFieldErrors({ label: `${formId}-label` });

  useEffect(() => {
    if (!open || controls) return;
    api<{ controls: ControlName[] }>(`/sites/${siteId}/controls?route=${encodeURIComponent(path)}`).then(
      (result) => setControls(result.controls),
      () => setControls([]),
    );
  }, [open, controls, siteId, path]);

  const shown = useMemo(() => (controls ?? []).filter((control) => control.label.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 30), [controls, filter]);

  /** Saves the control picked from the list, or the one typed by hand, whose words can be refused under the field. */
  async function save(right: ControlName, byHand: boolean) {
    setBusy(true);
    setFailure(null);
    if (!byHand) fields.show({});
    try {
      const result = await api<{ corrections: Correction[] }>(`/sites/${siteId}/corrections`, { method: "POST", body: { guide: guideId, step, right } });
      setSaved(right);
      setOpen(false);
      onSaved(result.corrections);
    } catch (failure) {
      if (!(byHand && fields.showRefusal(failure))) setFailure(failureFrom("Couldn't save the correction", failure));
    } finally {
      setBusy(false);
    }
  }

  if (saved) return <p className="text-sm text-muted-foreground">Saved. From now on Haptic points at {controlName(saved)} for this question on {path}.</p>;
  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Point here instead
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <p className="text-sm font-medium">Which control should this step have pointed at?</p>
      {controls === null ? (
        <p className="text-sm text-muted-foreground">Looking up the controls on {path}</p>
      ) : controls.length ? (
        <>
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`Filter the controls on ${path}`} aria-label="Filter controls" className={inputClass} />
          <ul className="flex max-h-56 flex-col overflow-y-auto">
            {shown.map((control) => (
              <li key={`${control.role} ${control.label}`}>
                <button type="button" disabled={busy} onClick={() => save(control, false)} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted">
                  <span className="min-w-0 truncate">{control.label}</span>
                  <span className="shrink-0 text-muted-foreground">{KINDS.find((kind) => kind.role === control.role)?.name ?? control.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Haptic doesn&apos;t know the controls on {path} yet. Name the one you mean.</p>
      )}
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setFailure(null);
          if (fields.show({ label: typed.label.trim() ? undefined : NO_LABEL })) return;
          void save(typed, true);
        }}
      >
        <ControlFields
          id={formId}
          value={typed}
          onChange={(next) => {
            if (next.label !== typed.label) fields.clear("label");
            setTyped(next);
          }}
          error={fields.errors.label}
          control={fields.control("label")}
        />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="secondary" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
      <FormAlert failure={failure} />
    </div>
  );
}

/** The corrections made so far, and the controls Haptic must never point at. */
export function GuidingRules({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  return (
    <Card>
      <CardTitle>How Haptic guides here</CardTitle>
      <Corrections site={site} onChange={onChange} />
      <NeverPointAt site={site} onChange={onChange} />
    </Card>
  );
}

function Corrections({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [failure, setFailure] = useState<Failure | null>(null);
  async function remove(correction: Correction) {
    setFailure(null);
    try {
      const result = await api<{ corrections: Correction[] }>(`/sites/${site.id}/corrections/${correction.id}`, { method: "DELETE" });
      onChange({ ...site, corrections: result.corrections });
    } catch (failure) {
      setFailure(failureFrom("Couldn't remove the correction", failure));
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-medium">Corrections</h3>
      {site.corrections.length ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {[...site.corrections].reverse().map((correction) => (
            <li key={correction.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="min-w-0">
                <span className="block">{correction.question}</span>
                <span className="text-muted-foreground">
                  On {correction.route}, point at {controlName(correction.right)}
                  {correction.wrong ? ` and not ${controlName(correction.wrong)}` : ""}. Saved {when(correction.createdAt)}.
                </span>
              </span>
              <Button variant="ghost" size="sm" className="self-start sm:self-center" onClick={() => remove(correction)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          None yet. When Haptic points at the wrong thing, open the guide under Every question and choose Point here instead on that step. Haptic uses it
          for the same question, questions like it, and other questions on that page.
        </p>
      )}
      <FormAlert failure={failure} />
    </div>
  );
}

function NeverPointAt({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [adding, setAdding] = useState<ControlName>({ label: "" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const fields = useFieldErrors({ label: `blocked-${site.id}-label` });
  async function save(blocked: ControlName[]) {
    const result = await api<{ blocked: ControlName[] }>(`/sites/${site.id}/blocked`, { method: "PUT", body: { controls: blocked } });
    onChange({ ...site, blocked: result.blocked });
  }
  async function remove(control: ControlName) {
    setFailure(null);
    try {
      await save(site.blocked.filter((item) => item !== control));
    } catch (failure) {
      setFailure(failureFrom(`Couldn't remove ${controlName(control)}`, failure));
    }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const label = adding.label.trim();
    if (fields.show({ label: label ? undefined : NO_LABEL })) return;
    try {
      await save([...site.blocked, { ...adding, label }]);
      setAdding({ label: "" });
    } catch (failure) {
      if (!fields.showRefusal(failure)) setFailure(failureFrom("Couldn't add the control", failure));
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-medium">Never point at</h3>
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        Controls that should only ever be used on purpose, such as Delete workspace or Transfer ownership. If Haptic is asked for one, it does not
        move the pointer, and says it can&apos;t help with that here.
      </p>
      {site.blocked.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {site.blocked.map((control) => (
            <li key={`${control.role} ${control.label}`} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
              <span>{controlName(control)}</span>
              <Button variant="ghost" size="sm" onClick={() => remove(control)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate>
        <ControlFields
          id={`blocked-${site.id}`}
          value={adding}
          onChange={(next) => {
            if (next.label !== adding.label) fields.clear("label");
            setAdding(next);
          }}
          error={fields.errors.label}
          control={fields.control("label")}
          button={
            <Button type="submit" variant="secondary" size="xl">
              Add
            </Button>
          }
        />
      </form>
      <FormAlert failure={failure} />
    </div>
  );
}
