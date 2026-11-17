"use client";

// How every form on the site shows what went wrong, as DESIGN.md sets out under
// Components, Form. A field that fails its check gets an Error red outline and one
// 13px line under it, the first such field takes the focus, and the line goes as
// soon as the person changes that field. A failure that is not one field's fault
// is an alert under the form's buttons, with an icon, a short title and one line.

import { useEffect, useState, type ReactNode } from "react";
import { AlertCircleIcon } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/app-api";

export type FieldErrors<Name extends string> = Partial<Record<Name, string>>;

/** A failure that is not one field's fault, as the alert shows it. */
export interface Failure {
  title: string;
  detail: string;
}

/**
 * The errors on one form's fields. `ids` maps each field to its control's id, in
 * the order the fields appear, so the focus goes to the first one at fault.
 */
export function useFieldErrors<Name extends string>(ids: Record<Name, string>) {
  const [errors, setErrors] = useState<FieldErrors<Name>>({});
  // The control to move the focus to once its error is on screen, so a screen reader reads the two together.
  // The count lets the same control be asked for twice in a row.
  const [focus, setFocus] = useState<{ id: string; ask: number } | null>(null);

  useEffect(() => {
    if (focus) document.getElementById(focus.id)?.focus();
  }, [focus]);

  /** Shows these errors in place of any before, and puts the cursor in the first. True if there were any. */
  function show(found: FieldErrors<Name>): boolean {
    setErrors(found);
    const first = (Object.keys(ids) as Name[]).find((name) => found[name]);
    if (first) setFocus((current) => ({ id: ids[first], ask: (current?.ask ?? 0) + 1 }));
    return first !== undefined;
  }

  return {
    errors,
    show,
    /** Drops one field's error, as soon as the person starts to fix it. */
    clear(name: Name) {
      setErrors((current) => {
        if (!current[name]) return current;
        const rest = { ...current };
        delete rest[name];
        return rest;
      });
    },
    /**
     * Shows a refusal from the server under its field, if it names one of this form's fields.
     * True if it did. Anything else is for the form's alert.
     */
    showRefusal(failure: unknown): boolean {
      if (!(failure instanceof ApiError) || !failure.field || !(failure.field in ids)) return false;
      return show({ [failure.field]: failure.message } as FieldErrors<Name>);
    },
    /** What a control needs so the outline shows and a screen reader reads its error and hint with it. */
    control(name: Name, options?: { hint?: boolean }) {
      const id = ids[name];
      const describedBy = [errors[name] ? errorId(id) : null, options?.hint ? hintId(id) : null].filter(Boolean).join(" ");
      return { id, "aria-invalid": errors[name] ? true : undefined, "aria-describedby": describedBy || undefined };
    },
  };
}

const errorId = (id: string) => `${id}-error`;
const hintId = (id: string) => `${id}-hint`;

/** The words for a failure the server sent, under a title that says what did not happen. */
export function failureFrom(title: string, failure: unknown): Failure {
  return { title, detail: failure instanceof Error && failure.message ? failure.message : "Something went wrong on our side. Try again in a moment." };
}

/**
 * One field: its label, a red star if it must be filled in, the control, what is
 * wrong with it if anything, and a hint. A field with no star may be left empty.
 */
export function Field({
  id,
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      {children}
      <FieldError id={id} error={error} />
      {hint && (
        <p id={hintId(id)} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A field's label, with the red star after it when the field must be filled in. Field draws it, so use this only where Field does not fit. */
export function FieldLabel({ htmlFor, required, className, children }: { htmlFor: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className={cn("gap-0.5", className)}>
      {children}
      {required && (
        <span aria-hidden className="text-destructive">
          *
        </span>
      )}
    </Label>
  );
}

/** The one 13px line under a control that failed its check. Field draws it, so use this only where Field does not fit. */
export function FieldError({ id, error, className }: { id: string; error?: string; className?: string }) {
  if (!error) return null;
  return (
    <p id={errorId(id)} className={cn("text-[13px] leading-5 text-destructive", className)}>
      {error}
    </p>
  );
}

/**
 * A field with its button beside it, such as an address and Add. The button sits
 * under the control on a phone, and the error line stays right under the control
 * on every screen.
 */
export function FieldWithButton({
  id,
  label,
  required,
  error,
  hint,
  button,
  children,
}: {
  id: string;
  label: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  button: ReactNode;
  children: ReactNode;
}) {
  return (
    <Field id={id} label={label} required={required} hint={hint}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        {children}
        <FieldError id={id} error={error} className="sm:col-start-1 sm:row-start-2" />
        <div className="grid sm:col-start-2 sm:row-start-1">{button}</div>
      </div>
    </Field>
  );
}

/** A failure that is not one field's fault. It sits under the form's buttons, with Try again where trying again could help. */
export function FormAlert({ failure, retry }: { failure: Failure | null; retry?: () => void }) {
  if (!failure) return null;
  return (
    <Alert variant="destructive" className="px-3.5 py-3">
      <AlertCircleIcon />
      <AlertTitle>{failure.title}</AlertTitle>
      {retry ? (
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>{failure.detail}</span>
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </AlertDescription>
      ) : (
        <AlertDescription>{failure.detail}</AlertDescription>
      )}
    </Alert>
  );
}
