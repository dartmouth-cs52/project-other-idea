"use client";

import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { FieldWithButton, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/app-api";
import { checkEmail } from "@/lib/setup";
import { CopyLink } from "./agent-pill";
import { DoneMark } from "./parts";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; to: string } | { kind: "failed"; failure: Failure };

/**
 * Emails the install steps to whoever looks after the code. The site's Worker
 * sends it from install@joinhaptic.com, with replies coming back to the person
 * signed in. It always says whether it went, and why not, with the link to
 * copy beside it.
 */
export function DeveloperEmail({ siteId, installLink }: { siteId: string; installLink: string }) {
  const [to, setTo] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const id = `developer-${siteId}`;
  const fields = useFieldErrors({ to: id });

  async function send(event: FormEvent) {
    event.preventDefault();
    const checked = checkEmail(to);
    if (fields.show({ to: checked.ok ? undefined : checked.message }) || !checked.ok) return;
    setState({ kind: "sending" });
    try {
      // One key per press, so a retry of this press can never send a second email.
      const key = crypto.randomUUID();
      const result = await api<{ sent: boolean; to: string }>(`/sites/${siteId}/developer-email`, { method: "POST", body: { to: checked.email, key } });
      setState({ kind: "sent", to: result.to });
    } catch (failure) {
      // A refusal about the address goes under the field. Anything else is said in the alert, with the link beside it.
      if (fields.showRefusal(failure)) setState({ kind: "idle" });
      else setState({ kind: "failed", failure: failureFrom("The email didn't go out", failure) });
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
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => {
            setTo("");
            setState({ kind: "idle" });
          }}
        >
          Send to someone else
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-developer-email={state.kind}>
      <form onSubmit={send} noValidate>
        <FieldWithButton
          id={id}
          label="Email it to my developer"
          required
          error={fields.errors.to}
          hint={state.kind === "failed" ? undefined : "They get the install steps, the prompt for a coding agent and the tag, from Haptic, and their reply comes to you."}
          button={
            <Button type="submit" size="xl" variant="secondary" disabled={state.kind === "sending"}>
              <Send />
              {state.kind === "sending" ? "Sending" : "Send"}
            </Button>
          }
        >
          <Input
            {...fields.control("to", { hint: state.kind !== "failed" })}
            required
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="developer@company.com"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              fields.clear("to");
            }}
            className="h-11 bg-card px-3.5 md:text-base"
          />
        </FieldWithButton>
      </form>
      {state.kind === "failed" && (
        <div className="flex flex-col gap-3">
          <FormAlert failure={state.failure} />
          <CopyLink link={installLink} label="Copy the link instead" />
        </div>
      )}
    </div>
  );
}
