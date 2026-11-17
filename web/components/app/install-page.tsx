"use client";

import { useSearchParams } from "next/navigation";
import { widgetScriptUrl } from "@/lib/site";
import { InstallOptions } from "./install-options";
import { Card, FailedCard } from "./parts";

/**
 * The page a company sends to whoever looks after its code. It needs no
 * sign-in: a site id is public, and only the origins the company allows can
 * use it.
 */
export function InstallPage() {
  const site = useSearchParams().get("site") ?? "";
  if (!/^site_[a-z0-9_]{3,40}$/.test(site)) {
    return (
      <FailedCard
        className="max-w-2xl"
        title="This install link is incomplete"
        message="Ask the person who sent it for the full link from their Haptic dashboard."
      />
    );
  }
  return (
    <>
      <div className="flex max-w-[65ch] flex-col gap-4">
        <h1 className="text-4xl font-medium tracking-[-0.03em] text-balance">Add Haptic to your site.</h1>
        <p className="text-lg leading-7 text-muted-foreground">
          Haptic is one script tag. It must load on every page, including pages behind the login. Pick how your site is built and follow the steps. The
          person who sent you this sees it connect as soon as a page with the tag is opened.
        </p>
      </div>
      <Card>
        <InstallOptions scriptUrl={widgetScriptUrl} siteId={site} />
      </Card>
    </>
  );
}
