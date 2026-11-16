"use client";

import { useState, type FormEvent } from "react";
import { AlertCircleIcon, Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/app-api";
import { checkEmail } from "@/lib/setup";
import { CopyLink } from "./agent-pill";
import { DoneMark } from "./parts";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; to: string } | { kind: "failed"; reason: string };

/**
 * Emails the install steps to whoever looks after the code. The site's Worker
 * sends it from install@joinhaptic.com, with replies coming back to the person
 * signed in. It always says whether it went, and why not, with the link to
 * copy beside it.
 */
export function DeveloperEmail({ siteId, installLink }: { siteId: string; installLink: string }) {
  const [to, setTo] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function send(event: FormEvent) {
    event.preventDefault();
    const checked = checkEmail(to);
    if (!checked.ok) {
      setFieldError(checked.message);
      return;
    }
    setFieldError(null);
    setState({ kind: "sending" });
    try {
      // One key per press, so a retry of this press can never send a second email.
      const key = crypto.randomUUID();
      const result = await api<{ sent: boolean; to: string }>(`/sites/${siteId}/developer-email`, { method: "POST", body: { to: checked.email, key } });
      setState({ kind: "sent", to: result.to });
    } catch (failure) {
      setState({ kind: "failed", reason: (failure as Error).message || "The email didn't go out." });
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="flex flex-col gap-3" data-developer-email="sent">
        <p className="flex items-start gap-2 text-base leading-6" role="status">
          <DoneMark className="mt-0.5" />
          <span>
            Sent to <span className="font-medium">{state.to}</span>. Their reply comes to you.
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setTo("");
              setState({ kind: "idle" });
            }}
          >
            Send to someone else
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-developer-email={state.kind}>
      <form onSubmit={send} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`developer-${siteId}`}>Email it to my developer</Label>
          <Input
            id={`developer-${siteId}`}
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="developer@company.com"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setFieldError(null);
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `developer-${siteId}-error` : undefined}
            className="h-11 bg-card px-3.5 md:text-base"
          />
          {fieldError && (
            <p id={`developer-${siteId}-error`} className="text-[13px] leading-5 text-destructive">
              {fieldError}
            </p>
          )}
        </div>
        <Button type="submit" size="xl" variant="secondary" disabled={state.kind === "sending"} className="sm:mt-6">
          <Send />
          {state.kind === "sending" ? "Sending" : "Send"}
        </Button>
      </form>
      {state.kind === "failed" && (
        <div className="flex flex-col gap-3">
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>The email didn&apos;t go out</AlertTitle>
            <AlertDescription>{state.reason}</AlertDescription>
          </Alert>
          <CopyLink link={installLink} label="Copy the link instead" />
        </div>
      )}
      {state.kind !== "failed" && <p className="text-sm text-muted-foreground">They get the install steps, the prompt for a coding agent and the tag, from Haptic, and their reply comes to you.</p>}
    </div>
  );
}
