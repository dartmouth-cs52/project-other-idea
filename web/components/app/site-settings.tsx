"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Pipette } from "lucide-react";
import { cn } from "cn";
import { Field, FieldError, FieldWithButton, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type Brand, type Site } from "@/lib/app-api";
import { INK, inkOn, launcherColour, POINTER_BLUE } from "@/lib/colour";
import { Card, CardTitle } from "./parts";

const FIELD = "h-11 bg-card px-3.5 md:text-base";
const HEX = /^#[0-9a-f]{6}$/i;
// The widget's own pointer path, so the preview shows exactly what visitors see.
const POINTER_PATH =
  "M3.271 4.871A1.678 1.678 0 0 1 5.604 2.907L19.822 9.597A1.678 1.678 0 0 1 19.705 12.684L13.956 14.875A.622.622 0 0 0 13.643 15.139L10.506 20.431A1.678 1.678 0 0 1 7.444 20.021Z";

/** What this site is called in the dashboard. A new site is named after its company, so two sites start with the same name. */
export function SiteName({ site, onChange, onRenamed }: { site: Site; onChange: (site: Site) => void; onRenamed: () => void }) {
  const [name, setName] = useState(site.name);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const fields = useFieldErrors({ name: "site-name" });
  const changed = name.trim() !== site.name;

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (fields.show({ name: name.trim() ? undefined : "Give the site a name." })) return;
    setStatus("saving");
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { name } }));
      setStatus("saved");
      // The bar and the menu of sites take their names from sign-in, so they are asked for again.
      onRenamed();
    } catch (failure) {
      if (!fields.showRefusal(failure)) setFailure(failureFrom("Couldn't rename the site", failure));
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <Card>
        <CardTitle>Name</CardTitle>
        <FieldWithButton
          id="site-name"
          label="Site name"
          required
          error={fields.errors.name}
          hint={status === "saved" && !changed ? "Saved." : "What this site is called in the dashboard."}
          button={
            <Button type="submit" variant="secondary" size="xl" disabled={!changed || status === "saving"}>
              {status === "saving" ? "Saving" : "Rename"}
            </Button>
          }
        >
          <Input
            {...fields.control("name", { hint: true })}
            required
            value={name}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value);
              fields.clear("name");
            }}
            className={FIELD}
          />
        </FieldWithButton>
        <FormAlert failure={failure} />
      </Card>
    </form>
  );
}

/** How often the card asks whether the site's colour has been read, while it is being read, and for how long. */
const MATCHING_MS = 2_000;
const MATCHING_TRIES = 15;

/**
 * The Ask button's colour. It is the site's own colour, read from the site
 * when it is added, so the button looks like part of the site the way a
 * support button does. It can be read again with "Match website", or picked.
 * One too light to see on a white page is darkened, and the preview and the
 * saved colour are the darkened one. The pointer is Haptic's blue on every
 * site and is not a setting: it has to be seen against the site, not blend
 * into it.
 */
export function WidgetLook({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const saved = (site.appearance.launcher ?? INK).toUpperCase();
  // What the person has typed or picked and not saved yet. Null shows what is saved, which can change under them
  // while the site's colour is being read.
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "matching">("idle");
  // What the last press of Match found, or didn't, in words.
  const [matched, setMatched] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const fields = useFieldErrors({ launcher: "launcher" });
  const shown = draft ?? saved;
  const drawn = HEX.test(shown) ? launcherColour(shown) : saved;
  const changed = draft !== null && draft.toUpperCase() !== saved;
  const busy = status === "saving" || status === "matching";
  const reading = site.launcherMatch?.waiting === true;

  // While the site's colour is being read for the first time, ask now and then, so it shows here as soon as it is in.
  useEffect(() => {
    if (!reading) return;
    let live = true;
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > MATCHING_TRIES) return clearInterval(timer);
      api<Site>(`/sites/${site.id}`).then((next) => live && !next.launcherMatch?.waiting && onChange(next), () => undefined);
    }, MATCHING_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [reading, site.id, onChange]);

  /** Saves a colour as the person's choice. Ink is the launcher's own colour, so it is saved as none. */
  async function keep(colour: string): Promise<Site> {
    const next = await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { appearance: { launcher: colour.toUpperCase() === INK ? null : colour } } });
    onChange(next);
    setDraft(null);
    return next;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setMatched(null);
    if (fields.show({ launcher: HEX.test(shown) ? undefined : "The colour must be a hex value like #1C1917." })) return;
    setStatus("saving");
    try {
      await keep(shown);
      setStatus("saved");
    } catch (failure) {
      if (!fields.showRefusal(failure)) setFailure(failureFrom("Couldn't save your changes", failure));
      setStatus("idle");
    }
  }

  async function match() {
    setFailure(null);
    setMatched(null);
    fields.clear("launcher");
    setStatus("matching");
    try {
      const brand = await api<Brand>(`/sites/${site.id}/brand`);
      if (!brand.colour) {
        setMatched("Haptic couldn't find a colour on your website. Pick one here.");
        setStatus("idle");
        return;
      }
      const next = await keep(brand.colour);
      const kept = (next.appearance.launcher ?? INK).toUpperCase();
      setMatched(kept === brand.colour.toUpperCase() ? `Matched to ${kept}, your website's colour.` : `Matched to your website's ${brand.colour}, darkened to ${kept} so it stands out.`);
      setStatus("idle");
    } catch (failure) {
      setFailure(failureFrom("Couldn't match your website", failure));
      setStatus("idle");
    }
  }

  let hint = "The button people press to ask. It takes your website's colour, so it looks like part of it.";
  if (reading && draft === null) hint = "Reading your website's colour.";
  else if (draft !== null && HEX.test(shown) && drawn !== shown.toUpperCase()) hint = `Too light to stand out on a white page, so it is drawn darker, as ${drawn}.`;
  else if (draft === null && site.launcherMatch?.source === "matched") hint = "Matched to your website's colour when the site was added.";

  return (
    <form onSubmit={save} noValidate>
      <Card>
        <CardTitle>How the widget looks</CardTitle>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Field id="launcher" label="Ask button colour" required error={fields.errors.launcher} hint={hint}>
              <div className="flex flex-wrap gap-2">
                <input
                  type="color"
                  aria-label="Pick the Ask button's colour"
                  value={HEX.test(shown) ? shown : INK}
                  onChange={(event) => {
                    setDraft(event.target.value.toUpperCase());
                    setMatched(null);
                    fields.clear("launcher");
                  }}
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border bg-card p-1"
                />
                <Input
                  {...fields.control("launcher", { hint: true })}
                  required
                  value={shown}
                  onChange={(event) => {
                    setDraft(event.target.value.trim());
                    setMatched(null);
                    fields.clear("launcher");
                  }}
                  className={cn(FIELD, "min-w-32 flex-1")}
                />
                <Button type="button" variant="secondary" size="xl" onClick={match} disabled={busy}>
                  <Pipette />
                  {status === "matching" ? "Looking" : "Match website"}
                </Button>
              </div>
            </Field>
            <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">The pointer is Haptic&apos;s blue on every site, so it stands out on yours.</p>
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
          <Preview launcher={drawn} label={site.appearance.launcherLabel || "Ask"} />
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
/** A small window with a control the pointer is on, in Haptic's blue, and the launcher in its corner, in the site's colour. */
function Preview({ launcher, label }: { launcher: string; label: string }) {
  return (
    <div className="relative min-h-56 overflow-hidden rounded-xl border bg-card" aria-label="Preview" role="img">
      <div className="absolute top-8 left-8 flex h-8 items-center rounded-lg border px-3 text-sm" style={{ outline: `2px solid ${POINTER_BLUE}`, outlineOffset: 3 }}>
        Billing
      </div>
      <svg viewBox="0 0 24 24" className="pointer-shadow absolute top-[60px] left-[92px] size-6" aria-hidden>
        <path d={POINTER_PATH} fill={POINTER_BLUE} stroke="#fff" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" />
      </svg>
      <div className="absolute right-4 bottom-4 flex">
        <span data-preview-launcher className="inline-flex h-10 items-center gap-2 rounded-full pr-4 pl-3.5 text-sm font-medium shadow-md" style={{ background: launcher, color: inkOn(launcher) }}>
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
    // A paste is held to the Worker's own limit, measured on the body exactly as it will be sent. One far over it
    // would be cut off mid-upload, and the browser might then say the connection failed instead of what is wrong.
    const found =
      mode === "url"
        ? { url: url.trim() ? undefined : "Paste the address of a help article." }
        : {
            title: title.trim() ? undefined : "Give the doc a title.",
            text: !text.trim() ? "Paste the doc's text." : JSON.stringify({ title, text }).length > docs.bodyLimit.max ? docs.bodyLimit.message : undefined,
          };
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
