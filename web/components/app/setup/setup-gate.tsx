"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import type { Site } from "@/lib/app-api";
import { belongsInSetup, hostOf, installStatus, SETUP_STEPS, stepFor, stepIndex } from "@/lib/setup";
import { Card } from "../parts";
import type { SetupSite } from "./types";

/**
 * On the dashboard, for a site that hasn't connected. One that is part way
 * through the setup screens is sent back to them. One whose owner chose Finish
 * later, or that was added before there were setup screens, gets a card to
 * carry on, above the install details.
 */
export function SetupGate({ site }: { site: Site }) {
  const setupSite = site as unknown as SetupSite;
  const router = useRouter();
  const send = belongsInSetup(setupSite);
  const href = `/dashboard/setup/?site=${site.id}`;

  useEffect(() => {
    if (send) router.replace(href);
  }, [send, href, router]);

  if (send) return <Card><p className="text-base text-muted-foreground">Taking you back to where you were</p></Card>;

  const step = stepFor(setupSite);
  const status = installStatus(site, null, 0);
  return (
    <Card>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">
          Step {stepIndex(step) + 1} of {SETUP_STEPS.length}, {SETUP_STEPS[stepIndex(step)]!.title.toLowerCase()}
        </p>
        <h2 className="text-2xl font-medium tracking-[-0.02em]">Finish adding Haptic to {hostOf(site.origin)}</h2>
      </div>
      <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
        {status.kind === "refused"
          ? `The script is running on ${status.origin}, which this site doesn't allow yet. Carry on to allow it.`
          : "Pick up where you left off. The script hasn't been seen on your site yet."}
      </p>
      <Link href={href} className={buttonVariants({ size: "xl", className: "self-start" })}>
        Continue setup
      </Link>
    </Card>
  );
}
