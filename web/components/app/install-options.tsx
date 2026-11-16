"use client";

import { useState } from "react";
import { cn } from "cn";
import { agentPrompt, installOptions, securityPolicyLines } from "@/lib/install";
import { CodeBlock } from "./parts";

/** The script tag and how to add it on each kind of stack, one tab at a time. */
export function InstallOptions({ scriptUrl, siteId }: { scriptUrl: string; siteId: string }) {
  const options = installOptions(scriptUrl, siteId);
  const [chosen, setChosen] = useState(options[0]!.id);
  const option = options.find((item) => item.id === chosen) ?? options[0]!;

  return (
    <div className="flex flex-col gap-4">
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
        <pre className="mt-2 text-sm leading-6">
          <code>{securityPolicyLines(scriptUrl).join("\n")}</code>
        </pre>
      </details>
      <details className="group rounded-lg border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Using an AI coding agent</summary>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">Paste this into Claude Code, Cursor or a similar tool.</p>
        <div className="mt-3">
          <CodeBlock code={agentPrompt(scriptUrl, siteId)} label="Copy prompt" />
        </div>
      </details>
    </div>
  );
}
