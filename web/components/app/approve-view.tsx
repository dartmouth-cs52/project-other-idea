"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FormAlert, failureFrom, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/app-api";
import { Card, FailedCard, WRAPS } from "./parts";

interface Request {
  name: string;
  email: string;
  company: string;
  details: string;
  domain: string;
  domainAllowed: boolean;
  approved: { email: boolean; domain: boolean };
}

/**
 * The team's page for one access request, reached from the link in its email.
 * Opening the link changes nothing, so a mail scanner that follows it cannot
 * approve anyone. Only a press of a button does.
 */
export function ApproveView() {
  const params = useSearchParams();
  const key = params.get("key") ?? "";
  const sig = params.get("sig") ?? "";
  const [request, setRequest] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<{ scope: string; sent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Request>(`/approve?${new URLSearchParams({ key, sig })}`).then(setRequest, (failure: Error) => setError(failure.message));
  }, [key, sig]);

  async function approve(scope: "email" | "domain") {
    setBusy(true);
    setFailure(null);
    try {
      setDone(await api<{ scope: string; sent: boolean }>("/approve", { method: "POST", body: { key, sig, scope } }));
    } catch (failure) {
      setFailure(failureFrom("Couldn't approve", failure));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <FailedCard className="max-w-2xl" title="This link does not work" message={error} />;
  if (!request) return <p className="text-base text-muted-foreground">Loading the request</p>;

  // A work email or a company's name can be longer than a phone is wide, and an email is one word to the browser,
  // so the words on this page may break anywhere rather than run off the screen.
  if (done) {
    return (
      <Card className="max-w-2xl [overflow-wrap:anywhere]">
        <h1 className="text-2xl font-medium tracking-[-0.02em]">{done.scope === "domain" ? `Everyone at ${request.domain} is approved` : `${request.email} is approved`}</h1>
        <p className="text-base leading-6 text-muted-foreground">
          {done.sent
            ? `${request.name} has been emailed a sign-in link. Their first sign-in sets up ${request.company}.`
            : `The sign-in link did not send. ${request.name} can still sign in at joinhaptic.com, and is let straight in.`}
        </p>
      </Card>
    );
  }

  const already = request.approved.email || request.approved.domain;
  return (
    <Card className="max-w-2xl [overflow-wrap:anywhere]">
      <h1 className="text-2xl font-medium tracking-[-0.02em]">Approve {request.company}</h1>
      {/* On a phone each name sits over its value, so an email has the panel's whole width. */}
      <dl className="grid grid-cols-1 gap-x-6 rounded-lg border bg-card p-4 text-base sm:grid-cols-[auto_1fr] sm:gap-y-2">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{request.name}</dd>
        <dt className="mt-3 text-muted-foreground sm:mt-0">Email</dt>
        <dd>{request.email}</dd>
        <dt className="mt-3 text-muted-foreground sm:mt-0">Company</dt>
        <dd>{request.company}</dd>
        {request.details && (
          <>
            <dt className="mt-3 text-muted-foreground sm:mt-0">Details</dt>
            <dd className="whitespace-pre-wrap">{request.details}</dd>
          </>
        )}
      </dl>
      {already && (
        <p className="text-base text-muted-foreground">
          {request.approved.domain ? `Everyone at ${request.domain} is already approved.` : `${request.email} is already approved.`} Approving again sends a new sign-in link.
        </p>
      )}
      {/* Each button says whom it approves in full, on more than one line when it must. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button size="xl" onClick={() => approve("email")} disabled={busy} className={WRAPS}>
          Approve {request.email}
        </Button>
        {request.domainAllowed && (
          <Button size="xl" variant="secondary" onClick={() => approve("domain")} disabled={busy} className={WRAPS}>
            Approve everyone at {request.domain}
          </Button>
        )}
      </div>
      <p className="text-sm leading-5 text-muted-foreground">
        {request.domainAllowed
          ? `Approving the domain lets anyone with an ${request.domain} address sign in, and they all join the same company.`
          : `${request.domain} is a free mailbox, so only this one address can be approved.`}
      </p>
      <FormAlert failure={failure} />
    </Card>
  );
}
