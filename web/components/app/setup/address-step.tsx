"use client";

import { useState, type FormEvent } from "react";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkAddress } from "@/lib/setup";
import { Primary, StepFrame } from "./frame";

/**
 * Step 1. The app's address, and nothing else. It is checked here the way the
 * Worker checks it, so most mistakes show at once under the field.
 */
export function AddressStep({
  name,
  current,
  onSubmit,
}: {
  /** First name, when sign-in gave one. */
  name?: string;
  /** The address already chosen, when someone came back to change it. */
  current?: string;
  /** Adds the site, or keeps the current one. Resolves with an error to show, or nothing. */
  onSubmit: (origin: string, url: string) => Promise<string | undefined>;
}) {
  const [value, setValue] = useState(current ? new URL(current).host : "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = checkAddress(value);
    if (!checked.ok) {
      setFieldError(checked.message);
      return;
    }
    setBusy(true);
    setFailure(null);
    const error = await onSubmit(checked.origin, checked.url);
    if (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <StepFrame
        step="address"
        focusHeading={false}
        title={
          <>
            {name ? <span className="block text-muted-foreground">Welcome, {name}.</span> : null}
            What&apos;s the address of your app?
          </>
        }
        lead="Haptic reads its public pages while you add the script, then shows you the moment it connects."
        actions={
          <Primary type="submit" disabled={busy}>
            {busy ? "Adding your app" : "Continue"}
          </Primary>
        }
      >
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="setup-address" className="text-base">
            Your app&apos;s address
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="setup-address"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setFieldError(null);
            }}
            placeholder="app.example.com"
            autoComplete="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "setup-address-error" : "setup-address-note"}
            className="h-12 bg-card px-4 text-lg md:text-lg"
          />
          {fieldError ? (
            <p id="setup-address-error" className="text-[13px] leading-5 text-destructive">
              {fieldError}
            </p>
          ) : (
            <p id="setup-address-note" className="text-sm leading-5 text-muted-foreground">
              The address people use your product at. You can add staging and others later.
            </p>
          )}
          <p className="text-sm leading-5 text-muted-foreground">By continuing you confirm you can add Haptic to this site.</p>
          {current && <p className="text-sm leading-5 text-muted-foreground">A different address starts reading again from that one.</p>}
        </div>
        {failure && (
          <Alert variant="destructive" className="max-w-xl">
            <AlertCircleIcon />
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
      </StepFrame>
    </form>
  );
}
