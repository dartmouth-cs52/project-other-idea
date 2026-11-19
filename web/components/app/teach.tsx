"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Field, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api, useUnsaved, type Outcome, type Site, type TaughtRoute, type TaughtStep, type TeachSession } from "@/lib/app-api";
import { FailedCard, StepMark, when } from "./parts";

// Teach Haptic: someone at the company shows Haptic the right way by doing the
// task in their own app. A button starts a teach session, which opens the site
// in a new tab with a one-time token in the address's fragment. The widget
// there shows a bar and records which controls are used. Here the person
// watches for the steps, reviews them (delete one, add a note, name a control
// the recorder could not, leave the last click to the visitor) and saves them
// as a taught route. Saved routes are listed under Knowledge, in "Taught by doing".
//
// The buttons live in several places (a failed guide's drawer, "What people
// can't find" under Gaps, "Taught by doing" under Knowledge), and the review
// drawer is mounted once for the site, on every page of it. A small store
// joins them.

interface Active {
  siteId: string;
  question: string;
  /** What started it, so Start again can make a new link for the same thing. */
  from: { guide?: string; path?: string };
  sessionId?: string;
  /** The address the tab was sent to, kept so it can be opened by hand when the browser blocked the new tab. */
  url?: string;
  blocked?: boolean;
  starting?: boolean;
  error?: string;
}

let active: Active | null = null;
const listeners = new Set<() => void>();
function setActive(next: Active | null) {
  active = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const useActive = () => useSyncExternalStore(subscribe, () => active, () => null);

/**
 * Starts teaching. The new tab is opened straight away, inside the click,
 * so the browser does not block it, and sent to the site once the session
 * exists. If the browser blocks it anyway, the drawer offers the link.
 */
async function beginTeaching(siteId: string, question: string, from: Active["from"] = {}) {
  const tab = window.open("about:blank", "_blank");
  if (tab) {
    try {
      // The customer's page must not be able to reach back to the dashboard.
      tab.opener = null;
      tab.document.title = "Opening your site…";
    } catch {
      // Nothing to do.
    }
  }
  // A page whose session has ended goes to sign in without the call below ever settling (api in lib/app-api.ts), so
  // the tab goes with the page rather than stay open and blank.
  const leave = () => tab?.close();
  window.addEventListener("pagehide", leave);
  setActive({ siteId, question, from, starting: true });
  try {
    const result = await api<{ session: TeachSession; url: string }>(`/sites/${siteId}/teach`, { method: "POST", body: { question, ...from } });
    if (tab && !tab.closed) tab.location.href = result.url;
    setActive({ siteId, question: result.session.question, from, sessionId: result.session.id, url: result.url, blocked: !tab || tab.closed });
  } catch (failure) {
    tab?.close();
    setActive({ siteId, question, from, error: (failure as Error).message });
  } finally {
    window.removeEventListener("pagehide", leave);
  }
}

/** Opens the drawer on a session already under way or waiting for review. */
function reviewSession(siteId: string, session: TeachSession) {
  setActive({ siteId, question: session.question, from: {}, sessionId: session.id });
}

/** Guides that ended without getting there, which are worth teaching. Not one left for a person, off topic, or a control the company ruled out. */
const NOT_TEACHABLE = new Set<Outcome>(["finished", "answered", "under_way", "sensitive", "off_topic", "blocked"]);
export const teachable = (outcome: Outcome) => !NOT_TEACHABLE.has(outcome);

/** "Teach Haptic the right way", on a question Haptic got wrong. */
export function TeachButton({
  siteId,
  question,
  guide,
  path,
  onStarted,
  label = "Teach Haptic the right way",
  variant = "secondary",
}: {
  siteId: string;
  question: string;
  guide?: string;
  path?: string;
  onStarted?: () => void;
  label?: string;
  variant?: "secondary" | "ghost" | "default";
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      className="self-start"
      onClick={() => {
        void beginTeaching(siteId, question, { ...(guide ? { guide } : {}), ...(path ? { path } : {}) });
        onStarted?.();
      }}
    >
      {label}
    </Button>
  );
}

/** "Teach Haptic a task": the same, for a question typed here. `unavailable` says why teaching can't start on this server. */
export function TeachTask({ siteId, unavailable }: { siteId: string; unavailable?: string | null }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  if (unavailable) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="secondary" className="self-start" disabled>
          Teach Haptic a task
        </Button>
        <p className="text-sm text-muted-foreground">{unavailable}</p>
      </div>
    );
  }
  if (!open) {
    return (
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        Teach Haptic a task
      </Button>
    );
  }
  function start(event: FormEvent) {
    event.preventDefault();
    if (question.trim().length < 3) return;
    void beginTeaching(siteId, question.trim());
    setOpen(false);
    setQuestion("");
  }
  return (
    <form onSubmit={start} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <Label htmlFor={`teach-${siteId}`}>What should Haptic learn to do?</Label>
      <Input
        id={`teach-${siteId}`}
        value={question}
        maxLength={300}
        autoFocus
        placeholder="how do I add a budget"
        onChange={(event) => setQuestion(event.target.value)}
        className="h-11 bg-card px-3.5 md:text-base"
      />
      <p className="text-sm text-muted-foreground">Your site opens in a new tab. Do the task there as a visitor would, then press Done on Haptic&apos;s bar.</p>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={question.trim().length < 3}>
          Start teaching
        </Button>
      </div>
    </form>
  );
}

/** A step's extras on the dashboard: where it is, its note, and whose click it is. */
function StepDetails({ step }: { step: TaughtStep }) {
  const details = [step.context ? `In ${step.context}.` : "", step.leave || step.commits ? "The visitor makes this click." : "", step.note ? `Note: ${step.note}` : ""].filter(Boolean);
  if (!details.length) return null;
  return <span className="block text-sm text-muted-foreground">{details.join(" ")}</span>;
}

/** Taught by doing: the routes taught so far, steps waiting for review, and a way to teach a new one. */
export function TaughtRoutes({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [sessions, setSessions] = useState<TeachSession[]>([]);
  /** Why teaching can't start on this server, when the Worker says so. */
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [failedRemove, setFailedRemove] = useState<TaughtRoute | null>(null);
  const current = useActive();
  const taught = site.taught ?? [];

  const loadSessions = useCallback(() => {
    api<{ sessions: TeachSession[]; unavailable?: string }>(`/sites/${site.id}/teach`).then(
      (result) => {
        setSessions(result.sessions);
        setUnavailable(result.unavailable ?? null);
      },
      () => setSessions([]),
    );
  }, [site.id]);
  useEffect(() => {
    loadSessions();
    const timer = setInterval(() => document.visibilityState === "visible" && loadSessions(), 15_000);
    return () => clearInterval(timer);
  }, [loadSessions, current?.sessionId, taught.length]);

  async function remove(route: TaughtRoute) {
    setFailure(null);
    setFailedRemove(null);
    try {
      const result = await api<{ taught: TaughtRoute[] }>(`/sites/${site.id}/taught/${route.id}`, { method: "DELETE" });
      onChange({ ...site, taught: result.taught });
    } catch (failure) {
      setFailure(failureFrom("Couldn't remove the route", failure));
      setFailedRemove(route);
    }
  }

  const waiting = sessions.filter((session) => session.status === "ready" || session.status === "teaching");
  return (
    <div className="flex flex-col gap-3">
      {waiting.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {waiting.map((session) => (
            <li key={session.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="min-w-0">
                <span className="block">{session.question}</span>
                <span className="text-muted-foreground">
                  {session.status === "ready"
                    ? `${session.stepCount} ${session.stepCount === 1 ? "step" : "steps"} waiting for review. Nothing is used until you save, and steps nobody saves are deleted after a week.`
                    : "Being taught in another tab."}
                </span>
              </span>
              <Button variant={session.status === "ready" ? "default" : "ghost"} size="sm" className="self-start sm:self-center" onClick={() => reviewSession(site.id, session)}>
                {session.status === "ready" ? "Review" : "Open"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {taught.length ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {[...taught].reverse().map((route) => (
            <li key={route.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <span className="block">{route.question}</span>
                <span className="block text-muted-foreground">
                  {route.steps.length} {route.steps.length === 1 ? "step" : "steps"}, taught{route.by ? ` by ${route.by}` : ""} {when(route.createdAt)}.
                </span>
                <ol className="mt-2 flex flex-col gap-1.5">
                  {route.steps.map((step, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{index + 1}.</span>
                      <span className="min-w-0">
                        {step.text}
                        <StepDetails step={step} />
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <Button variant="ghost" size="sm" className="self-start" onClick={() => remove(route)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          None yet. When Haptic can&apos;t guide a task, show it how: choose Teach Haptic the right way on a question it got wrong, or teach it a task here.
          Your site opens with a bar across it, you do the task as a visitor would, and Haptic guides anyone who asks for that task the same way from then on. It records
          which controls you use, never what you type.
        </p>
      )}
      <TeachTask siteId={site.id} unavailable={unavailable} />
      <FormAlert failure={failure} retry={failedRemove ? () => remove(failedRemove) : undefined} />
    </div>
  );
}

/** The id of the field for a step's control name, when the recorder couldn't read one. */
const nameId = (n: number) => `name-${n}`;

/** A step being reviewed: which recorded step it is, and what the person added. */
interface Kept {
  n: number;
  note: string;
  noting: boolean;
  name: string;
}

/**
 * Follows a teach session while it runs, then holds the review. A new session
 * starts a new review. It is mounted once for the site, beside every page, so
 * a button on any of them opens it.
 */
export function TeachDrawer({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const current = useActive();
  if (!current || current.siteId !== site.id) return null;
  return <TeachPanel key={current.sessionId ?? "new"} mine={current} site={site} onChange={onChange} />;
}

function TeachPanel({ mine, site, onChange }: { mine: Active; site: Site; onChange: (site: Site) => void }) {
  const [session, setSession] = useState<TeachSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kept, setKept] = useState<Kept[] | null>(null);
  const [leaveLast, setLeaveLast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<{ failure: Failure; retry: boolean } | null>(null);
  const [saved, setSaved] = useState<TaughtRoute | null>(null);
  const sessionId = mine.sessionId;
  // A failed save is brought into view, with its Try again, wherever the person had scrolled to.
  const saveAlert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (saveFailure) saveAlert.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [saveFailure]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await api<TeachSession>(`/sites/${site.id}/teach/${sessionId}`);
      setSession(next);
      setLoadError(null);
      if (next.steps) setKept((was) => was ?? next.steps!.map((_, n) => ({ n, note: "", noting: false, name: "" })));
    } catch (failure) {
      setLoadError((failure as Error).message);
    }
  }, [site.id, sessionId]);

  // While the other tab is teaching, look every two seconds, and at once on coming back to this tab.
  const following = !session || session.status === "waiting" || session.status === "teaching";
  useEffect(() => {
    if (!sessionId || !following) return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 2000);
    const back = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [sessionId, following, load]);

  const close = () => setActive(null);
  const steps = session?.steps ?? [];
  const reviewing = session?.status === "ready" && kept && !saved;
  // A control the recorder couldn't name is a field that must be filled in, checked when the route is saved.
  const names = useFieldErrors<string>(Object.fromEntries((kept ?? []).filter((item) => steps[item.n]?.unnamed).map((item) => [nameId(item.n), nameId(item.n)])));

  async function save() {
    if (!kept || !sessionId) return;
    setSaveFailure(null);
    if (names.show(Object.fromEntries(kept.filter((item) => steps[item.n]?.unnamed && !item.name.trim()).map((item) => [nameId(item.n), "Type the words on this control."])))) return;
    setSaving(true);
    try {
      const result = await api<{ taught: TaughtRoute[]; route: TaughtRoute }>(`/sites/${site.id}/teach/${sessionId}`, {
        method: "POST",
        body: {
          steps: kept.map((item) => ({ n: item.n, ...(item.note.trim() ? { note: item.note.trim() } : {}), ...(item.name.trim() ? { name: item.name.trim() } : {}) })),
          leaveLast,
        },
      });
      setSaved(result.route);
      onChange({ ...site, taught: result.taught });
    } catch (failure) {
      // The steps stay here and on the server until they are saved.
      const why = failureFrom("The route wasn't saved", failure);
      setSaveFailure({ failure: { ...why, detail: `${why.detail} Your review is kept.` }, retry: true });
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    if (!sessionId) return close();
    setSaveFailure(null);
    try {
      await api(`/sites/${site.id}/teach/${sessionId}`, { method: "DELETE" });
      close();
    } catch (failure) {
      setSaveFailure({ failure: failureFrom("Couldn't discard the steps", failure), retry: false });
    }
  }

  const update = (index: number, change: Partial<Kept>) => setKept((list) => list && list.map((item, at) => (at === index ? { ...item, ...change } : item)));
  const deleted = steps.length - (kept?.length ?? steps.length);
  // The recorded steps wait on the server, but what the review changed is only here until it is saved, so a page whose
  // session ends keeps it.
  useUnsaved(Boolean(reviewing && (deleted > 0 || leaveLast || kept!.some((item) => item.note.trim() || item.name.trim()))));

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent className="gap-0 overflow-y-auto">
        <SheetHeader className="border-b p-5 pr-12">
          <SheetTitle className="flex flex-col gap-1 text-lg leading-6">
            <span className="text-sm font-normal text-muted-foreground">Teach Haptic</span>
            <span className="sr-only">: </span>
            <span>{mine.question}</span>
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-5">

        {mine.starting && <p className="text-sm leading-5 text-muted-foreground">Opening your site in a new tab…</p>}
        {mine.error && <FormAlert failure={{ title: "Couldn't start teaching", detail: mine.error }} retry={() => void beginTeaching(site.id, mine.question, mine.from)} />}
        {loadError && <FailedCard level={2} title="Couldn't check on the teaching tab" message={loadError} retry={() => void load()} />}

        {sessionId && following && !mine.error && (
          <div className="flex flex-col gap-3 rounded-xl border bg-muted p-4">
            {mine.blocked ? (
              <>
                <p className="text-sm leading-5">Your browser didn&apos;t open the new tab. Open your site to start teaching:</p>
                <a href={mine.url} target="_blank" rel="noopener noreferrer" className="w-fit text-sm font-medium underline underline-offset-4">
                  Open {new URL(mine.url ?? site.origin).host} to teach
                </a>
              </>
            ) : (
              <p className="text-sm leading-5">
                {session?.status === "teaching"
                  ? "Recording in the other tab. Do the task there as a visitor would, then press Done on Haptic's bar."
                  : "Your site is opening in a new tab, with Haptic's bar across it. Do the task there as a visitor would, then press Done on the bar."}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              The steps show up here for you to check before Haptic uses them. Haptic records which controls you use, never what you type. The link works once, for 30 minutes.
            </p>
            <Button variant="ghost" size="sm" className="self-start" onClick={discard}>
              Stop teaching
            </Button>
            <FormAlert failure={saveFailure?.failure ?? null} />
          </div>
        )}

        {session?.status === "expired" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-5">This teaching link expired before the steps came in.</p>
            <Button className="self-start" onClick={() => void beginTeaching(site.id, mine.question, mine.from)}>
              Start again
            </Button>
          </div>
        )}
        {session?.status === "cancelled" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-5">Teaching was cancelled, so nothing was recorded.</p>
            <Button className="self-start" onClick={() => void beginTeaching(site.id, mine.question, mine.from)}>
              Start again
            </Button>
          </div>
        )}
        {session?.status === "saved" && !saved && <p className="text-sm leading-5">These steps are saved already. They are under Knowledge, in Taught by doing.</p>}

        {reviewing && (
          <>
            <p className="text-sm leading-5 text-muted-foreground">
              Check the steps. Delete any that aren&apos;t part of the task, and add a note where a step needs one, like which option to pick. Nothing is used until you save.
              Saving keeps only the steps left here and deletes the recording. Discard deletes all of it.
            </p>
            <ol className="flex flex-col gap-3">
              {kept!.map((item, index) => {
                const step = steps[item.n]!;
                const last = index === kept!.length - 1;
                return (
                  <li key={item.n} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <span className="pt-0.5">
                        <StepMark n={index + 1} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-5">{step.text}</p>
                        {step.context && <p className="text-sm text-muted-foreground">In {step.context}.</p>}
                        {step.commits && <p className="text-sm text-muted-foreground">Its name says it saves, sends, pays or deletes, so the visitor always makes this click.</p>}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setKept((list) => list && list.filter((_, at) => at !== index))} aria-label={`Delete step ${index + 1}`}>
                        Delete
                      </Button>
                    </div>
                    {/* What the person adds to a step sits under the step's words, past its number. */}
                    <div className="flex flex-col gap-3 pl-8">
                      {step.unnamed && (
                        <Field
                          id={nameId(item.n)}
                          label="Words on this control"
                          required
                          error={names.errors[nameId(item.n)]}
                          hint="Haptic couldn't read a name for this control. Type the words on it, or delete the step."
                        >
                          <Input
                            {...names.control(nameId(item.n), { hint: true })}
                            required
                            value={item.name}
                            maxLength={80}
                            onChange={(event) => {
                              update(index, { name: event.target.value });
                              names.clear(nameId(item.n));
                            }}
                            placeholder="The words on the control"
                            className="h-10 bg-card"
                          />
                        </Field>
                      )}
                      {item.noting ? (
                        // It wraps, so the whole note can be read back; it is still one line, so Enter adds none.
                        <Textarea
                          value={item.note}
                          maxLength={140}
                          rows={1}
                          autoFocus
                          onChange={(event) => update(index, { note: event.target.value.replace(/\r?\n/g, " ") })}
                          placeholder="A short note, like: pick the department the budget is for"
                          aria-label={`Note on step ${index + 1}`}
                          className="min-h-10 resize-none bg-card px-3 py-2"
                        />
                      ) : (
                        <Button variant="ghost" size="sm" className="-ml-3 self-start" onClick={() => update(index, { noting: true })}>
                          Add a note
                        </Button>
                      )}
                      {last && (
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-foreground"
                            checked={leaveLast || step.commits === true}
                            disabled={step.commits === true}
                            onChange={(event) => setLeaveLast(event.target.checked)}
                          />
                          <span>
                            Leave this click for the visitor
                            <span className="block text-muted-foreground">In Do it with me, Haptic does the steps before it and points at this one for the visitor to click.</span>
                          </span>
                        </label>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {deleted > 0 && (
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setKept(steps.map((_, n) => ({ n, note: "", noting: false, name: "" })))}>
                Bring back the {deleted} deleted {deleted === 1 ? "step" : "steps"}
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={saving || !kept!.length}>
                {saving ? "Saving…" : "Save this route"}
              </Button>
              <Button variant="ghost" onClick={() => void discard()}>
                Discard
              </Button>
            </div>
            <div ref={saveAlert}>
              <FormAlert failure={saveFailure?.failure ?? null} retry={saveFailure?.retry ? () => void save() : undefined} />
            </div>
          </>
        )}

        {saved && (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-5">
              Saved. When someone asks for the same task as &ldquo;{saved.question}&rdquo;, however they word it, Haptic guides them this way, checking each step against the page
              they see.
            </p>
            <ol className="flex flex-col gap-1.5 text-sm">
              {saved.steps.map((step, index) => (
                <li key={index} className="flex gap-2">
                  <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{index + 1}.</span>
                  <span className="min-w-0">
                    {step.text}
                    <StepDetails step={step} />
                  </span>
                </li>
              ))}
            </ol>
            <Button className="self-start" onClick={close}>
              Done
            </Button>
          </div>
        )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
