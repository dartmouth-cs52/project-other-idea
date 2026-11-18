"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "cn";
import { FormAlert, failureFrom, type Failure } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/app-api";
import { hostOf, installStatus } from "@/lib/setup";
import { DoneMark, when, WRAPS } from "../parts";
import { Back, Primary, StepFrame } from "./frame";
import type { SetupSite } from "./types";

/** With nothing seen for this long, the screen lists what usually stops the script. */
export const HELP_AFTER_MS = 60_000;

/**
 * Step 5. The install check, live: waiting for the script, the moment it is
 * seen, or seen on an address the site doesn't allow yet, with one press to
 * allow it. Help shows after a minute, and Finish later is always there.
 */
export function ConnectStep({
  site,
  onChange,
  onBack,
  onFinish,
  onLater,
}: {
  site: SetupSite;
  onChange: (site: SetupSite) => void;
  onBack: () => void;
  onFinish: () => void;
  onLater: () => void;
}) {
  const status = installStatus(site, null, 0);
  const [help, setHelp] = useState(false);
  const [allowing, setAllowing] = useState(false);
  const [allowed, setAllowed] = useState<string | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const host = hostOf(site.origin);

  useEffect(() => {
    const timer = setTimeout(() => setHelp(true), HELP_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  async function allow(origin: string) {
    setAllowing(true);
    setError(null);
    try {
      const next = await api<SetupSite>(`/sites/${site.id}`, { method: "PATCH", body: { allowedOrigins: [...site.allowedOrigins, origin] } });
      setAllowed(origin);
      onChange(next);
    } catch (failure) {
      setError(failureFrom("Couldn't allow that address", failure));
    } finally {
      setAllowing(false);
    }
  }

  if (status.kind === "live") {
    const seen = site.origins.find((row) => row.origin === status.origin);
    return (
      <StepFrame
        step="connect"
        mark={<DoneMark className="size-7 [&_svg]:size-4" />}
        title={`Haptic is live on ${hostOf(status.origin)}`}
        lead="The script called Haptic from an address this site allows. Open a page there and ask Haptic how to do something. Each question shows on your dashboard as it comes in."
        actions={
          <>
            <Back onClick={onBack} />
            <Primary onClick={onFinish}>Go to your dashboard</Primary>
            <a href={status.origin} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "ghost", size: "xl" }), WRAPS)}>
              Open {hostOf(status.origin)}
              <ExternalLink />
            </a>
          </>
        }
      >
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-6" role="status" data-connect="live">
          <p className="flex items-center gap-2 text-base font-medium">
            <DoneMark />
            Connected
          </p>
          <p className="text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            Seen on {status.origin}
            {seen ? `, ${when(seen.last_seen_at)}` : ""}.
            {allowed === status.origin ? " You just allowed it, so Haptic shows there within a minute." : ""}
          </p>
        </div>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      step="connect"
      title="See it connect"
      lead={`Open any page of ${host} that has the tag. This screen changes a few seconds after the page loads.`}
      actions={
        <>
          <Back onClick={onBack} />
          {status.kind === "refused" ? (
            // Not the screen's Enter button: anyone can make a request look as if it came from any address,
            // so allowing one is a click of its own, never a keystroke on arrival.
            <Button size="xl" onClick={() => void allow(status.origin)} disabled={allowing}>
              {allowing ? "Allowing" : "Allow this address"}
            </Button>
          ) : (
            <a href={site.origin} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "xl" })} data-setup-primary>
              Open my site
              <ExternalLink />
            </a>
          )}
          <Button variant="ghost" size="xl" onClick={onLater}>
            Finish later
          </Button>
        </>
      }
      after={
        error && (
          <div className="max-w-xl">
            <FormAlert failure={error} />
          </div>
        )
      }
    >
      {status.kind === "refused" ? (
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-6" role="status" data-connect="refused">
          <p className="text-base leading-6 font-medium [overflow-wrap:anywhere]">The script is running on {status.origin}, which this site doesn&apos;t allow yet.</p>
          <p className="max-w-[60ch] text-sm leading-5 text-muted-foreground">
            The tag works. Haptic stays hidden on an address until you allow it, such as a staging or local copy of your app. Allow it only if it is
            yours. It then shows there within a minute.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-6" role="status" data-connect="waiting">
          <p className="shimmer w-fit text-base font-medium">Waiting for the script</p>
          <p className="max-w-[60ch] text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            Haptic checks every few seconds. It allows {site.allowedOrigins.map(hostOf).join(", ")} now, and shows any other address it sees here.
          </p>
        </div>
      )}
      {help && status.kind !== "refused" && (
        <section className="flex flex-col gap-3" aria-labelledby="not-showing">
          <h2 id="not-showing" className="text-base font-medium">
            Nothing yet. These are the usual reasons.
          </h2>
          <ul className="flex max-w-[65ch] list-disc flex-col gap-1.5 pl-5 text-sm leading-5 text-muted-foreground">
            <li>The change isn&apos;t live yet. Deploy it, then reload the page. View the page&apos;s source and search for data-site to check the tag is there.</li>
            <li>The tag is on one page, not in the layout every page shares.</li>
            <li>A Content Security Policy blocks it. The browser&apos;s console says so. Add the two lines from the previous step.</li>
            <li>An ad blocker in your browser stops it. Try a private window.</li>
            <li>You opened a different address, such as www or a staging copy. It shows up here with an Allow button once the script runs there.</li>
          </ul>
        </section>
      )}
    </StepFrame>
  );
}
