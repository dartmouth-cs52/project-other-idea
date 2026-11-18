"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormAlert } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, api, type Me } from "@/lib/app-api";
import { auth } from "@/lib/auth-client";
import { siteAt } from "@/lib/dashboard";
import { accessHref } from "@/lib/site";
import { SITES_HREF, viewFrom } from "./nav";
import { Card, FailedCard } from "./parts";
import { Plain, useSignOut } from "./shell";
import { BillingPage } from "./billing";
import { TeamPage } from "./team";
import { SiteView } from "./site-view";
import { SitesIndex } from "./sites-index";

type State = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; me: Me };

/**
 * Everything behind sign-in, on one page. The address chooses what it shows:
 * a site and one of its pages when it names the site, and the list of sites
 * when it names none, which is where sign-in lands. A company with no site
 * yet is sent to the setup screens.
 */
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

  if (state.kind === "loading") {
    return (
      <Plain>
        <p className="text-base text-muted-foreground">Signing you in</p>
      </Plain>
    );
  }
  if (state.kind === "failed") {
    return (
      <Plain>
        <FailedCard className="max-w-2xl" title="Something went wrong" message={state.message} retry={() => window.location.reload()} />
      </Plain>
    );
  }

  const { me } = state;
  if (!me.approved) {
    return (
      <Plain me={me}>
        <NotApproved me={me} />
      </Plain>
    );
  }

  const sites = me.sites ?? [];
  const view = params.get("view");
  // Billing and the team are the company's, not a site's, so they have the plain frame. A company with no site can reach them too.
  if (view === "billing") {
    return (
      <Plain me={me}>
        <BillingPage />
      </Plain>
    );
  }
  if (view === "team") {
    return (
      <Plain me={me}>
        <TeamPage />
      </Plain>
    );
  }

  if (!sites.length) {
    return (
      <Plain me={me}>
        <ToSetup />
      </Plain>
    );
  }

  // A site opens only when the address names it. Everything else is the list, for a company with one site as for one with several.
  const current = siteAt(sites, params);
  if (!current) {
    return (
      <Plain me={me} wide>
        <SitesIndex me={me} />
      </Plain>
    );
  }
  return (
    <SiteView
      key={current.id}
      me={me}
      row={current}
      view={viewFrom(view)}
      // The list of sites, not whichever site is left: a site was just deleted, and landing inside another one says nothing about that.
      onDeleted={() => window.location.replace(SITES_HREF)}
      onRenamed={() => void api<Me>("/me").then((next) => setState({ kind: "ready", me: next }), () => undefined)}
    />
  );
}

function NotApproved({ me }: { me: Me }) {
  const { signOut, signingOut, failure } = useSignOut();
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
        <Button variant="secondary" size="xl" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out" : "Use a different account"}
        </Button>
      </div>
      <FormAlert failure={failure} retry={signOut} />
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
