"use client";

// The signed-in pages' calls to the site's Worker (worker/app-api.ts), and the
// shapes it answers with.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/app${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `The server answered ${response.status}.`);
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

export interface Site {
  id: string;
  name: string;
  origin: string;
  allowedOrigins: string[];
  scriptUrl: string;
  appearance: { accent: string; position: "bottom-right" | "bottom-left"; launcherLabel: string };
  notes: string;
  docs: {
    budget: number;
    used: number;
    list: { title: string; source: string; pasted: boolean; chars: number; inPrompt: boolean }[];
  };
  connected: boolean;
  origins: SeenOrigin[];
  reading: Reading | null;
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
  | "abandoned"
  | "under_way";

export interface Insights {
  days: number;
  summary: { guides: number; unanswered: number; helped_yes: number; helped_no: number; median_ms_to_pointer: number | null; median_steps_finished: number | null };
  outcomes: { outcome: Outcome; count: number }[];
  unanswered: { key: string; question: string; asked: number; unanswered: number; last_asked: string; example: string | null }[];
  recent: {
    id: string;
    question: string;
    started_at: string;
    started_path: string;
    origin: string | null;
    step_count: number;
    helped: boolean | null;
    outcome: Outcome;
    wrong_clicks: number;
    ms_to_pointer: number | null;
  }[];
  abandonedAt: { path: string; step: number; target_label: string | null; count: number }[];
  wrongClicks: { path: string; target_label: string; shown: number; wrong: number }[];
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
  abandoned: "Abandoned",
  under_way: "Under way",
};
