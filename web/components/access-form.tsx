"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Field, FormAlert } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { STEP_FIELDS, checkRequest, cleanRequest, type AccessErrors, type AccessField, type AccessRequest } from "@/lib/access-request";
import { accessEndpoint, site } from "@/lib/site";

/** What went wrong with sending, when it was not one field's fault. */
type Failure = "busy" | "failed";
type Status = "idle" | "sending" | "sent" | Failure;

/** `fax` is the trap for programs. See the note on its input below. */
type Fields = AccessRequest & { fax: string };
const EMPTY: Fields = { email: "", company: "", firstName: "", lastName: "", details: "", fax: "" };

const ID: Record<AccessField, string> = {
  email: "access-email",
  company: "access-company",
  firstName: "access-first-name",
  lastName: "access-last-name",
  details: "access-details",
};

const FIELD = "h-11 bg-card px-3.5 md:text-base";

/**
 * The form on the request access page, in two short steps. First the work email
 * and company, then a name and anything the person wants to add. It is sent once,
 * at the end. Every field but the last is required, and each is checked on the
 * page before it is sent and again by the server.
 */
export function AccessForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<AccessErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  // The field to move the focus to, and a count so the same field can be asked for twice.
  const [focus, setFocus] = useState<{ field: AccessField; ask: number } | null>(null);
  const thanks = useRef<HTMLHeadingElement>(null);

  // When the request has gone, move the focus to the thank you, so a screen reader reads it.
  useEffect(() => {
    if (status === "sent") thanks.current?.focus();
  }, [status]);

  // Put the cursor in the first field that needs attention.
  useEffect(() => {
    if (focus) document.getElementById(ID[focus.field])?.focus();
  }, [focus]);

  const ask = (field: AccessField) => setFocus((current) => ({ field, ask: (current?.ask ?? 0) + 1 }));

  const bind = (name: AccessField) => ({
    id: ID[name],
    name,
    value: fields[name],
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${ID[name]}-error` : undefined,
    onChange: (event: { target: { value: string } }) => {
      setFields((current) => ({ ...current, [name]: event.target.value }));
      // The message goes as soon as the person starts to fix the field.
      if (errors[name]) {
        setErrors((current) => {
          const rest = { ...current };
          delete rest[name];
          return rest;
        });
      }
    },
  });

  /** Checks one step. Shows what is wrong and returns false if anything is. */
  function passes(which: 1 | 2): boolean {
    const found = checkRequest(cleanRequest(fields), STEP_FIELDS[which]);
    setErrors(found);
    const first = STEP_FIELDS[which].find((name) => found[name]);
    if (first) ask(first);
    return !first;
  }

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passes(1)) setStep(2);
  }

  function back() {
    setStatus("idle");
    setErrors({});
    setStep(1);
    ask("email");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passes(2)) return;
    setStatus("sending");
    try {
      const response = await fetch(accessEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...cleanRequest(fields), fax: fields.fax }),
      });
      if (response.ok) return setStatus("sent");
      // The server checks again, and can know more than the page, such as whether the email's domain exists.
      const answer = (await response.json().catch(() => null)) as { error?: string; field?: AccessField } | null;
      if (response.status === 400 && answer?.field && answer.error && answer.field in ID) {
        setStatus("idle");
        setErrors({ [answer.field]: answer.error });
        if (STEP_FIELDS[1].includes(answer.field)) setStep(1);
        return ask(answer.field);
      }
      setStatus(response.status === 429 ? "busy" : "failed");
    } catch {
      setStatus("failed");
    }
  }

  if (status === "sent") {
    return (
      <div role="status" className="rounded-xl border bg-muted p-6 text-2xl leading-8 tracking-[-0.02em] sm:p-8">
        <h2 ref={thanks} tabIndex={-1} className="font-medium outline-none">
          Thank you for your request.
        </h2>
        <p className="mt-1 text-muted-foreground">We will read it and reply to {fields.email.trim()} by email.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted p-6 sm:p-8">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-balance">Request access to Haptic</h2>
      {step === 1 ? (
        <form onSubmit={next} noValidate className="mt-6 flex flex-col gap-5">
          <Field id={ID.email} label="Work email" required error={errors.email}>
            <Input type="email" required autoComplete="email" placeholder="name@company.com" className={FIELD} {...bind("email")} />
          </Field>
          <Field id={ID.company} label="Company" required error={errors.company}>
            <Input type="text" required autoComplete="organization" placeholder="Company name" className={FIELD} {...bind("company")} />
          </Field>
          <Button type="submit" size="xl" className="self-start">
            Continue
            <ArrowRight data-icon="inline-end" />
          </Button>
        </form>
      ) : (
        <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
          <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 sm:gap-4">
            <Field id={ID.firstName} label="First name" required error={errors.firstName}>
              <Input type="text" required autoFocus autoComplete="given-name" className={FIELD} {...bind("firstName")} />
            </Field>
            <Field id={ID.lastName} label="Last name" required error={errors.lastName}>
              <Input type="text" required autoComplete="family-name" className={FIELD} {...bind("lastName")} />
            </Field>
          </div>
          <Field id={ID.details} label="Additional details" error={errors.details}>
            <Textarea
              rows={4}
              maxLength={2000}
              placeholder="Tell us about your product and where people get stuck."
              className="min-h-28 bg-card px-3.5 py-3 md:text-base"
              {...bind("details")}
            />
          </Field>
          {/* Left empty by people, who never see it. Programs that fill in every field give themselves away. */}
          <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
            <label htmlFor="access-fax">Fax</label>
            <input
              id="access-fax"
              name="fax"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={fields.fax}
              onChange={(event) => setFields((current) => ({ ...current, fax: event.target.value }))}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" size="xl" onClick={back} disabled={status === "sending"}>
              Back
            </Button>
            <Button type="submit" size="xl" disabled={status === "sending"}>
              {status === "sending" ? "Sending" : "Request access"}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
          <FormAlert
            failure={
              status === "busy"
                ? { title: "Too many tries", detail: "Wait a minute, then send it again." }
                : status === "failed"
                  ? { title: "That did not go through", detail: `Email ${site.email} and we will set you up.` }
                  : null
            }
          />
        </form>
      )}
    </div>
  );
}
