"use client";

import { useState, type FormEvent } from "react";
import { Field, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Input } from "@/components/ui/input";
import { checkAddress } from "@/lib/setup";
import { Primary, StepFrame } from "./frame";

/**
 * Step 1. The app's address, and nothing else. It is checked here the way the
 * Worker checks it, so most mistakes show at once under the field. A refusal
 * from the Worker that names the address shows there too.
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
  /** Adds the site, or keeps the current one. Resolves with the failure, if there was one. */
  onSubmit: (origin: string, url: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(current ? new URL(current).host : "");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = useFieldErrors({ url: "setup-address" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const checked = checkAddress(value);
    if (fields.show({ url: checked.ok ? undefined : checked.message })) return;
    if (!checked.ok) return;
    setBusy(true);
    const error = await onSubmit(checked.origin, checked.url);
    if (error) {
      if (!fields.showRefusal(error)) setFailure(failureFrom("Couldn't add your app", error));
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
        after={
          failure && (
            <div className="max-w-xl">
              <FormAlert failure={failure} />
            </div>
          )
        }
      >
        <div className="flex max-w-xl flex-col gap-3">
          <Field
            id="setup-address"
            label={<span className="text-base">Your app&apos;s address</span>}
            required
            error={fields.errors.url}
            hint={
              fields.errors.url
                ? undefined
                : current
                  ? "A different address keeps everything you set up here, and Haptic reads your pages again from it."
                  : "The address people use your product at. You can add staging and others later."
            }
          >
            <Input
              {...fields.control("url", { hint: true })}
              required
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                fields.clear("url");
              }}
              placeholder="app.example.com"
              autoComplete="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              className="h-12 bg-card px-4 text-lg md:text-lg"
            />
          </Field>
          <p className="text-sm leading-5 text-pretty text-muted-foreground">By continuing you confirm you can add Haptic to this site.</p>
        </div>
      </StepFrame>
    </form>
  );
}
