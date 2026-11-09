"use client";

import { useState } from "react";

const HOST = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000").replace(/\/$/, "");

const SNIPPETS: [string, string][] = [
  ["HTML", `<script src="${HOST}/sdk/haptic.js" data-key="pk_live_…" async></script>`],
  [
    "Next.js",
    `import Script from "next/script";

<Script src="${HOST}/sdk/haptic.js" data-key="pk_live_…" strategy="afterInteractive" />`,
  ],
  ["React / Vue / Svelte", `<!-- index.html, before </body> -->
<script src="${HOST}/sdk/haptic.js" data-key="pk_live_…" async></script>`],
];

export function InstallTabs() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const code = SNIPPETS[active]![1];

  return (
    <div className="overflow-hidden rounded-2xl bg-ink text-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.4)]">
      <div className="flex items-center justify-between border-b border-white/10 px-2">
        <div role="tablist" aria-label="Install snippet" className="flex">
          {SNIPPETS.map(([label], index) => (
            <button
              key={label}
              role="tab"
              aria-selected={index === active}
              onClick={() => {
                setActive(index);
                setCopied(false);
              }}
              className={`relative px-3.5 py-3.5 text-[13px] font-semibold transition-colors ${index === active ? "text-white" : "text-white/45 hover:text-white/75"}`}
            >
              {label}
              {index === active && <span className="absolute inset-x-3.5 -bottom-px h-0.5 rounded-full bg-white" />}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="mr-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white/70 hover:bg-white/10 hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-6 font-mono text-[13px] leading-relaxed text-white/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}
