"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircleIcon } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Pointer } from "@/components/pointer";
import { Button } from "@/components/ui/button";
import { ApiError, api, type Me } from "@/lib/app-api";
import { auth } from "@/lib/auth-client";
import { nextStep, previousStep, SETUP_STEPS, stepFor, stepIndex, type SetupStepId } from "@/lib/setup";
import { site as brand } from "@/lib/site";
import { leaveFor } from "../parts";
import { AddressStep } from "./address-step";
import { ConnectStep } from "./connect-step";
import { useEnterToContinue } from "./frame";
import { InstallStep } from "./install-step";
import { LearnedStep } from "./learned-step";
import { ReadingStep } from "./reading-step";
import type { SetupSite } from "./types";
import { useSetupReading } from "./use-reading";

/** How often the install check is asked for while the script hasn't been seen. Vercel's pill asks every 3 seconds. */
const WATCH_MS = 3_000;
const IDLE_MS = 15_000;

function firstName(name: string | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

/**
 * Adding a site, one question per screen: the address, reading the site, what
 * Haptic learned, adding the script, and seeing it connect. The screen comes
 * from the site, which keeps the last one shown, so a reload lands back on it.
 * The steps are listed in lib/setup.ts, and a screen is added there and here.
 */
export function SetupFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const siteId = params.get("site");
  const [me, setMe] = useState<Me | null>(null);
  const [site, setSite] = useState<SetupSite | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Null until someone moves, so the first screen comes from the site as it loads.
  const [chosen, setChosen] = useState<{ step: SetupStepId; for: string | null } | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  // Where the setup is, when saving it failed: shown on every screen with Retry, until a save goes through.
  const [unsaved, setUnsaved] = useState<{ id: string; body: Record<string, unknown> } | null>(null);
  const pages = useSetupReading(site);
  useEnterToContinue();

  // Who is signed in. Sign-in links land on the dashboard, so this only sends people back where they belong.
  useEffect(() => {
    let live = true;
    (async () => {
      await auth().getSession();
      try {
        const answer = await api<Me>("/me");
        if (!live) return;
        if (!answer.approved) return window.location.replace("/dashboard/");
        setMe(answer);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return window.location.replace("/sign-in/");
        if (live) setFailure((error as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const next = await api<SetupSite>(`/sites/${siteId}`);
      // A site that finished its setup, or was set up before these screens, belongs on the dashboard.
      if (next.setup?.finishedAt || (next.connected && !next.setup)) return router.replace(`/dashboard/?site=${siteId}`);
      setSite(next);
      setFailure(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return router.replace("/dashboard/");
      if (error instanceof ApiError && error.status === 401) return window.location.replace("/sign-in/");
      setFailure((error as Error).message);
    }
  }, [siteId, router]);

  // The install check, often while waiting for the script, and only while the tab is in view.
  const watching = Boolean(site && !site.connected);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), watching ? WATCH_MS : IDLE_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, watching]);

  const current = site && site.id === siteId ? site : null;
  const step: SetupStepId | null = chosen && chosen.for === siteId ? chosen.step : !siteId ? "address" : current ? stepFor(current) : null;

  /** Saves where the setup is on the site. True when it went. When it didn't, every screen says so, with Retry. */
  async function save(body: Record<string, unknown>, id = siteId): Promise<boolean> {
    if (!id) return true;
    try {
      await api(`/sites/${id}/setup`, { method: "PUT", body });
      setUnsaved(null);
      return true;
    } catch {
      setUnsaved({ id, body });
      return false;
    }
  }

  /** Moves to a screen and keeps it on the site, so a reload comes back to it. */
  function go(next: SetupStepId, way: 1 | -1 = 1) {
    setDirection(way);
    setChosen({ step: next, for: siteId });
    window.scrollTo({ top: 0 });
    if (next !== "address") void save({ step: next, later: false });
  }
  const forward = () => step && nextStep(step) && go(nextStep(step)!, 1);
  const back = () => step && previousStep(step) && go(previousStep(step)!, -1);

  /** Leaves for the dashboard whatever happens. If Finish later couldn't be saved, the address says so, so it doesn't send them back. */
  async function later() {
    const saved = await save({ later: true });
    router.push(siteId ? `/dashboard/?site=${siteId}${saved ? "" : "&later=1"}` : "/dashboard/");
  }

  async function finish() {
    const saved = await save({ finished: true, step: "connect" });
    router.push(`/dashboard/?site=${siteId}${saved ? "" : "&later=1"}`);
  }

  /**
   * Step 1's answer. The same address carries on. A new one changes this site in place, keeping all
   * that was set up and its id: the Worker refuses, with a reason shown on the screen, once the script
   * has called from anywhere. With no site yet, one is added. A site is never deleted from here.
   * Resolves with any failure.
   */
  async function choose(origin: string, url: string): Promise<unknown> {
    try {
      if (current && current.origin === origin) {
        go("reading");
        return;
      }
      if (current) {
        await api(`/sites/${current.id}/address`, { method: "PUT", body: { url } });
        await load();
        go("reading");
        return;
      }
      const added = await api<{ id: string }>("/sites", { method: "POST", body: { url } });
      await save({ step: "reading" }, added.id);
      setSite(null);
      setDirection(1);
      setChosen({ step: "reading", for: added.id });
      router.replace(`/dashboard/setup/?site=${added.id}`);
    } catch (error) {
      return error;
    }
  }

  const index = step ? stepIndex(step) : 0;
  const hasSites = Boolean(me?.sites?.length);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl shrink-0 items-center justify-between gap-4 px-6">
        {/* A plain link, not next/link, for the reason given at leaveFor. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="flex items-center gap-1.5 rounded-md text-lg font-medium tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Pointer className="size-[22px]" />
          {brand.name}
        </a>
        {current?.connected && step === "connect" ? null : siteId && step && step !== "address" ? (
          <Button variant="ghost" size="lg" onClick={later}>
            Finish later
          </Button>
        ) : hasSites ? (
          <Button variant="ghost" size="lg" onClick={() => router.push("/dashboard/")}>
            Back to the dashboard
          </Button>
        ) : me ? (
          <Button
            variant="ghost"
            size="lg"
            onClick={async () => {
              await auth().signOut();
              leaveFor("/sign-in/");
            }}
          >
            Sign out
          </Button>
        ) : null}
      </header>
      <div className="h-0.5 w-full bg-border" role="progressbar" aria-label="Setup" aria-valuemin={1} aria-valuemax={SETUP_STEPS.length} aria-valuenow={index + 1}>
        <div className="h-full bg-primary transition-[width] duration-250 ease-out motion-reduce:transition-none" style={{ width: `${((index + 1) / SETUP_STEPS.length) * 100}%` }} />
      </div>
      {unsaved && (
        <div className="mx-auto w-full max-w-2xl px-6 pt-6">
          <Alert variant="destructive" className="px-3.5 py-3">
            <AlertCircleIcon />
            <AlertTitle>Couldn&apos;t save where you are</AlertTitle>
            <AlertDescription>
              <span>If you leave now, the setup may open on an earlier screen next time.</span>
              <Button variant="secondary" size="sm" className="mt-2 w-fit" onClick={() => void save(unsaved.body, unsaved.id)}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <main className="flex flex-1 flex-col px-6 py-10 sm:py-16">
        <div className={cn("mx-auto my-auto w-full", step === "install" ? "max-w-3xl" : "max-w-2xl")}>
          {failure && !current && siteId ? (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-medium tracking-[-0.02em]">Something went wrong</h1>
              <p className="text-base text-muted-foreground">{failure}</p>
              <Button variant="secondary" className="self-start" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : !step || (siteId && !current) || !me ? (
            <p className="text-base text-muted-foreground">Loading</p>
          ) : (
            <div
              key={`${siteId ?? ""} ${step}`}
              className={cn(
                "animate-in fade-in duration-200 ease-out motion-reduce:animate-none",
                direction === 1 ? "slide-in-from-bottom-2" : "slide-in-from-top-2",
              )}
            >
              {step === "address" && <AddressStep name={firstName(me.user.name)} current={current?.origin} onSubmit={choose} />}
              {step === "reading" && current && <ReadingStep origin={current.origin} pages={pages} onBack={back} onNext={forward} />}
              {step === "learned" && current && <LearnedStep site={current} pages={pages} onChange={setSite} onBack={back} onNext={forward} />}
              {step === "install" && current && <InstallStep site={current} onBack={back} onNext={forward} />}
              {step === "connect" && current && <ConnectStep site={current} onChange={setSite} onBack={back} onFinish={finish} onLater={later} />}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
