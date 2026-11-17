// Teach Haptic, from the dashboard (src/shared/teach.ts). A person starts a
// teach session for a question, which opens their site in a new tab with a
// one-time token in the address's fragment. The widget there records the
// task and posts the steps to the widget server, which keeps them on the
// session. Here the person reviews them (delete a step, add a note, name a
// control the recorder could not, leave the last click to the visitor) and
// saves them as a taught route in the site's context, beside the corrections.
//
//   POST   /api/app/sites/:id/teach             start one: {question, guide?, path?}
//   GET    /api/app/sites/:id/teach             the open ones and those waiting for review
//   GET    /api/app/sites/:id/teach/:session    one, with its steps once they are in
//   POST   /api/app/sites/:id/teach/:session    save it as a taught route: {steps: [{n, note?, name?}], leaveLast?}
//   DELETE /api/app/sites/:id/teach/:session    close it without saving
//   DELETE /api/app/sites/:id/taught/:route     remove a taught route

import { cleanText, normalizePath, questionKey, type SiteContext } from "../../src/shared/types";
import {
  cleanTaughtSteps,
  hashTeachToken,
  isUnnamed,
  MAX_NOTE,
  MAX_TAUGHT_ROUTES,
  MAX_TAUGHT_STEPS,
  newTeachToken,
  routeText,
  TEACH_FRAGMENT,
  TEACH_MINUTES,
  type TaughtRoute,
  type TaughtStep,
} from "../../src/shared/teach";
import type { Sql } from "./db";

/** A request the person can fix, or one for something that is not there. */
export class TeachRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Teaching links a site can have waiting to be opened at once. */
const MAX_WAITING = 10;
/** A session nobody saved is deleted this long after it was made. */
const KEEP_UNSAVED_DAYS = 7;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROUTE_ID = /^[0-9a-f]{8}$/;

export interface TeachSite {
  id: string;
  origin: string;
  allowed_origins: string[];
  context: SiteContext;
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
}

export type TeachStatus = "waiting" | "teaching" | "ready" | "saved" | "cancelled" | "expired";

/** A step as the dashboard shows it: the step, its plain sentence, and whether the recorder could name its control. */
export type StepView = TaughtStep & { text: string; unnamed: boolean };

export interface TeachSessionView {
  id: string;
  question: string;
  status: TeachStatus;
  createdAt: string;
  expiresAt: string;
  by: string | null;
  stepCount: number;
  steps: StepView[] | null;
}

interface SessionRow {
  id: string;
  question: string;
  created_by_name: string | null;
  created_at: string | Date;
  expires_at: string | Date;
  claimed_at: string | Date | null;
  finished_at: string | Date | null;
  cancelled_at: string | Date | null;
  saved_at: string | Date | null;
  steps: unknown;
  expired: boolean;
}

const iso = (value: string | Date) => new Date(value).toISOString();

/** Steps with the sentence each is shown as. */
export function stepViews(steps: TaughtStep[]): StepView[] {
  const texts = routeText(steps);
  return steps.map((step, index) => ({ ...step, text: texts[index]!, unnamed: isUnnamed(step) }));
}

/** A taught route as the dashboard lists it. */
export function routeView(route: TaughtRoute) {
  return { ...route, steps: stepViews(route.steps) };
}

function statusOf(row: SessionRow): TeachStatus {
  if (row.saved_at) return "saved";
  if (row.cancelled_at) return "cancelled";
  if (row.finished_at) return "ready";
  if (row.expired) return "expired";
  return row.claimed_at ? "teaching" : "waiting";
}

function view(row: SessionRow, withSteps: boolean): TeachSessionView {
  const steps = Array.isArray(row.steps) ? cleanTaughtSteps(row.steps) : null;
  return {
    id: row.id,
    question: row.question,
    status: statusOf(row),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    by: row.created_by_name,
    stepCount: steps?.length ?? 0,
    steps: withSteps && steps ? stepViews(steps) : null,
  };
}

/**
 * Where the teaching tab opens: the page the failed guide started on, when it
 * has no record's id in it and is on an address the site allows, or the
 * site's own first page. The token goes after #, so it never reaches the
 * site's server or its logs.
 */
function openAt(site: TeachSite, origin: string | null, path: string | null, token: string): string {
  const at = origin && site.allowed_origins.includes(origin) ? origin : site.origin;
  const page = path && path.startsWith("/") && !path.includes(":id") && path.length <= 200 ? normalizePath(path) : "/";
  return `${at}${page}#${TEACH_FRAGMENT}=${token}`;
}

/**
 * Starts a teach session: a random token, of which only the hash is kept,
 * the site, the question, who started it, and 30 minutes to open it in. The
 * token is answered once, in the address to open, and never again.
 */
export async function startTeaching(sql: Sql, site: TeachSite, teacher: Teacher, input: Record<string, unknown>) {
  let question = typeof input.question === "string" ? cleanText(input.question, 300) : "";
  const guide = typeof input.guide === "string" && SESSION_ID.test(input.guide) ? input.guide : null;
  let origin: string | null = null;
  let path = typeof input.path === "string" ? input.path : null;
  if (guide) {
    const [row] = (await sql`select question, origin, started_path from guides where id = ${guide} and site_id = ${site.id}`) as {
      question: string;
      origin: string | null;
      started_path: string | null;
    }[];
    if (!row) throw new TeachRefused(404, "That guide isn't on this site.");
    question ||= row.question;
    origin = row.origin;
    path ??= row.started_path;
  }
  if (question.replace(/[^\p{L}\p{N}]/gu, "").length < 3) throw new TeachRefused(400, "Write the question Haptic should learn to answer, like “how do I add a budget”.");
  // Sessions nobody saved go after a week, so no recorded steps are kept for long without a reason. The daily clean-up
  // (forgetOldTeaching) does the same for every site.
  await sql`delete from teach_sessions where site_id = ${site.id} and saved_at is null and created_at < now() - ${`${KEEP_UNSAVED_DAYS} days`}::interval`;
  const [counted] = (await sql`
    select count(*)::int as waiting from teach_sessions
    where site_id = ${site.id} and claimed_at is null and cancelled_at is null and expires_at > now()`) as { waiting: number }[];
  if ((counted?.waiting ?? 0) >= MAX_WAITING) throw new TeachRefused(400, `This site has ${MAX_WAITING} teaching links waiting to be opened. Use one of them, or wait half an hour.`);
  const token = newTeachToken();
  const rows = (await sql`
    insert into teach_sessions (site_id, token_hash, question, guide_id, created_by, created_by_name, expires_at)
    values (${site.id}, ${await hashTeachToken(token)}, ${question}, ${guide}, ${teacher.id}, ${(teacher.name || teacher.email).slice(0, 120)},
      now() + ${`${TEACH_MINUTES} minutes`}::interval)
    returning id, question, created_by_name, created_at, expires_at, claimed_at, finished_at, cancelled_at, saved_at, steps, false as expired`) as SessionRow[];
  return { session: view(rows[0]!, false), url: openAt(site, origin, path, token) };
}

const COLUMNS = "id, question, created_by_name, created_at, expires_at, claimed_at, finished_at, cancelled_at, saved_at, steps, expires_at < now() as expired";

/** The sessions still worth showing: waiting, under way, or with steps waiting for review. Newest first. */
export async function listTeaching(sql: Sql, siteId: string): Promise<TeachSessionView[]> {
  const rows = (await sql.query(
    `select ${COLUMNS} from teach_sessions
     where site_id = $1 and saved_at is null and cancelled_at is null and (finished_at is not null or expires_at > now())
     order by created_at desc limit 20`,
    [siteId],
  )) as SessionRow[];
  return rows.map((row) => view(row, false));
}

async function sessionRow(sql: Sql, siteId: string, id: string): Promise<SessionRow> {
  if (!SESSION_ID.test(id)) throw new TeachRefused(404, "No such teaching session.");
  const [row] = (await sql.query(`select ${COLUMNS} from teach_sessions where id = $1 and site_id = $2`, [id, siteId])) as SessionRow[];
  if (!row) throw new TeachRefused(404, "No such teaching session.");
  return row;
}

export async function getTeaching(sql: Sql, siteId: string, id: string): Promise<TeachSessionView> {
  return view(await sessionRow(sql, siteId, id), true);
}

/** Closes a session without saving, and deletes the steps it recorded. A tab still teaching is told so the next time it asks. */
export async function closeTeaching(sql: Sql, siteId: string, id: string): Promise<TeachSessionView> {
  await sessionRow(sql, siteId, id);
  await sql`update teach_sessions set cancelled_at = now(), steps = null where id = ${id} and site_id = ${siteId} and saved_at is null and cancelled_at is null`;
  return getTeaching(sql, siteId, id);
}

/**
 * The daily clean-up (handler.ts). On every site, whether or not anyone
 * teaches again: a session nobody saved is deleted a week after it was made,
 * and no session that was saved or closed keeps the steps it recorded. Saving
 * and closing delete them already, so the second only finds a session from
 * before they did.
 */
export async function forgetOldTeaching(sql: Sql): Promise<void> {
  await sql.transaction([
    sql`delete from teach_sessions where saved_at is null and created_at < now() - ${`${KEEP_UNSAVED_DAYS} days`}::interval`,
    sql`update teach_sessions set steps = null where steps is not null and (saved_at is not null or cancelled_at is not null)`,
  ]);
}

/**
 * The reviewed steps, from the steps the tab sent: only those kept, in their
 * order, each with a note if one was added, a name for a control the recorder
 * could not name, and the last one left for the visitor if asked. Nothing
 * else about a step can be changed here, so a route only ever holds what the
 * page showed. A step that commits is always left for the visitor.
 */
export function reviewedSteps(recorded: TaughtStep[], input: Record<string, unknown>): TaughtStep[] {
  if (!Array.isArray(input.steps) || !input.steps.length) throw new TeachRefused(400, "Keep at least one step, or discard this route.");
  if (input.steps.length > MAX_TAUGHT_STEPS) throw new TeachRefused(400, `A route can have at most ${MAX_TAUGHT_STEPS} steps.`);
  const kept: TaughtStep[] = [];
  let previous = -1;
  for (const item of input.steps as unknown[]) {
    const raw = (item ?? {}) as Record<string, unknown>;
    const n = Number(raw.n);
    if (!Number.isInteger(n) || n <= previous || n >= recorded.length) throw new TeachRefused(400, "Those steps don't match what was recorded. Reload the review.");
    previous = n;
    const step: TaughtStep = { ...recorded[n]! };
    delete step.note;
    delete step.leave;
    const note = typeof raw.note === "string" ? cleanText(raw.note, MAX_NOTE) : "";
    if (note) step.note = note;
    if (isUnnamed(step)) {
      const name = typeof raw.name === "string" ? cleanText(raw.name, 80) : "";
      if (!name) throw new TeachRefused(400, `Step ${kept.length + 1} is an unnamed control on ${step.path}. Type the words on it, or delete the step.`);
      if (step.kind === "choose") step.choice = name;
      else step.label = name;
    }
    kept.push(step);
  }
  if (input.leaveLast === true) kept[kept.length - 1]!.leave = true;
  return cleanTaughtSteps(kept, { withNotes: true });
}

/**
 * Saves a session's reviewed steps as a taught route. A route for the same
 * question replaces the one before. The route is then the only copy: the
 * session keeps when it was saved and by whom, and no longer the steps it
 * recorded, nor those the reviewer deleted. A route that goes, replaced or
 * past the most a site keeps, takes the session it was saved from with it.
 * If saving fails, the session keeps its steps, so the person can try again.
 */
export async function saveTaught(sql: Sql, site: TeachSite, orgId: string, id: string, input: Record<string, unknown>) {
  const row = await sessionRow(sql, site.id, id);
  const status = statusOf(row);
  if (status === "saved") throw new TeachRefused(400, "These steps are saved already.");
  if (status !== "ready") throw new TeachRefused(400, "The steps haven't come in yet. Press Done on the bar in your site's tab.");
  const steps = reviewedSteps(cleanTaughtSteps(row.steps), input);
  const route: TaughtRoute = {
    id: [...crypto.getRandomValues(new Uint8Array(4))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    question: row.question,
    steps,
    createdAt: new Date().toISOString(),
    ...(row.created_by_name ? { by: row.created_by_name } : {}),
  };
  const key = questionKey(row.question);
  const before = site.context.taught ?? [];
  const taught = [...before.filter((item) => questionKey(item.question) !== key), route].slice(-MAX_TAUGHT_ROUTES);
  const gone = before.filter((item) => !taught.includes(item)).map((item) => item.question);
  // Both or neither: a route is never saved without its session saying so, nor the reverse.
  await sql.transaction([
    sql`
      update sites set context = jsonb_set(context, '{taught}', ${JSON.stringify(taught)}::jsonb), updated_at = now()
      where id = ${site.id} and company_id = ${orgId}`,
    sql`update teach_sessions set saved_at = now(), steps = null where id = ${id} and site_id = ${site.id} and saved_at is null`,
    sql`delete from teach_sessions where site_id = ${site.id} and id <> ${id} and saved_at is not null and question = any(${gone}::text[])`,
  ]);
  return { taught: taught.map(routeView), route: routeView(route) };
}

/**
 * Removes a taught route, and the session it was saved from, so nothing of it
 * is left. Both are read from the site as it is now, in one transaction, so a
 * route saved meanwhile is kept.
 */
export async function removeTaught(sql: Sql, site: TeachSite, orgId: string, id: string) {
  if (!ROUTE_ID.test(id)) throw new TeachRefused(404, "No such route.");
  const [, updated] = await sql.transaction([
    sql`
      delete from teach_sessions where site_id = ${site.id} and saved_at is not null and question in (
        select route->>'question' from sites, jsonb_array_elements(coalesce(context->'taught', '[]'::jsonb)) as route
        where sites.id = ${site.id} and sites.company_id = ${orgId} and route->>'id' = ${id})`,
    sql`
      update sites set context = jsonb_set(context, '{taught}', coalesce((
          select jsonb_agg(route order by at) from jsonb_array_elements(coalesce(context->'taught', '[]'::jsonb)) with ordinality as listed(route, at)
          where route->>'id' <> ${id}), '[]'::jsonb)), updated_at = now()
      where id = ${site.id} and company_id = ${orgId}
      returning context->'taught' as taught`,
  ]);
  const row = (updated as { taught: TaughtRoute[] }[] | undefined)?.[0];
  if (!row) throw new TeachRefused(404, "No such site.");
  return { taught: row.taught.map(routeView) };
}

/** Routes one teach request under /sites/:id. `rest` is what follows /teach or /taught. */
export async function teachApi(sql: Sql, site: TeachSite, orgId: string, teacher: Teacher, method: string, kind: "teach" | "taught", rest: string, body: () => Promise<Record<string, unknown>>) {
  if (kind === "taught") {
    if (method === "DELETE" && rest) return { status: 200, body: await removeTaught(sql, site, orgId, rest) };
    throw new TeachRefused(404, "Not found.");
  }
  if (!rest) {
    if (method === "POST") return { status: 201, body: await startTeaching(sql, site, teacher, await body()) };
    if (method === "GET") return { status: 200, body: { sessions: await listTeaching(sql, site.id) } };
  } else {
    if (method === "GET") return { status: 200, body: await getTeaching(sql, site.id, rest) };
    if (method === "POST") return { status: 200, body: await saveTaught(sql, site, orgId, rest, await body()) };
    if (method === "DELETE") return { status: 200, body: await closeTeaching(sql, site.id, rest) };
  }
  throw new TeachRefused(404, "Not found.");
}
