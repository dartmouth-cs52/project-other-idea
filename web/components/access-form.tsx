"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircleIcon, ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accessEndpoint, site } from "@/lib/site";

type Status = "idle" | "sending" | "sent" | "error";

const EMPTY = { email: "", company: "", firstName: "", lastName: "", details: "", fax: "" };
type Fields = typeof EMPTY;

const FIELD = "h-11 bg-card px-3.5 md:text-base";

/**
 * The form on the request access page, in two short steps. First the work email
 * and company, then a name and anything the person wants to add. It is sent once,
 * at the end.
 */
export function AccessForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [status, setStatus] = useState<Status>("idle");
  // The first step only takes the focus when someone comes back to it, never on page load.
  const [returned, setReturned] = useState(false);
  const thanks = useRef<HTMLHeadingElement>(null);

  // When the request has gone, move the focus to the thank you, so a screen reader reads it.
  useEffect(() => {
    if (status === "sent") thanks.current?.focus();
  }, [status]);

  const bind = (name: keyof Fields) => ({
    name,
    value: fields[name],
    onChange: (event: { target: { value: string } }) => setFields((current) => ({ ...current, [name]: event.target.value })),
  });

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStep(2);
  }

  function back() {
    setReturned(true);
    setStatus("idle");
    setStep(1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    try {
      const response = await fetch(accessEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      setStatus(response.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div role="status" className="rounded-xl border bg-muted p-6 text-2xl leading-8 tracking-[-0.02em] sm:p-8">
        <h2 ref={thanks} tabIndex={-1} className="font-medium outline-none">
          Thank you for your request.
        </h2>
        <p className="mt-1 text-muted-foreground">We will read it and reply to {fields.email || "you"} by email.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted p-6 sm:p-8">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-balance">Request access to Haptic</h2>
      {step === 1 ? (
        <form onSubmit={next} className="mt-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="access-email">Work email</Label>
            <Input id="access-email" type="email" required autoFocus={returned} autoComplete="email" placeholder="jane@acme.co" className={FIELD} {...bind("email")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="access-company">Company</Label>
            <Input id="access-company" type="text" required autoComplete="organization" placeholder="Acme" className={FIELD} {...bind("company")} />
          </div>
          <Button type="submit" size="xl" className="self-start">
            Continue
            <ArrowRight data-icon="inline-end" />
          </Button>
        </form>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="access-first-name">First name</Label>
              <Input id="access-first-name" type="text" required autoFocus autoComplete="given-name" className={FIELD} {...bind("firstName")} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="access-last-name">Last name</Label>
              <Input id="access-last-name" type="text" required autoComplete="family-name" className={FIELD} {...bind("lastName")} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="access-details">Additional details</Label>
              <span className="text-[13px] text-muted-foreground">Optional</span>
            </div>
            <Textarea
              id="access-details"
              rows={4}
              maxLength={2000}
              placeholder="Tell us about your product and where people get stuck."
              className="min-h-28 bg-card px-3.5 py-3 md:text-base"
              {...bind("details")}
            />
          </div>
          {/* Left empty by people, who never see it. Programs that fill in every field give themselves away. */}
          <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
            <label htmlFor="access-fax">Fax</label>
            <input id="access-fax" type="text" tabIndex={-1} autoComplete="off" {...bind("fax")} />
          </div>
          {status === "error" && (
            <Alert variant="destructive" className="px-3.5 py-3">
              <AlertCircleIcon />
              <AlertTitle>That did not go through</AlertTitle>
              <AlertDescription>Email {site.email} and we will set you up.</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" size="xl" onClick={back} disabled={status === "sending"}>
              Back
            </Button>
            <Button type="submit" size="xl" disabled={status === "sending"}>
              {status === "sending" ? "Sending" : "Request access"}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
