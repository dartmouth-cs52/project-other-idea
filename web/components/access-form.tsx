"use client";

import { useState, type FormEvent } from "react";
import { AlertCircleIcon, ArrowRight, CircleCheckIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accessEndpoint, site } from "@/lib/site";

type Status = "idle" | "sending" | "sent" | "error";

/** The form on the request access page. It asks for a work email and a company, and nothing else. */
export function AccessForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setStatus("sending");
    try {
      const response = await fetch(accessEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), company: data.get("company") }),
      });
      setStatus(response.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="rounded-xl border bg-muted p-6 sm:p-8">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-balance">Request access to Haptic</h2>
      {status === "sent" ? (
        <Alert role="status" className="mt-6 px-3.5 py-3">
          <CircleCheckIcon className="text-success!" />
          <AlertTitle>Request sent</AlertTitle>
          <AlertDescription>Thanks. We have your details and will be in touch soon.</AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="access-email">Work email</Label>
            <Input id="access-email" name="email" type="email" required autoComplete="email" placeholder="jane@acme.co" className="h-11 bg-card px-3.5 md:text-base" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="access-company">Company</Label>
            <Input id="access-company" name="company" type="text" autoComplete="organization" placeholder="Acme" className="h-11 bg-card px-3.5 md:text-base" />
          </div>
          {status === "error" && (
            <Alert variant="destructive" className="px-3.5 py-3">
              <AlertCircleIcon />
              <AlertTitle>That did not go through</AlertTitle>
              <AlertDescription>Email {site.email} and we will set you up.</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="xl" disabled={status === "sending"} className="self-start">
            {status === "sending" ? "Sending" : "Request access"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </form>
      )}
    </div>
  );
}
