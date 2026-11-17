"use client";

import { useSyncExternalStore } from "react";
import { CopyLink } from "../agent-pill";
import { DeveloperEmail } from "../developer-email";
import { InstallOptions } from "../install-options";
import { Back, Primary, StepFrame } from "./frame";
import type { SetupSite } from "./types";

const noSubscribe = () => () => {};

/**
 * Step 4. In order: "Onboard your agent", the tag for each kind of stack, the
 * Content Security Policy lines, then the link and the email for a developer.
 * The pill's words follow the install check, which this page asks for every
 * few seconds.
 */
export function InstallStep({ site, onBack, onNext }: { site: SetupSite; onBack: () => void; onNext: () => void }) {
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "https://joinhaptic.com");
  const installLink = `${origin}/install/?site=${site.id}`;
  return (
    <StepFrame
      step="install"
      title="Add the script"
      lead="One tag on every page, including the pages behind your login. Hand it to your coding agent, add it yourself, or send it to whoever looks after your code."
      actions={
        <>
          <Back onClick={onBack} />
          <Primary onClick={onNext}>{site.connected ? "See it live" : "Continue"}</Primary>
        </>
      }
    >
      <InstallOptions scriptUrl={site.scriptUrl} siteId={site.id} live={site} />
      <section className="flex flex-col gap-4 rounded-xl border bg-muted p-6" aria-labelledby="send-developer">
        <div className="flex flex-col gap-1">
          <h2 id="send-developer" className="text-base font-medium">
            Someone else looks after your code
          </h2>
          <p className="max-w-[60ch] text-sm leading-5 text-muted-foreground">Send them the install page. It has everything above, for each kind of stack, and needs no sign-in.</p>
        </div>
        <CopyLink link={installLink} />
        <DeveloperEmail siteId={site.id} installLink={installLink} />
      </section>
    </StepFrame>
  );
}
