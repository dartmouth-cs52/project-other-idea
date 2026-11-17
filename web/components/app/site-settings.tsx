"use client";

import { useState, type FormEvent } from "react";
import { Pipette } from "lucide-react";
import { cn } from "cn";
import { Field, FieldError, FieldWithButton, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type Brand, type Site } from "@/lib/app-api";
import { Card, CardTitle } from "./parts";

const FIELD = "h-11 bg-card px-3.5 md:text-base";
const HEX = /^#[0-9a-f]{6}$/i;
// The widget's own pointer path, so the preview shows exactly what visitors see.
const POINTER_PATH =
  "M3.271 4.871A1.678 1.678 0 0 1 5.604 2.907L19.822 9.597A1.678 1.678 0 0 1 19.705 12.684L13.956 14.875A.622.622 0 0 0 13.643 15.139L10.506 20.431A1.678 1.678 0 0 1 7.444 20.021Z";

/**
 * The pointer's colour. It can be typed, picked, or matched to the site: one
 * press reads the site's own colour from its first page and saves it. The
 * launcher always sits bottom right, where support chat usually lives, and
 * keeps the word it has.
 */
export function WidgetLook({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [accent, setAccent] = useState(site.appearance.accent);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "matching">("idle");
  // What the last press of Match found, or didn't, in words.
  const [matched, setMatched] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const fields = useFieldErrors({ accent: "accent" });
  const changed = accent.toUpperCase() !== site.appearance.accent.toUpperCase();
  const busy = status === "saving" || status === "matching";

  /** Saves a colour. The corner goes with it, so a site set to the left before that choice went comes back to the right. */
  async function keep(colour: string) {
    onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { appearance: { accent: colour, position: "bottom-right" } } }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setMatched(null);
    if (fields.show({ accent: HEX.test(accent) ? undefined : "The colour must be a hex value like #1E6EF4." })) return;
    setStatus("saving");
    try {
      await keep(accent);
      setStatus("saved");
    } catch (failure) {
      if (!fields.showRefusal(failure)) setFailure(failureFrom("Couldn't save your changes", failure));
      setStatus("idle");
    }
  }

  async function match() {
    setFailure(null);
    setMatched(null);
    fields.clear("accent");
    setStatus("matching");
    try {
      const brand = await api<Brand>(`/sites/${site.id}/brand`);
      if (!brand.colour) {
        setMatched("Haptic couldn't find a colour on your website. Pick one here.");
        setStatus("idle");
        return;
      }
      setAccent(brand.colour);
      await keep(brand.colour);
      setMatched(`Matched to ${brand.colour}, your website's colour. The widget picks it up within a minute.`);
      setStatus("idle");
    } catch (failure) {
      setFailure(failureFrom("Couldn't match your website", failure));
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <Card>
        <CardTitle>How the widget looks</CardTitle>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Field id="accent" label="Pointer colour" required error={fields.errors.accent} hint="The pointer and the mark around what it points at.">
              <div className="flex flex-wrap gap-2">
                <input
                  type="color"
                  aria-label="Pick a colour"
                  value={HEX.test(accent) ? accent : "#1E6EF4"}
                  onChange={(event) => {
                    setAccent(event.target.value.toUpperCase());
                    setMatched(null);
                    fields.clear("accent");
                  }}
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border bg-card p-1"
                />
                <Input
                  {...fields.control("accent", { hint: true })}
                  required
                  value={accent}
                  onChange={(event) => {
                    setAccent(event.target.value.trim());
                    setMatched(null);
                    fields.clear("accent");
                  }}
                  className={cn(FIELD, "min-w-32 flex-1")}
                />
                <Button type="button" variant="secondary" size="xl" onClick={match} disabled={busy}>
                  <Pipette />
                  {status === "matching" ? "Looking" : "Match website"}
                </Button>
              </div>
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" size="xl" disabled={!changed || busy}>
                {status === "saving" ? "Saving" : "Save changes"}
              </Button>
              <span className="text-sm text-muted-foreground" role="status">
                {matched ?? (status === "saved" && !changed ? "Saved. The widget picks it up within a minute." : "")}
              </span>
            </div>
            <FormAlert failure={failure} />
          </div>
          <Preview accent={HEX.test(accent) ? accent : site.appearance.accent} position="bottom-right" label={site.appearance.launcherLabel || "Ask"} />
        </div>
      </Card>
    </form>
  );
}

/** The company's own notes, which Haptic reads before every answer. */
export function Notes({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [notes, setNotes] = useState(site.notes);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const fields = useFieldErrors({ notes: "notes" });
  const changed = notes.trim() !== site.notes;

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setStatus("saving");
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { notes } }));
      setStatus("saved");
    } catch (failure) {
      if (!fields.showRefusal(failure)) setFailure(failureFrom("Couldn't save your notes", failure));
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <Card>
        <CardTitle>What Haptic should know</CardTitle>
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          In your own words. What your product calls things, where settings live, and what people often get wrong. Haptic reads this before every
          answer.
        </p>
        <Textarea
          {...fields.control("notes", { hint: true })}
          aria-label="Notes"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            fields.clear("notes");
          }}
          rows={8}
          maxLength={20_000}
          placeholder="Invoices are under Billing, not Settings. A workspace is what other tools call a team."
          className="min-h-40 bg-card px-3.5 py-3 md:text-base"
        />
        <FieldError id="notes" error={fields.errors.notes} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" size="xl" disabled={!changed || status === "saving"}>
            {status === "saving" ? "Saving" : "Save notes"}
          </Button>
          <p id="notes-hint" className="text-sm text-muted-foreground">
            {status === "saved" && !changed ? "Saved. Haptic reads them within a minute." : `${notes.length.toLocaleString()} of 20,000 characters`}
          </p>
        </div>
        <FormAlert failure={failure} />
      </Card>
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
export function HelpDocs({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const fields = useFieldErrors({ url: "doc-url", title: "doc-title", text: "doc-text" });
  const { docs } = site;
  const share = Math.min(100, (docs.used / docs.budget) * 100);

  async function add(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const found =
      mode === "url"
        ? { url: url.trim() ? undefined : "Paste the address of a help article." }
        : { title: title.trim() ? undefined : "Give the doc a title.", text: text.trim() ? undefined : "Paste the doc's text." };
    if (fields.show(found)) return;
    setBusy(true);
    try {
      onChange(await api<Site>(`/sites/${site.id}/docs`, { method: "POST", body: mode === "url" ? { url } : { title, text } }));
      setUrl("");
      setTitle("");
      setText("");
    } catch (failure) {
      if (!fields.showRefusal(failure)) setFailure(failureFrom("Couldn't add the doc", failure));
    } finally {
      setBusy(false);
    }
  }

  async function setAnswers(on: boolean) {
    setFailure(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { answers: on } }));
    } catch (failure) {
      setFailure(failureFrom(on ? "Couldn't turn on answers" : "Couldn't turn off answers", failure));
    }
  }

  async function remove(source: string) {
    setFailure(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}/docs?source=${encodeURIComponent(source)}`, { method: "DELETE" }));
    } catch (failure) {
      setFailure(failureFrom("Couldn't remove the doc", failure));
    }
  }

  function choose(next: "url" | "paste") {
    setMode(next);
    fields.show({});
    setFailure(null);
  }

  return (
    <Card>
      <CardTitle>Help docs</CardTitle>
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        Your help articles, as written. Haptic uses them to find the right control and the words your product uses. Whole docs go in, in this order,
        until the room is full.
      </p>
      <label className="flex max-w-[65ch] items-start gap-3 text-sm leading-5">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
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
                <span className="truncate text-sm font-medium">{doc.title}</span>
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
              onClick={() => choose(value)}
              className={cn(
                "inline-flex h-8 items-center rounded-full px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                mode === value ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-secondary",
              )}
            >
              {name}
            </button>
          ))}
        </div>
        {mode === "url" ? (
          <FieldWithButton
            id="doc-url"
            label="Address of a help article"
            required
            error={fields.errors.url}
            button={
              <Button type="submit" variant="secondary" size="xl" disabled={busy}>
                {busy ? "Reading" : "Add"}
              </Button>
            }
          >
            <Input
              {...fields.control("url")}
              required
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                fields.clear("url");
              }}
              placeholder="https://help.example.com/billing"
              className={FIELD}
            />
          </FieldWithButton>
        ) : (
          <div className="flex flex-col gap-3">
            <Field id="doc-title" label="Title" required error={fields.errors.title}>
              <Input
                {...fields.control("title")}
                required
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  fields.clear("title");
                }}
                className={FIELD}
              />
            </Field>
            <Field id="doc-text" label="Text" required error={fields.errors.text}>
              <Textarea
                {...fields.control("text")}
                required
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  fields.clear("text");
                }}
                rows={8}
                className="min-h-40 bg-card px-3.5 py-3 md:text-base"
              />
            </Field>
            <Button type="submit" variant="secondary" size="xl" className="self-start" disabled={busy}>
              {busy ? "Adding" : "Add"}
            </Button>
          </div>
        )}
      </form>
      <FormAlert failure={failure} />
    </Card>
  );
}

/** Deletes the site and everything recorded on it, once the person types its address. */
export function DeleteSite({ site, onDeleted }: { site: Site; onDeleted: () => void }) {
  const host = new URL(site.origin).host;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const fields = useFieldErrors({ confirm: "confirm-delete" });

  async function remove(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (fields.show({ confirm: typed.trim().toLowerCase() === host.toLowerCase() ? undefined : `Type ${host} to confirm.` })) return;
    setBusy(true);
    try {
      await api(`/sites/${site.id}`, { method: "DELETE", body: { confirm: typed } });
      onDeleted();
    } catch (failure) {
      if (!fields.showRefusal(failure)) setFailure(failureFrom("Couldn't delete the site", failure));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Delete this site</CardTitle>
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        The script tag stops working at once, and every question, guide and setting for this site is deleted. This cannot be undone.
      </p>
      <form onSubmit={remove} noValidate>
        <FieldWithButton
          id="confirm-delete"
          label={`Type ${host} to confirm`}
          required
          error={fields.errors.confirm}
          button={
            // Stays off until the address matches, so a site is never deleted by a stray press.
            <Button type="submit" variant="destructive" size="xl" disabled={busy || typed.trim().toLowerCase() !== host.toLowerCase()}>
              {busy ? "Deleting" : "Delete site"}
            </Button>
          }
        >
          <Input
            {...fields.control("confirm")}
            required
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              fields.clear("confirm");
            }}
            autoComplete="off"
            className={FIELD}
          />
        </FieldWithButton>
      </form>
      <FormAlert failure={failure} />
    </Card>
  );
}
