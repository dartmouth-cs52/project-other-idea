"use client";

import type { SiteAppearance } from "@haptic/protocol";
import { useActionState, useState } from "react";
import { Button, Input, Label, TextArea } from "@/components/ui";
import {
  createOrganizationAndSite,
  createSite,
  updateAppearance,
  updateKnowledge,
  updateOrigins,
  type FormState,
} from "./actions";

function Status({ state, pending }: { state: FormState; pending: boolean }) {
  if (pending) return <span className="text-ink-muted">Saving…</span>;
  if (state.error) return <span className="text-red-700">{state.error}</span>;
  if (state.saved) return <span className="text-emerald-700">Saved</span>;
  return null;
}

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrganizationAndSite, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <Label>Company</Label>
        <Input name="org" placeholder="Acme Inc" required />
      </label>
      <label className="block">
        <Label>App name</Label>
        <Input name="site" placeholder="Acme Console" required />
      </label>
      <label className="block">
        <Label hint="where your users sign in">App address</Label>
        <Input name="url" placeholder="https://app.acme.com" required />
      </label>
      {state.error && <p className="text-red-700">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create site"}
      </Button>
    </form>
  );
}

export function NewSiteForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(createSite, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="org_id" value={orgId} />
      <label className="block">
        <Label>App name</Label>
        <Input name="site" placeholder="Acme Console" required />
      </label>
      <label className="block">
        <Label>App address</Label>
        <Input name="url" placeholder="https://app.acme.com" required />
      </label>
      {state.error && <p className="text-red-700">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        Create site
      </Button>
    </form>
  );
}

export function OriginsForm({ siteId, origins }: { siteId: string; origins: string[] }) {
  const [state, action, pending] = useActionState(updateOrigins, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="site_id" value={siteId} />
      <label className="block">
        <Label hint="one per line. Wildcards like https://*.acme.com cover subdomains.">Allowed origins</Label>
        <TextArea name="origins" rows={4} defaultValue={origins.join("\n")} className="font-mono text-[13px]" />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save origins
        </Button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function KnowledgeForm({ siteId, notes, learning }: { siteId: string; notes: string; learning: boolean }) {
  const [state, action, pending] = useActionState(updateKnowledge, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="site_id" value={siteId} />
      <label className="block">
        <Label hint="up to 8,000 characters">Notes for Haptic</Label>
        <TextArea
          name="notes"
          rows={6}
          maxLength={8000}
          defaultValue={notes}
          placeholder={"What the app does and where things live. For example:\nAPI keys are under Settings › Organization › Developer. Only admins can create them."}
        />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="learning" defaultChecked={learning} className="size-4 accent-[var(--color-accent)]" />
        <span>Learn page layouts from traffic</span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save
        </Button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function AppearanceForm({ siteId, appearance, voice }: { siteId: string; appearance: SiteAppearance; voice?: boolean }) {
  const [state, action, pending] = useActionState(updateAppearance, {});
  const [custom, setCustom] = useState(appearance.accent !== "auto");
  const [accent, setAccent] = useState(appearance.accent === "auto" ? "#111111" : appearance.accent);
  const [launcherDisplay, setLauncherDisplay] = useState(appearance.showLauncher ? appearance.launcherStyle : "hidden");
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="site_id" value={siteId} />
      <div className="block">
        <Label hint={custom ? undefined : "adapts to your page"}>Colors</Label>
        <div className="flex gap-2">
          <select
            name="accent_mode"
            value={custom ? "custom" : "auto"}
            onChange={(event) => setCustom(event.target.value === "custom")}
            className="h-9 rounded-lg border border-line bg-white px-3"
            aria-label="Color mode"
          >
            <option value="auto">Black and white</option>
            <option value="custom">Accent color</option>
          </select>
          {custom && (
            <>
              <input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} className="h-9 w-12 rounded-lg border border-line" aria-label="Pick accent color" />
              <Input name="accent" value={accent} onChange={(event) => setAccent(event.target.value)} className="font-mono" />
            </>
          )}
        </div>
      </div>
      <label className="block">
        <Label>Launcher</Label>
        <select
          name="launcherDisplay"
          value={launcherDisplay}
          onChange={(event) => setLauncherDisplay(event.target.value as "pill" | "icon" | "hidden")}
          className="h-9 w-full rounded-lg border border-line bg-white px-3"
        >
          <option value="pill">Pill with label</option>
          <option value="icon">Icon only</option>
          <option value="hidden">Hidden, use your own button</option>
        </select>
      </label>
      <label className="block">
        <Label>Launcher position</Label>
        <select name="position" defaultValue={appearance.position} className="h-9 w-full rounded-lg border border-line bg-white px-3">
          <option value="top-left">Top left</option>
          <option value="top-center">Top center</option>
          <option value="top-right">Top right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-center">Bottom center</option>
          <option value="bottom-right">Bottom right</option>
        </select>
      </label>
      <label className="block">
        <Label hint={launcherDisplay === "icon" ? "used as its accessible name" : undefined}>Launcher label</Label>
        <Input name="launcherLabel" defaultValue={appearance.launcherLabel} maxLength={24} />
      </label>
      <label className="block">
        <Label hint="can differ from the launcher">Ask bar position</Label>
        <select name="panelPosition" defaultValue={appearance.panelPosition} className="h-9 w-full rounded-lg border border-line bg-white px-3">
          <option value="launcher">Follow launcher</option>
          <option value="top-left">Top left</option>
          <option value="top-center">Top center</option>
          <option value="top-right">Top right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-center">Bottom center</option>
          <option value="bottom-right">Bottom right</option>
        </select>
      </label>
      <label className="block">
        <Label>Ask bar placeholder</Label>
        <Input name="greeting" defaultValue={appearance.greeting ?? ""} placeholder="Ask how to do something…" maxLength={80} />
      </label>
      {voice !== undefined && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="voice" defaultChecked={voice} className="size-4" />
          <span>Allow voice questions and spoken answers</span>
        </label>
      )}
      {launcherDisplay === "hidden" && (
        <p className="self-center text-ink-muted">
          Call <code>Haptic.open()</code> from your help button, or add <code>data-shortcut=&quot;Alt+H&quot;</code> to the script tag.
        </p>
      )}
      <details className="rounded-lg border border-line p-4 sm:col-span-2">
        <summary className="cursor-pointer font-medium">Spacing and size</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <Label hint="0–160 px">Side margin</Label>
            <Input name="edgeOffsetX" type="number" min={0} max={160} step={1} defaultValue={appearance.edgeOffsetX} />
          </label>
          <label className="block">
            <Label hint="0–160 px">Top or bottom margin</Label>
            <Input name="edgeOffsetY" type="number" min={0} max={160} step={1} defaultValue={appearance.edgeOffsetY} />
          </label>
          <label className="block">
            <Label hint="280–560 px">Ask bar width</Label>
            <Input name="panelWidth" type="number" min={280} max={560} step={10} defaultValue={appearance.panelWidth} />
          </label>
        </div>
      </details>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save appearance
        </Button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
