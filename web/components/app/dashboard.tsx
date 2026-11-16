"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, api, type Me } from "@/lib/app-api";
import { auth } from "@/lib/auth-client";
import { accessHref } from "@/lib/site";
import { AppNav, Card, leaveFor } from "./parts";
import { SiteView } from "./site-view";

/** The first word of the person's name, from Google. Someone who signed in by an emailed link has none. */
function firstName(name: string | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

type State = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; me: Me };

export function Dashboard() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const params = useSearchParams();

  useEffect(() => {
    let live = true;
    (async () => {
      // This first check also finishes a sign-in: an emailed link or Google lands here with a
      // one-time verifier in the address, and the auth client trades it for the session cookie.
      await auth().getSession();
      try {
        const me = await api<Me>("/me");
        if (live) setState({ kind: "ready", me });
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 401) {
          // A sign-in link that was already used or has expired comes back here with an error in the address.
          // Take it along, so the sign-in page can say what happened.
          const linkError = new URLSearchParams(window.location.search).get("error");
          return window.location.replace(linkError ? `/sign-in/?error=${encodeURIComponent(linkError)}` : "/sign-in/");
        }
        if (live) setState({ kind: "failed", message: (failure as Error).message });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const me = state.kind === "ready" ? state.me : undefined;
  return (
    <>
      <AppNav who={me ? (firstName(me.user.name) ?? me.user.email) : undefined} email={me?.user.email} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
        {state.kind === "loading" && <p className="text-base text-muted-foreground">Signing you in</p>}
        {state.kind === "failed" && <FailedCard message={state.message} />}
        {me && !me.approved && <NotApproved me={me} />}
        {me?.approved && !me.sites?.length && <ToSetup />}
        {me?.approved && me.sites?.length ? <SiteSwitch me={me} chosen={params.get("site")} /> : null}
      </main>
    </>
  );
}

function SiteSwitch({ me, chosen }: { me: Me; chosen: string | null }) {
  const sites = me.sites ?? [];
  const current = sites.find((site) => site.id === chosen) ?? sites[0]!;
  return (
    <>
      {sites.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Sites">
          {sites.map((site) => (
            <Link key={site.id} href={`/dashboard/?site=${site.id}`} className={buttonVariants({ variant: site.id === current.id ? "default" : "secondary" })}>
              {site.name}, {new URL(site.origin).host}
            </Link>
          ))}
        </nav>
      )}
      <SiteView key={current.id} siteId={current.id} onDeleted={() => window.location.replace("/dashboard/")} />
    </>
  );
}

function NotApproved({ me }: { me: Me }) {
  async function signOut() {
    await auth().signOut();
    leaveFor("/sign-in/");
  }
  return (
    <Card className="max-w-2xl">
      <h1 className="text-2xl font-medium tracking-[-0.02em]">{me.reason === "unverified" ? "Confirm your email first" : "You are signed in, but not approved yet"}</h1>
      <p className="text-base leading-6 text-muted-foreground">
        {me.reason === "unverified"
          ? "Sign in with an emailed link or with Google, so we know the address is yours."
          : `Haptic is in early access, and ${me.user.email} is not on the list yet. Request access and we will be in touch. If your company already uses Haptic, ask whoever set it up to get your address approved.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {/* A plain link, not next/link: see leaveFor. */}
        <a href={accessHref} className={buttonVariants({ size: "xl" })}>
          Request access
        </a>
        <Button variant="secondary" size="xl" onClick={signOut}>
          Use a different account
        </Button>
      </div>
    </Card>
  );
}

/** A company with no site yet adds its first one on the setup screens, one question at a time. */
function ToSetup() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/setup/");
  }, [router]);
  return <p className="text-base text-muted-foreground">Taking you to setup</p>;
}

function FailedCard({ message }: { message: string }) {
  return (
    <Card className="max-w-2xl">
      <h1 className="text-2xl font-medium tracking-[-0.02em]">Something went wrong</h1>
      <p className="text-base text-muted-foreground">{message}</p>
      <Button variant="secondary" className="self-start" onClick={() => window.location.reload()}>
        Try again
      </Button>
    </Card>
  );
}
