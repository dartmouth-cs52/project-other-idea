"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, type Me, type SiteCard } from "@/lib/app-api";
import { hostOf } from "@/lib/setup";
import { Spark } from "./chart";
import { usePolled } from "./live";
import { NEW_SITE_HREF, siteHref } from "./nav";
import { DoneMark, GuideStatus, PageHeader, SiteIcon, useNow, when } from "./parts";

/** How often the list of sites asks what is new. Each card is a few counts, so this is slower than a site's own page. */
const SITES_MS = 3_000;


/**
 * Every site a company has, one card each, kept current. A card says whether
 * the script is running, how many questions the last week had, the shape of
 * the last fortnight, and the newest question. The whole card is the way in.
 */
export function SitesIndex({ me }: { me: Me }) {
  const { data } = usePolled<{ sites: SiteCard[] }>(`/sites?${clock()}`, SITES_MS);
  useNow();
  // Until the counts arrive, the names from sign-in hold each card's place.
  const sites = data ? [...data.sites].sort(byActivity) : undefined;
  const names = me.sites ?? [];

  return (
    <>
      <PageHeader title="Sites">
        <Link href={NEW_SITE_HREF} className={buttonVariants()}>
          <Plus />
          Add a site
        </Link>
      </PageHeader>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sites
          ? sites.map((site) => (
              <li key={site.id}>
                <Card site={site} />
              </li>
            ))
          : names.map((site) => (
              <li key={site.id}>
                <Skeleton className="h-52 rounded-xl" />
              </li>
            ))}
      </ul>
    </>
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

function Card({ site }: { site: SiteCard }) {
  const share = site.guides ? Math.round((site.finished / site.guides) * 100) : null;
  return (
    <Link
      href={siteHref(site.id)}
      className="group flex h-full flex-col rounded-xl border bg-card outline-none transition-colors hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-start gap-3 p-5">
        <SiteIcon site={site} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium">{site.name}</span>
          <span className="truncate text-sm text-muted-foreground">{hostOf(site.origin)}</span>
        </span>
        {site.connected && (
          <span className="inline-flex h-6 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <DoneMark className="size-4" />
            Running
          </span>
        )}
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
