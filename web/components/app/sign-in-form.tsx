"use client";

import { useState, type FormEvent } from "react";
import { Field, FormAlert, useFieldErrors, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emailProblem } from "@/lib/access-request";
import { auth, dashboardUrl } from "@/lib/auth-client";
import { site } from "@/lib/site";

/** What Neon Auth's errors mean to the person who sees them. */
const LINK_ERRORS: Record<string, Failure> = {
  INVALID_TOKEN: { title: "That sign-in link no longer works", detail: "It has been used already, or it has expired. Ask for a new one below." },
  EXPIRED_TOKEN: { title: "That sign-in link has expired", detail: "Ask for a new one below." },
};
const LINK_FAILED: Failure = { title: "That sign-in didn't work", detail: "Try again below." };

/** The HTTP status of an auth call that failed, whether the auth client returned the error or threw it. */
function statusOf(failure: unknown): number | undefined {
  const { status, error } = (failure ?? {}) as { status?: unknown; error?: { status?: unknown } };
  const found = error?.status ?? status;
  return typeof found === "number" ? found : undefined;
}

/**
 * Sign-in with an emailed link or Google. Anyone can get this far: whether
 * they get a dashboard is decided by the approved list, on the next page.
 */
export function SignInForm({ linkError }: { linkError?: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "google">("idle");
  const [failure, setFailure] = useState<Failure | null>(linkError ? (LINK_ERRORS[linkError] ?? LINK_FAILED) : null);
  const fields = useFieldErrors({ email: "sign-in-email" });

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    setFailure(null);
    if (fields.show({ email: emailProblem(address) ?? undefined })) return;
    setStatus("sending");
    // Better Auth's magic link endpoint, through our proxy. The SDK has it at runtime but not in its types.
    const response = await fetch("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: address, callbackURL: dashboardUrl() }),
    }).catch(() => null);
    if (!response?.ok) {
      setStatus("idle");
      setFailure(
        response?.status === 429
          ? { title: "Too many tries", detail: "Wait a minute, then ask for the link again." }
          : { title: "Couldn't send the link", detail: `Try again in a moment. If it keeps happening, email ${site.email}.` },
      );
      return;
    }
    setStatus("sent");
  }

  async function google() {
    setFailure(null);
    fields.show({});
    setStatus("google");
    // On success the auth client takes the page to Google, so there is nothing more to do here.
    let failed: unknown;
    try {
      ({ error: failed } = await auth().signIn.social({ provider: "google", callbackURL: dashboardUrl() }));
    } catch (error) {
      // The client throws, more often than it returns an error: when the server turns the call down, and when it
      // can't be reached at all. Either way the buttons come back, or the page would say "Opening Google" for good.
      failed = error ?? new Error("Google sign-in failed");
    }
    if (!failed) return;
    setStatus("idle");
    setFailure(
      statusOf(failed) === 429
        ? { title: "Too many tries", detail: "Wait a minute, then try again." }
        : { title: "Couldn't open Google", detail: "Try again, or use an emailed link." },
    );
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border bg-muted p-6">
        <h2 className="text-2xl font-medium tracking-[-0.02em]">
          Check your email
        </h2>
        <p className="text-base leading-6 text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{email.trim().toLowerCase()}</span>. It works for 24 hours, on this
          device or any other.
        </p>
        <Button variant="secondary" size="lg" className="mt-4 self-start" onClick={() => setStatus("idle")}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-xl border bg-muted p-6">
      <Button variant="secondary" size="xl" onClick={google} disabled={status !== "idle"}>
        <GoogleMark />
        {status === "google" ? "Opening Google" : "Continue with Google"}
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={sendLink} className="flex flex-col gap-5" noValidate>
        <Field id="sign-in-email" label="Work email" required error={fields.errors.email}>
          <Input
            {...fields.control("email")}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              fields.clear("email");
            }}
            placeholder="name@company.com"
            className="h-11 bg-card px-3.5 md:text-base"
          />
        </Field>
        <Button type="submit" size="xl" disabled={status !== "idle"}>
          {status === "sending" ? "Sending" : "Email me a sign-in link"}
        </Button>
        <FormAlert failure={failure} />
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
