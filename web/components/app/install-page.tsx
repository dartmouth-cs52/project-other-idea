"use client";

import { useSearchParams } from "next/navigation";
import { widgetScriptUrl } from "@/lib/site";
import { InstallOptions } from "./install-options";
import { Card } from "./parts";

/**
 * The page a company sends to whoever looks after its code. It needs no
 * sign-in: a site id is public, and only the origins the company allows can
 * use it.
 */
export function InstallPage() {
  const site = useSearchParams().get("site") ?? "";
  if (!/^site_[a-z0-9_]{3,40}$/.test(site)) {
    return (
      <Card className="max-w-2xl">
        <h1 className="text-2xl font-medium tracking-[-0.02em]">This install link is incomplete</h1>
        <p className="text-base text-muted-foreground">Ask the person who sent it for the full link from their Haptic dashboard.</p>
      </Card>
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
