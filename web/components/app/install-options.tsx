"use client";

import { useState } from "react";
import { cn } from "cn";
import { installOptions, securityPolicyLines } from "@/lib/install";
import type { SeenOriginLike } from "@/lib/setup";
import { AgentPill } from "./agent-pill";
import { CodeBlock } from "./parts";

/**
 * "Onboard your agent", then the script tag and how to add it on each kind of
 * stack, one tab at a time. `live` is the site's install check, when the page
 * has it, so the pill can follow the install.
 */
export function InstallOptions({ scriptUrl, siteId, live }: { scriptUrl: string; siteId: string; live?: { connected: boolean; origins: SeenOriginLike[] } }) {
  const options = installOptions(scriptUrl, siteId);
  const [chosen, setChosen] = useState(options[0]!.id);
  const option = options.find((item) => item.id === chosen) ?? options[0]!;

  return (
    <div className="flex flex-col gap-4">
      <AgentPill siteId={siteId} live={live} />
      <h3 className="pt-2 text-base font-medium">Or add it yourself</h3>
      <div role="tablist" aria-label="Where your site is built" className="flex flex-wrap gap-2">
        {options.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={item.id === chosen}
            onClick={() => setChosen(item.id)}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              item.id === chosen ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-secondary",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-col gap-3">
        <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">{option.where}</p>
        {option.notes && (
          <ol className="flex max-w-[65ch] list-decimal flex-col gap-1 pl-5 text-base leading-6">
            {option.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ol>
        )}
        {option.code && <CodeBlock code={option.code} />}
      </div>
      <details className="group rounded-lg border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">If your site has a Content Security Policy</summary>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">Add these two sources, or the browser will block the script.</p>
        <div className="mt-3">
          <CodeBlock code={securityPolicyLines(scriptUrl).join("\n")} />
        </div>
      </details>
    </div>
  );
}
