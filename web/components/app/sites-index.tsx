"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, type Me, type SiteCard } from "@/lib/app-api";
import { hostOf } from "@/lib/setup";
import { Spark } from "./chart";
import { usePolled } from "./live";
import { NEW_SITE_HREF, siteHref } from "./nav";
import { DashboardSurface, FailedCard, GuideStatus, PageHeader, SiteIcon, useNow, when } from "./parts";
import { Reconnecting } from "./site-view";
import { BillingNotice } from "./upgrade";

/** How often the list of sites asks what is new. Each card is a few counts, so this is slower than a site's own page. */
const SITES_MS = 3_000;


/**
 * Every site a company has, one card each, kept current. A card says how many
 * questions the last week had, the shape of the last fortnight, and the newest
 * question. A site still waiting for its script says so in place of numbers:
 * numbers on a card are what say a site is running, so no badge repeats it.
 * The whole card is the way in.
 */
export function SitesIndex({ me }: { me: Me }) {
  // Try again starts the list over, so its placeholders show while it asks again.
  const [attempt, setAttempt] = useState(0);
  return <Sites key={attempt} me={me} retry={() => setAttempt((count) => count + 1)} />;
}

function Sites({ me, retry }: { me: Me; retry: () => void }) {
  const { data, failing } = usePolled<{ sites: SiteCard[] }>(`/sites?${clock()}`, SITES_MS);
  useNow();
  // Until the counts arrive, the names from sign-in hold each card's place.
  const sites = data ? [...data.sites].sort(byActivity) : undefined;
  const names = me.sites ?? [];

  return (
    <DashboardSurface>
      <PageHeader title="Sites">
        {/* Once the cards are in, a list that has stopped hearing from the server says so, as a site's pages do. */}
        <Reconnecting failing={failing && Boolean(data)} />
        <Link href={NEW_SITE_HREF} className={buttonVariants()}>
          <Plus />
          Add a site
        </Link>
      </PageHeader>
      <BillingNotice me={me} />
      {/* The list keeps asking, so the cards still arrive by themselves once the server answers. */}
      {failing && !data ? (
        <FailedCard level={2} title="Your sites didn't load" message="Haptic couldn't be reached, or something went wrong on our side. Try again in a moment." retry={retry} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sites
            ? sites.map((site) => (
                <li key={site.id}>
                  {/* A new site is named after its company, so two can share a name. Only then does a card carry its address. */}
                  <Card site={site} address={sites.filter((other) => other.name === site.name).length > 1} />
                </li>
              ))
            : names.map((site) => (
                <li key={site.id}>
                  <Skeleton className="h-52 rounded-xl" />
                </li>
              ))}
        </ul>
      )}
    </DashboardSurface>
  );
}

/**
 * The order of the cards: sites whose script is running first, the one asked
 * most recently at their head, then the ones still waiting for the script. So
 * the first card is the one with something happening on it.
 */
function byActivity(a: SiteCard, b: SiteCard): number {
  if (a.connected !== b.connected) return Number(b.connected) - Number(a.connected);
  const asked = (site: SiteCard) => (site.last ? new Date(site.last.started_at).getTime() : 0);
  return asked(b) - asked(a) || a.name.localeCompare(b.name);
}

function Card({ site, address }: { site: SiteCard; address: boolean }) {
  const share = site.guides ? Math.round((site.finished / site.guides) * 100) : null;
  return (
    <Link
      href={siteHref(site.id)}
      className="group flex h-full flex-col rounded-xl border bg-card outline-none transition-colors hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-3 p-5">
        <SiteIcon site={site} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium">{site.name}</span>
          {address && <span className="truncate text-sm text-muted-foreground">{hostOf(site.origin)}</span>}
        </span>
      </div>
      {site.connected ? (
        <div className="flex flex-1 items-end justify-between gap-6 px-5 pb-5">
          <span className="flex flex-col">
            <span className="text-4xl font-medium tracking-[-0.03em]">{site.guides.toLocaleString()}</span>
            <span className="text-xs leading-5 text-muted-foreground">{site.guides === 1 ? "question" : "questions"} in the last 7 days</span>
            <span className="text-xs leading-5 text-muted-foreground">{share === null ? "None finished yet" : `${share}% finished`}</span>
          </span>
          <Spark daily={site.daily} className="w-28 shrink-0" />
        </div>
      ) : (
        <p className="flex-1 px-5 pb-5 text-sm leading-5 text-muted-foreground">Waiting for the script.</p>
      )}
      <div className="flex min-h-11 items-center gap-3 border-t px-5 py-2.5 text-xs leading-5 text-muted-foreground">
        {site.last ? (
          <>
            <span className="min-w-0 flex-1 truncate text-foreground">{site.last.question}</span>
            <GuideStatus outcome={site.last.outcome} paused={site.last.paused} className="shrink-0" />
            <span className="shrink-0 tabular-nums">{when(site.last.started_at)}</span>
          </>
        ) : (
          <span>{site.connected ? "No questions yet" : "Finish setup"}</span>
        )}
      </div>
    </Link>
  );
}
