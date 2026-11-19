"use client";

// The signed-in pages' calls to the site's Worker (worker/app-api.ts), and the
// shapes it answers with.

import { useEffect, useSyncExternalStore } from "react";

/**
 * A call the Worker turned down, or that never reached it. The message is
 * always one to show the person. `field` names the one input at fault, when
 * there is one, so a form can show the message under that input.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** What a call that went wrong on the server's side says. */
const OUR_SIDE = "Something went wrong on our side. Try again in a moment.";

/** What a call says once the session has ended on a page that stayed for typing not saved yet. */
const SIGNED_OUT = "You were signed out. Sign in again in a new tab, then try again.";

/**
 * Typing on the page that hasn't been saved yet, one mark for each form that holds some (useUnsaved). While there is
 * any, a page whose session has ended stays where it is, so what was typed doesn't go with it.
 */
const unsaved = new Set<object>();

/**
 * Marks the typing a form holds as not saved yet, for as long as `dirty` is true. The notes, a help doc and a teach
 * review use it, since they take more than a moment to type again. Anything shorter is simply typed again after
 * signing in, so it doesn't keep a page whose session has ended from going to sign in.
 */
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const mark = {};
    unsaved.add(mark);
    return () => {
      unsaved.delete(mark);
    };
  }, [dirty]);
}

/** Whether the session has ended on a page that stayed for typing not saved yet, which the page then says. */
let signedOut = false;
/** How many times the page has found its session ended, so an answer to a call made before then isn't taken for signing in again. */
let endings = 0;
const watchers = new Set<() => void>();
function setSignedOut(next: boolean) {
  if (signedOut === next) return;
  signedOut = next;
  if (next) endings++;
  for (const watcher of watchers) watcher();
}
function watch(watcher: () => void) {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}
export const useSignedOut = () => useSyncExternalStore(watch, () => signedOut, () => false);

/**
 * Whether no one is signed in, asked of the session itself. The Worker answers 401 when Neon Auth says there is no
 * session, and also when it couldn't get an answer from Neon Auth at all (currentUser in worker/auth.ts), so a 401
 * alone would send people who are still signed in to sign in whenever Neon Auth stumbled. Only an answer that names no
 * one counts. The auth client keeps the last session it saw, so this asks the server directly. Calls turned away
 * together share one check.
 */
let checking: Promise<boolean> | null = null;
function sessionEnded(): Promise<boolean> {
  checking ??= (async () => {
    const response = await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" }).catch(() => null);
    if (!response?.ok) return false;
    const answer = (await response.json().catch(() => undefined)) as { user?: unknown } | null | undefined;
    return answer !== undefined && !answer?.user;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/**
 * Leaves for the sign-in page. A sign-in link that was already used or has expired comes back to the dashboard with an
 * error in the address, and that goes along, so the sign-in page can say what happened. It replaces this page rather
 * than adding a step, so Back doesn't return to a page that would only send the person here again.
 */
function toSignIn() {
  const linkError = new URLSearchParams(window.location.search).get("error");
  window.location.replace(linkError ? `/sign-in/?error=${encodeURIComponent(linkError)}` : "/sign-in/");
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const asked = endings;
  const response = await fetch(`/api/app${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    signal: init?.signal,
  }).catch(() => null);
  // The browser's own words for this differ in each browser, and none of them say what to do.
  if (!response) throw new ApiError(0, "Haptic couldn't be reached. Check your connection and try again.");
  if (response.status === 401) {
    // No one is signed in: the session ended while the page was open, from signing out in another tab or being away
    // too long, or there never was one. Or the Worker couldn't check, and then the call failed like any other.
    if (!signedOut && !(await sessionEnded())) throw new ApiError(401, OUR_SIDE);
    // Every call after this one would be turned away too, so the page goes to sign in. The call never settles, so
    // nothing on the page has time to say it failed, with a Try again that can't work.
    if (!unsaved.size) {
      toSignIn();
      return new Promise<never>(() => {});
    }
    // Unless that would throw away typing not saved yet. Then the page stays and says so, and the call fails saying
    // what to do, so the form keeps what was typed. Signing in again in another tab signs this page in too.
    setSignedOut(true);
    throw new ApiError(401, SIGNED_OUT);
  }
  // Signed in again, once a call made since the session ended gets through.
  if (response.ok && asked === endings) setSignedOut(false);
  const data = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? OUR_SIDE, data.field);
  return data as T;
}

export interface Me {
  user: { email: string; name: string };
  approved: boolean;
  reason?: "unverified" | "not_approved";
  organization?: { id: string; name: string; role: string };
  sites?: { id: string; name: string; origin: string; connected: boolean }[];
}

/** The company's Team page: worker/team.ts. */
export interface Team {
  /** An owner or admin, who may add people, change roles and remove people. */
  canManage: boolean;
  members: { id: string; name: string | null; email: string; role: "owner" | "admin" | "member" | string; joined: string; you: boolean }[];
  /** Added, and not signed in yet. */
  invites: { id: string; email: string; invitedAt: string; invitedBy: string | null }[];
  /** Whole email domains approved for the company: anyone at one joins when they sign in. */
  domains: string[];
}

/** The company's billing page: worker/billing.ts. */
export interface Billing {
  /** Stripe's keys are on the server, so a plan can be bought. */
  ready: boolean;
  testMode: boolean;
  /** An owner or admin, who may buy, switch and open Stripe's portal. */
  canManage: boolean;
  plan: { id: string; name: string };
  subscription: { status: string; cancelAt: string | null; periodEnd: string | null } | null;
  hasCustomer: boolean;
  /** The billing period under way, or the calendar month without a subscription. End is exclusive. */
  period: { start: string; end: string; kind: "billing" | "month" };
  finished: number;
  /** Of those, how many Stripe has. */
  sent: number;
  sites: { id: string; name: string; finished: number }[];
  plans: import("./billing-plans").PaidPlan[];
}

export interface Reading {
  read: number;
  max: number;
  done: boolean;
  failed: number;
  thin: number;
  via: "browser" | "http" | null;
  pages: { path: string; title: string }[];
}

export interface SeenOrigin {
  origin: string;
  allowed: boolean;
  first_seen_at: string;
  last_seen_at: string;
  requests: number;
}

/** A control as the dashboard names it. Role empty means any kind. */
export interface ControlName {
  role?: string;
  label: string;
}

/** "Point here instead", as saved. */
export interface Correction {
  id: string;
  route: string;
  question: string;
  wrong?: ControlName;
  right: ControlName;
  createdAt: string;
}

/** One step someone taught Haptic, with the sentence the dashboard shows it as. Names only, never what was typed. */
export interface TaughtStep {
  kind: "press" | "choose" | "type" | "check" | "uncheck" | "enter";
  path: string;
  role: string;
  label: string;
  context?: string;
  dialog?: string;
  choice?: string;
  row?: true;
  /** Its words say it saves, sends, pays or deletes: always the visitor's click. */
  commits?: true;
  /** Left for the visitor in Do it with me. */
  leave?: true;
  note?: string;
  /** "On /budgets, press New budget". */
  text: string;
  /** The recorder couldn't read a name for its control. It has to be named or deleted before saving. */
  unnamed: boolean;
}

/** A route someone taught Haptic by doing the task, as saved. */
export interface TaughtRoute {
  id: string;
  question: string;
  steps: TaughtStep[];
  createdAt: string;
  by?: string;
}

/** A teach session: waiting for the tab to open, under way, steps ready to review, or done with. */
export interface TeachSession {
  id: string;
  question: string;
  status: "waiting" | "teaching" | "ready" | "saved" | "cancelled" | "expired";
  createdAt: string;
  expiresAt: string;
  by: string | null;
  stepCount: number;
  steps: TaughtStep[] | null;
}

export interface Site {
  id: string;
  name: string;
  origin: string;
  allowedOrigins: string[];
  routesMode: "off" | "shadow" | "serve";
  scriptUrl: string;
  /** `launcher` is the Ask button's own colour, as it is drawn. Missing means Ink. `accent` is always Haptic's blue. */
  appearance: { accent: string; position: "bottom-right"; launcherLabel: string; launcher?: string };
  /**
   * The launcher's colour is read from the site once, when the site is added. `waiting` is true until that has
   * finished for the site's address or a person has chosen a colour. `source` says where the colour came from.
   */
  launcherMatch?: { waiting: boolean; source: "matched" | "chosen" | null };
  notes: string;
  docs: {
    budget: number;
    used: number;
    /** The longest request that adds a doc, in characters as sent, and what to say when one is longer. */
    bodyLimit: { max: number; message: string };
    list: { title: string; source: string; pasted: boolean; chars: number; inPrompt: boolean }[];
  };
  /** Answering in words from the docs. `chosen` is null while the site follows the default, which is on once it has docs. */
  answers: { on: boolean; chosen: boolean | null };
  connected: boolean;
  origins: SeenOrigin[];
  reading: Reading | null;
  /** Screens mapped from a signed-in browser at the company. */
  mapped: number;
  corrections: Correction[];
  blocked: ControlName[];
  /** Routes taught by doing the task. Absent from a server older than Teach Haptic. */
  taught?: TaughtRoute[];
}

export type Outcome =
  | "finished"
  | "shown"
  | "stopped"
  | "nothing_to_point_at"
  | "loop"
  | "step_limit"
  | "error"
  // On a site with Answers on: answered in words, or declined for one of three reasons. None is billed.
  | "answered"
  | "not_covered"
  | "sensitive"
  | "off_topic"
  // Haptic was asked for a control the company said never to point at.
  | "blocked"
  | "abandoned"
  | "under_way"
  // Only in the count of how guides ended: under way, with no new step for two minutes. A single guide says so with `paused`.
  | "paused";

export interface Insights {
  days: number;
  summary: { guides: number; unanswered: number; helped_yes: number; helped_no: number; median_ms_to_pointer: number | null; median_steps_finished: number | null };
  outcomes: { outcome: Outcome; count: number }[];
  recent: {
    id: string;
    question: string;
    started_at: string;
    started_path: string;
    origin: string | null;
    step_count: number;
    helped: boolean | null;
    outcome: Outcome;
    /** Under way, with nothing new for two minutes. See `paused` on LiveGuide. */
    paused?: boolean;
    wrong_clicks: number;
    ms_to_pointer: number | null;
  }[];
  abandonedAt: { path: string; step: number; target_label: string | null; count: number }[];
  wrongClicks: { path: string; target_label: string; shown: number; wrong: number }[];
  /** The lead: questions grouped by meaning, counted by person, that some people asked and didn't get to the end of. */
  cantFind: { key: string; question: string; visitors: number; found: number; asked: number; stoppedAt: { path: string; step: number; label: string | null; count: number } | null }[];
  /** The most asked groups of the last eight weeks, with each week's finish rate. A flagged one finishes far less often than before. */
  health: HealthGroup[];
  /** Groups the company was told about in the last month. */
  alerts: { key: string; sent_at: string; emailed: boolean }[];
  /** How often questions repeat, and how verified routes are doing. Null until db/migrations/0008_routes is applied. */
  routes: RouteMetrics | null;
}

/** How often questions repeat, and how verified routes are doing. The same shape src/shared/route-metrics.ts describes. */
export interface RouteMetrics {
  guides: number;
  repeated_guides: number;
  looked_up: number;
  repeats: number;
  servable: number;
  agreed: number;
  disagreed: number;
  served: number;
  served_used: number;
  served_ms: number | null;
  model_ms: number | null;
  routes: number;
  trusted_routes: number;
}

/** One of a site's newest questions, with the step it has reached. */
export interface LiveGuide {
  id: string;
  question: string;
  started_at: string;
  started_path: string;
  step_count: number;
  helped: boolean | null;
  outcome: Outcome;
  /**
   * Still open, with no new step for two minutes, by the database's clock. The person has most likely
   * walked away, so the dashboard says paused and not that Haptic is showing a step. A new step ends it.
   */
  paused?: boolean;
  /** When it last moved: its newest step, or its start. */
  moved_at: string;
  /** The step it is on, or ended on. Null before the first answer comes back. */
  last: { n: number; path: string; target_label: string | null; said: string; status: "continue" | "done" | "stuck" } | null;
}

/** What is happening on a site right now. `stamp` changes whenever anything about the last day's questions does. */
export interface Live {
  stamp: string;
  guides: LiveGuide[];
}

/** A site's icon and its own colour, as its first page declares them. Either may be missing. */
export interface Brand {
  icon: string | null;
  /** #RRGGBB, and only a colour that would do for the pointer. */
  colour: string | null;
  from: "stylesheet" | "theme-color" | "manifest" | "icon" | null;
}

/** A site as its card on the list of sites shows it. */
export interface SiteCard {
  id: string;
  name: string;
  origin: string;
  connected: boolean;
  /** Questions and finished guides in the last seven days. */
  guides: number;
  finished: number;
  last: { question: string; started_at: string; outcome: Outcome; paused?: boolean } | null;
  /** The last fortnight, one entry for each day that had a question. */
  daily: { day: string; guides: number }[];
}

export interface HealthGroup {
  key: string;
  question: string;
  weeks: { ago: number; guides: number; finished: number; visitors: number }[];
  flag?: {
    before: number;
    now: number;
    visitorsBefore: number;
    stop: { path: string; step: number; label: string | null } | null;
    missing?: { path: string; role: string | null; label: string };
  };
}

export interface GroupGuide {
  id: string;
  question: string;
  started_at: string;
  helped: boolean | null;
  outcome: Outcome;
  paused?: boolean;
  step_count: number;
}

export interface FinishedList {
  month: string;
  count: number;
  more: boolean;
  guides: { id: string; question: string; started_at: string; ended_at: string; started_path: string; origin: string | null; step_count: number }[];
}

export interface GuideDetail {
  id: string;
  question: string;
  started_at: string;
  started_path: string;
  origin: string | null;
  helped: boolean | null;
  outcome: Outcome;
  paused?: boolean;
  /** Steps asked again because the page changed while the model was answering. */
  cancelled_steps: number;
  steps: {
    n: number;
    path: string;
    target_role: string | null;
    target_label: string | null;
    target_context: string | null;
    said: string;
    status: "continue" | "done" | "stuck";
    event: string | null;
    strayed: boolean;
    ms: number;
    ms_to_target: number;
  }[];
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  finished: "Finished",
  shown: "Answered, not clicked",
  stopped: "Stopped by the visitor",
  nothing_to_point_at: "Nothing to point at",
  loop: "Went in a loop",
  step_limit: "Ran out of steps",
  error: "Error",
  answered: "Answered from the help docs",
  not_covered: "Not in the help docs",
  sensitive: "Left for a person",
  off_topic: "Off topic",
  blocked: "A control you ruled out",
  abandoned: "Abandoned",
  under_way: "Under way",
  paused: "Paused",
};

/** The viewer's clock against UTC in minutes, sent with anything counted by day, so a day starts at their midnight. */
export function clock(): string {
  return `tz=${new Date().getTimezoneOffset()}`;
}
