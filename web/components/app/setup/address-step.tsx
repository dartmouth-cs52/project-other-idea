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
  /** `map` is whether they want Haptic to map the screens behind their login. It is only asked when the site is first added. */
  onSubmit: (origin: string, url: string, map: boolean) => Promise<unknown>;
}) {
  const [value, setValue] = useState(current ? new URL(current).host : "");
  const [map, setMap] = useState(true);
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
    const error = await onSubmit(checked.origin, checked.url, map);
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
          {/* Asked here so the choice is made once, up front. Mapping runs through the script, so it starts after the script connects. */}
          {!current && (
            <label htmlFor="setup-map" className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4">
              <input
                id="setup-map"
                type="checkbox"
                checked={map}
                onChange={(event) => setMap(event.target.checked)}
                aria-describedby="setup-map-about"
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="flex flex-col gap-1">
                <span className="text-base font-medium">Let Haptic map the screens behind my login</span>
                <span id="setup-map-about" className="text-sm leading-5 text-pretty text-muted-foreground">
                  Once the script is on your app, you sign in as usual and Haptic goes through it in your own browser. It opens pages, menus and
                  tabs, keeps only the names of buttons, links and fields, and never types, submits or sees your password. Nothing runs until you
                  press Start, and you can change this later.
                </span>
              </span>
            </label>
          )}
          <p className="text-sm leading-5 text-pretty text-muted-foreground">By continuing you confirm you can add Haptic to this site.</p>
        </div>
      </StepFrame>
    </form>
  );
}
