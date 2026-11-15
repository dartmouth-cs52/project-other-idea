"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, type Me } from "@/lib/app-api";
import { auth } from "@/lib/auth-client";
import { accessHref } from "@/lib/site";
import { AppNav, Card } from "./parts";
import { SiteView } from "./site-view";

type State = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; me: Me };

export function Dashboard() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const router = useRouter();
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
        if (failure instanceof ApiError && failure.status === 401) return window.location.replace("/sign-in/");
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
      <AppNav who={me ? [me.organization?.name, me.user.email].filter(Boolean).join(", ") : undefined} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
        {state.kind === "loading" && <p className="text-base text-muted-foreground">Signing you in</p>}
        {state.kind === "failed" && <FailedCard message={state.message} />}
        {me && !me.approved && <NotApproved me={me} />}
        {me?.approved && !me.sites?.length && (
          <AddSite
            company={me.organization?.name ?? ""}
            onAdded={async (id) => {
              setState({ kind: "ready", me: await api<Me>("/me") });
              router.replace(`/dashboard/?site=${id}`);
            }}
          />
        )}
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
      <SiteView key={current.id} siteId={current.id} />
    </>
  );
}

function NotApproved({ me }: { me: Me }) {
  const router = useRouter();
  async function signOut() {
    await auth().signOut();
    router.push("/sign-in/");
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
        <Link href={accessHref} className={buttonVariants({ size: "xl" })}>
          Request access
        </Link>
        <Button variant="secondary" size="xl" onClick={signOut}>
          Use a different account
        </Button>
      </div>
    </Card>
  );
}

function AddSite({ company, onAdded }: { company: string; onAdded: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const site = await api<{ id: string }>("/sites", { method: "POST", body: { url } });
      onAdded(site.id);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="grid items-start gap-10 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-medium tracking-[-0.03em] text-balance">Welcome{company ? `, ${company}` : ""}.</h1>
        <p className="text-lg leading-7 text-muted-foreground">
          Paste your site&apos;s address. Haptic reads its public pages while you add the script, then shows you when it connects.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border bg-muted p-6" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="site-url">Your site&apos;s address</Label>
          <Input
            id="site-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://app.example.com"
            autoComplete="url"
            className="h-11 bg-card px-3.5 md:text-base"
            aria-invalid={error ? true : undefined}
          />
          <p className="text-sm text-muted-foreground">The address people use your product at. You can add staging and others later.</p>
        </div>
        <Button type="submit" size="xl" disabled={busy || !url.trim()}>
          {busy ? "Adding" : "Add site"}
        </Button>
        {error && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
    </div>
  );
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
