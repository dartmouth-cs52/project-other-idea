"use client";

import { useState, type FormEvent } from "react";
import { AlertCircleIcon } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type Site } from "@/lib/app-api";
import { Card, CardTitle } from "./parts";

const FIELD = "h-11 bg-card px-3.5 md:text-base";
const HEX = /^#[0-9a-f]{6}$/i;
// The widget's own pointer path, so the preview shows exactly what visitors see.
const POINTER_PATH =
  "M3.271 4.871A1.678 1.678 0 0 1 5.604 2.907L19.822 9.597A1.678 1.678 0 0 1 19.705 12.684L13.956 14.875A.622.622 0 0 0 13.643 15.139L10.506 20.431A1.678 1.678 0 0 1 7.444 20.021Z";

/** A site's settings: how the widget looks, what Haptic should know, its help docs, and deleting the site. */
export function SiteSettings({ site, onChange, onDeleted }: { site: Site; onChange: (site: Site) => void; onDeleted: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <LookAndNotes site={site} onChange={onChange} />
      <HelpDocs site={site} onChange={onChange} />
      <DeleteSite site={site} onDeleted={onDeleted} />
    </div>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** The widget's colour, corner and button label, and the company's notes, saved together. */
function LookAndNotes({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [accent, setAccent] = useState(site.appearance.accent);
  const [position, setPosition] = useState(site.appearance.position);
  const [label, setLabel] = useState(site.appearance.launcherLabel);
  const [notes, setNotes] = useState(site.notes);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const changed =
    accent.toUpperCase() !== site.appearance.accent.toUpperCase() || position !== site.appearance.position || label.trim() !== site.appearance.launcherLabel || notes.trim() !== site.notes;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!HEX.test(accent)) return setError("The colour must be a hex value like #1E6EF4.");
    if (!label.trim()) return setError("Give the button a label, such as Ask.");
    setError(null);
    setStatus("saving");
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { appearance: { accent, position, launcherLabel: label }, notes } }));
      setStatus("saved");
    } catch (failure) {
      setError((failure as Error).message);
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6" noValidate>
      <Card>
        <CardTitle>How the widget looks</CardTitle>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="accent">Pointer colour</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  aria-label="Pick a colour"
                  value={HEX.test(accent) ? accent : "#1E6EF4"}
                  onChange={(event) => setAccent(event.target.value.toUpperCase())}
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border bg-card p-1"
                />
                <Input id="accent" value={accent} onChange={(event) => setAccent(event.target.value.trim())} className={FIELD} aria-invalid={!HEX.test(accent) || undefined} />
              </div>
              <p className="text-sm text-muted-foreground">The pointer and the mark around what it points at. Everything else stays black and white.</p>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Corner</span>
              <div role="radiogroup" aria-label="Corner" className="flex gap-2">
                {(["bottom-right", "bottom-left"] as const).map((corner) => (
                  <button
                    key={corner}
                    type="button"
                    role="radio"
                    aria-checked={position === corner}
                    onClick={() => setPosition(corner)}
                    className={cn(
                      "inline-flex h-8 items-center rounded-full px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      position === corner ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-secondary",
                    )}
                  >
                    {corner === "bottom-right" ? "Bottom right" : "Bottom left"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="launcher-label">Button label</Label>
              <Input id="launcher-label" value={label} maxLength={24} onChange={(event) => setLabel(event.target.value)} className={FIELD} />
            </div>
          </div>
          <Preview accent={HEX.test(accent) ? accent : site.appearance.accent} position={position} label={label.trim() || "Ask"} />
        </div>
      </Card>

      <Card>
        <CardTitle>What Haptic should know</CardTitle>
        <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
          In your own words. What your product calls things, where settings live, and what people often get wrong. Haptic reads this before every
          answer.
        </p>
        <Textarea
          aria-label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={8}
          maxLength={20_000}
          placeholder="Invoices are under Billing, not Settings. A workspace is what other tools call a team."
          className="min-h-40 bg-card px-3.5 py-3 md:text-base"
        />
        <p className="text-sm text-muted-foreground">{notes.length.toLocaleString()} of 20,000 characters</p>
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="xl" disabled={!changed || status === "saving"}>
          {status === "saving" ? "Saving" : "Save changes"}
        </Button>
        {status === "saved" && !changed && <span className="text-sm text-muted-foreground">Saved. The widget picks it up within a minute.</span>}
      </div>
      {error && <Failure message={error} />}
    </form>
  );
}

/** A small window showing the launcher in its corner and the pointer in the chosen colour. */
function Preview({ accent, position, label }: { accent: string; position: Site["appearance"]["position"]; label: string }) {
  return (
    <div className="relative min-h-56 overflow-hidden rounded-xl border bg-card" aria-label="Preview" role="img">
      <div className="absolute top-8 left-8 flex h-8 items-center rounded-lg border px-3 text-sm" style={{ outline: `2px solid ${accent}`, outlineOffset: 3 }}>
        Billing
      </div>
      <svg viewBox="0 0 24 24" className="pointer-shadow absolute top-[60px] left-[92px] size-6" aria-hidden>
        <path d={POINTER_PATH} fill={accent} stroke="#fff" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" />
      </svg>
      <div className={cn("absolute bottom-4 flex", position === "bottom-right" ? "right-4" : "left-4")}>
        <span className="inline-flex h-10 items-center gap-2 rounded-full bg-[#1c1917] pr-4 pl-3.5 text-sm font-medium text-[#fafaf9] shadow-md">
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path d={POINTER_PATH} fill="currentColor" />
          </svg>
          {label}
        </span>
      </div>
    </div>
  );
}

/** The company's help docs: what is in the prompt, what is left out, and adding or removing one. */
function HelpDocs({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { docs } = site;
  const share = Math.min(100, (docs.used / docs.budget) * 100);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}/docs`, { method: "POST", body: mode === "url" ? { url } : { title, text } }));
      setUrl("");
      setTitle("");
      setText("");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setAnswers(on: boolean) {
    setError(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { answers: on } }));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  async function remove(source: string) {
    setError(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}/docs?source=${encodeURIComponent(source)}`, { method: "DELETE" }));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <Card>
      <CardTitle>Help docs</CardTitle>
      <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
        Your help articles, as written. Haptic uses them to find the right control and the words your product uses. Whole docs go in, in this order,
        until the room is full.
      </p>
      <label className="flex max-w-[65ch] items-start gap-3 text-base leading-6">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-primary"
          checked={site.answers.on}
          onChange={(event) => void setAnswers(event.target.checked)}
        />
        <span>
          Answer questions in words from these docs
          <span className="block text-sm leading-5 text-muted-foreground">
            For questions like &ldquo;what does this do?&rdquo;, Haptic replies in the panel and links the articles it used, and still points when
            there is something to click. {site.answers.chosen === null ? "On by default once a site has docs." : ""}
          </span>
        </span>
      </label>
      <div className="flex flex-col gap-2">
        <div className="h-2 rounded-full bg-secondary" role="meter" aria-label="Room used" aria-valuemin={0} aria-valuemax={docs.budget} aria-valuenow={docs.used}>
          <div className="h-2 rounded-full bg-primary" style={{ width: `${share}%` }} />
        </div>
        <p className="text-sm text-muted-foreground">
          {docs.used.toLocaleString()} of {docs.budget.toLocaleString()} characters used
        </p>
      </div>
      {docs.list.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {docs.list.map((doc) => (
            <li key={doc.source} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-base">{doc.title}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {[doc.pasted ? "Pasted" : doc.source, `${doc.chars.toLocaleString()} characters`, doc.inPrompt ? null : "left out, over the limit"].filter(Boolean).join(", ")}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => remove(doc.source)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-3" noValidate>
        <div role="tablist" aria-label="How to add a doc" className="flex gap-2">
          {(
            [
              ["url", "From a page"],
              ["paste", "Paste text"],
            ] as const
          ).map(([value, name]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                mode === value ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-secondary",
              )}
            >
              {name}
            </button>
          ))}
        </div>
        {mode === "url" ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="doc-url">Address of a help article</Label>
              <Input id="doc-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://help.example.com/billing" className={FIELD} />
            </div>
            <Button type="submit" variant="secondary" size="xl" disabled={busy || !url.trim()}>
              {busy ? "Reading" : "Add"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="doc-title">Title</Label>
              <Input id="doc-title" value={title} onChange={(event) => setTitle(event.target.value)} className={FIELD} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="doc-text">Text</Label>
              <Textarea id="doc-text" value={text} onChange={(event) => setText(event.target.value)} rows={8} className="min-h-40 bg-card px-3.5 py-3 md:text-base" />
            </div>
            <Button type="submit" variant="secondary" size="xl" className="self-start" disabled={busy || !title.trim() || !text.trim()}>
              {busy ? "Adding" : "Add"}
            </Button>
          </div>
        )}
      </form>
      {error && <Failure message={error} />}
    </Card>
  );
}

/** Deletes the site and everything recorded on it, once the person types its address. */
function DeleteSite({ site, onDeleted }: { site: Site; onDeleted: () => void }) {
  const host = new URL(site.origin).host;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/sites/${site.id}`, { method: "DELETE", body: { confirm: typed } });
      onDeleted();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Delete this site</CardTitle>
      <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
        The script tag stops working at once, and every question, guide and setting for this site is deleted. This cannot be undone.
      </p>
      <form onSubmit={remove} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="confirm-delete">Type {host} to confirm</Label>
          <Input id="confirm-delete" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" className={FIELD} />
        </div>
        <Button type="submit" variant="destructive" size="xl" disabled={busy || typed.trim().toLowerCase() !== host.toLowerCase()}>
          {busy ? "Deleting" : "Delete site"}
        </Button>
      </form>
      {error && <Failure message={error} />}
    </Card>
  );
}
