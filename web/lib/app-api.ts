"use client";

// The signed-in pages' calls to the site's Worker (worker/app-api.ts), and the
// shapes it answers with.

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

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(`/api/app${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    signal: init?.signal,
  }).catch(() => null);
  // The browser's own words for this differ in each browser, and none of them say what to do.
  if (!response) throw new ApiError(0, "Haptic couldn't be reached. Check your connection and try again.");
  const data = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? "Something went wrong on our side. Try again in a moment.", data.field);
  return data as T;
}

export interface Me {
  user: { email: string; name: string };
  approved: boolean;
  reason?: "unverified" | "not_approved";
  organization?: { id: string; name: string; role: string };
  sites?: { id: string; name: string; origin: string; connected: boolean }[];
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
  scriptUrl: string;
  /** `launcher` is the Ask button's own colour. Missing means Ink. */
  appearance: { accent: string; position: "bottom-right" | "bottom-left"; launcherLabel: string; launcher?: string };
  notes: string;
  docs: {
    budget: number;
    used: number;
    list: { title: string; source: string; pasted: boolean; chars: number; inPrompt: boolean }[];
  };
  /** Answering in words from the docs. `chosen` is null while the site follows the default, which is on once it has docs. */
  answers: { on: boolean; chosen: boolean | null };
  connected: boolean;
  origins: SeenOrigin[];
  reading: Reading | null;
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
