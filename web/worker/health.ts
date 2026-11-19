// Questions grouped by meaning (question_group, from db/migrations/0011), for
// two things on the dashboard:
//
// - What people can't find. Each group ranked by how many different people
//   asked, with how many of them got there and where the rest gave up. People,
//   not questions: one person asking ten times counts once. A person is the
//   hashed browser id kept on each guide, and a guide without one counts as
//   its own person.
// - Guide health. How often each group's guides finish, week by week. A group
//   whose finish rate drops is flagged, with where its guides now stop and
//   which control they used to point at there and no longer do. That is what
//   a change to the product looks like from here.
//
// Grouping is by normalized text, in the database. No model is asked.

import { cleanText } from "../../src/shared/types";
import type { Sql } from "./db";
import { BATCH_MAX, emailButton, emailPage, escape, sendEmails, type, type SendEnv } from "./sign-in-email";

/** A guide with no ending reported, and nothing new for this long, was abandoned. Matches insights.ts. */
const ABANDONED_AFTER = "30 minutes";
const OUTCOME = `case
  when g.outcome is not null then g.outcome
  when coalesce(g.last_step_at, g.started_at) < now() - interval '${ABANDONED_AFTER}' then 'abandoned'
  else 'under_way' end`;

/** A guide still open that hasn't moved for this long is shown as paused: the person has most likely walked away. */
const PAUSED_AFTER = "2 minutes";
/**
 * True for a guide with no ending whose newest step, or its question if it has no step, is older than
 * that. It only changes the words beside a guide. Nothing is counted by it, and a guide still becomes
 * abandoned on the same clock as before. The database's own clock decides, so a dashboard on a computer
 * whose clock is wrong shows the same thing as any other.
 */
export const PAUSED = `(g.outcome is null and coalesce(g.last_step_at, g.started_at) < now() - interval '${PAUSED_AFTER}')`;

/**
 * The visitor got what they came for: they said so, or the guide finished, was answered in words, or showed them
 * where it is, and they didn't say it didn't help. A first answer they read without clicking ("shown") counts:
 * Haptic knew where it was, which is what "can't find" is about.
 *
 * A guide with no ending has a null outcome, and "null in (...)" is null in SQL, not false. The check
 * for null keeps this false for such a guide, so "not SUCCEEDED" holds for it. Without it an abandoned
 * guide was left out of where people stopped, and the dashboard said they got no first step.
 */
export const SUCCEEDED = `(g.helped is true or (g.helped is distinct from false and g.outcome is not null and g.outcome in ('finished', 'answered', 'shown')))`;
/**
 * Guides that count toward finding and finishing. Not one still under way,
 * and not one no change to the product could finish: a question left for a
 * person, one that had nothing to do with the site, or a control the company
 * ruled out.
 */
export const COUNTED = `((${OUTCOME}) not in ('under_way', 'sensitive', 'off_topic', 'blocked'))`;

/** A group is flagged when its finish rate this week is at least this much lower than in the three weeks before. */
export const DROP = 0.2;
/** And only with at least this many guides in each, so a quiet week doesn't raise an alarm. */
export const MIN_GUIDES = 5;
/** A flagged group is emailed about only when at least this many people asked it in the weeks before. */
export const COMMON_VISITORS = 5;
/** A control counts as one the guides used to use when at least this share of the earlier finished guides pointed at it. */
const USED_TO = 0.5;

export interface CantFind {
  key: string;
  question: string;
  visitors: number;
  found: number;
  asked: number;
  /** Where most of those who didn't get there stopped. Null when they stopped before the first step. */
  stoppedAt: { path: string; step: number; label: string | null; count: number } | null;
}

/** What people asked and couldn't find, ranked by how many different people asked. */
export async function cantFind(sql: Sql, site: string, since: string): Promise<CantFind[]> {
  const rows = await sql.query(
    `with g as (
      select g.id, g.question, g.question_group, g.started_at, coalesce(g.visitor, g.id::text) as who, ${SUCCEEDED} as ok
      from guides g where g.site_id = $1 and g.started_at >= $2 and ${COUNTED}
    ),
    people as (select question_group, who, bool_or(ok) as found from g group by 1, 2),
    groups as (select question_group, count(*)::int as visitors, count(*) filter (where found)::int as found from people group by 1)
    select gr.question_group as key, gr.visitors, gr.found,
      (select g2.question from g g2 where g2.question_group = gr.question_group order by g2.started_at desc limit 1) as question,
      (select count(*)::int from g g2 where g2.question_group = gr.question_group) as asked,
      stop.path, stop.step, stop.target_label, stop.count
    from groups gr
    left join lateral (
      select last.path, last.n + 1 as step, last.target_label, count(*)::int as count
      from g g3 join lateral (select s.path, s.n, s.target_label from steps s where s.guide_id = g3.id order by s.n desc limit 1) last on true
      where g3.question_group = gr.question_group and not g3.ok
      group by 1, 2, 3 order by count desc limit 1
    ) stop on true
    where gr.found < gr.visitors
    order by gr.visitors desc, gr.visitors - gr.found desc, key
    limit 10`,
    [site, since],
  );
  return rows.map((row) => ({
    key: row.key,
    question: row.question,
    visitors: row.visitors,
    found: row.found,
    asked: row.asked,
    stoppedAt: row.path ? { path: row.path, step: row.step, label: row.target_label, count: row.count } : null,
  }));
}

/** The guides in one group, newest first, for the dashboard to open one by one. */
export async function groupGuides(sql: Sql, site: string, key: string, since: string) {
  return sql.query(
    `select g.id, g.question, g.started_at, g.helped, ${OUTCOME} as outcome, ${PAUSED} as paused, g.step_count
    from guides g where g.site_id = $1 and g.question_group = $2 and g.started_at >= $3
    order by g.started_at desc limit 50`,
    [site, key.slice(0, 300), since],
  );
}

export interface Week {
  /** 0 for the last seven days, 1 for the seven before, and so on. */
  ago: number;
  guides: number;
  finished: number;
  visitors: number;
}

export interface Flag {
  /** Share of guides that finished in the three weeks before, and in the last seven days. */
  before: number;
  now: number;
  /** People who asked in the three weeks before. flagDrop has only each week's own count, so its sum counts a person once for each week they asked; guideHealth puts in each person once. */
  visitorsBefore: number;
}

/** Whether a group's finish rate has dropped: this week against the three before it, pooled. */
export function flagDrop(weeks: Week[]): Flag | undefined {
  const now = weeks.find((week) => week.ago === 0);
  const earlier = weeks.filter((week) => week.ago >= 1 && week.ago <= 3);
  const guides = earlier.reduce((sum, week) => sum + week.guides, 0);
  if (!now || now.guides < MIN_GUIDES || guides < MIN_GUIDES) return undefined;
  const before = earlier.reduce((sum, week) => sum + week.finished, 0) / guides;
  const rate = now.finished / now.guides;
  if (before - rate < DROP) return undefined;
  return { before, now: rate, visitorsBefore: earlier.reduce((sum, week) => sum + week.visitors, 0) };
}

/** A control pointed at in a group's guides: in how many of the earlier finished ones, and in how many of this week's. */
export interface PointedRow {
  path: string;
  target_role: string | null;
  target_label: string;
  before_finished: number;
  now: number;
}

/**
 * The control the group's guides used to point at and now don't: pointed at
 * by at least half the finished guides of the three weeks before, on a page
 * this week's guides still reach, and by none of this week's guides.
 */
export function missingControl(rows: PointedRow[], finishedBefore: number, reachedNow: Set<string>): { path: string; role: string | null; label: string } | undefined {
  if (!finishedBefore) return undefined;
  const gone = rows
    .filter((row) => row.now === 0 && row.before_finished / finishedBefore >= USED_TO && reachedNow.has(row.path))
    .sort((a, b) => b.before_finished - a.before_finished || a.path.localeCompare(b.path) || a.target_label.localeCompare(b.target_label));
  const row = gone[0];
  return row ? { path: row.path, role: row.target_role, label: row.target_label } : undefined;
}

export interface Health {
  key: string;
  question: string;
  weeks: Week[];
  flag?: Flag & {
    /** Where this week's unfinished guides most often stopped. */
    stop: { path: string; step: number; label: string | null } | null;
    /** The control they used to point at there and no longer do. */
    missing?: { path: string; role: string | null; label: string };
  };
}

/** The most asked groups of the last eight weeks, with their finish rate each week, flagged groups first. */
export async function guideHealth(sql: Sql, site: string): Promise<Health[]> {
  const rows = await sql.query(
    `with g as (
      select g.question_group, g.question, g.started_at, coalesce(g.visitor, g.id::text) as who, ${SUCCEEDED} as ok,
        floor(extract(epoch from now() - g.started_at) / 604800)::int as ago
      from guides g where g.site_id = $1 and g.started_at >= now() - interval '8 weeks' and ${COUNTED}
    ),
    weeks as (
      select question_group, ago, count(*)::int as guides, count(*) filter (where ok)::int as finished, count(distinct who)::int as visitors
      from g group by 1, 2
    ),
    top as (select question_group, count(distinct who) as people from g group by 1 order by 2 desc, 1 limit 20)
    select t.question_group as key,
      (select g2.question from g g2 where g2.question_group = t.question_group order by g2.started_at desc limit 1) as question,
      (select json_agg(json_build_object('ago', w.ago, 'guides', w.guides, 'finished', w.finished, 'visitors', w.visitors) order by w.ago)
        from weeks w where w.question_group = t.question_group) as weeks,
      (select count(distinct g3.who)::int from g g3 where g3.question_group = t.question_group and g3.ago between 1 and 3) as visitors_before
    from top t order by t.people desc, t.question_group`,
    [site],
  );
  const groups: Health[] = rows.map((row) => ({ key: row.key, question: row.question, weeks: row.weeks as Week[] }));
  for (const [index, group] of groups.entries()) {
    const flag = flagDrop(group.weeks);
    // Each week counts its own people, so a person who asked in two of the weeks is in both. Who asked in the
    // three weeks together, each counted once, is what says the question is a common one (COMMON_VISITORS).
    if (flag) group.flag = { ...flag, visitorsBefore: Number(rows[index]!.visitors_before), ...(await whereItBroke(sql, site, group.key, group.weeks)) };
  }
  return groups.sort((a, b) => Number(Boolean(b.flag)) - Number(Boolean(a.flag)));
}

/** For a flagged group: where this week's guides stop, and the control they no longer point at. */
async function whereItBroke(sql: Sql, site: string, key: string, weeks: Week[]) {
  const [stops, pointed, reached] = await Promise.all([
    sql.query(
      `select last.path, last.n + 1 as step, last.target_label, count(*)::int as count
      from guides g join lateral (select s.path, s.n, s.target_label from steps s where s.guide_id = g.id order by s.n desc limit 1) last on true
      where g.site_id = $1 and g.question_group = $2 and g.started_at >= now() - interval '7 days' and ${COUNTED} and not ${SUCCEEDED}
      group by 1, 2, 3 order by count desc, 1, 2 limit 1`,
      [site, key],
    ),
    sql.query(
      `select s.path, s.target_role, s.target_label,
        count(distinct g.id) filter (where g.started_at < now() - interval '7 days' and ${SUCCEEDED})::int as before_finished,
        count(distinct g.id) filter (where g.started_at >= now() - interval '7 days')::int as now
      from steps s join guides g on g.id = s.guide_id
      where g.site_id = $1 and g.question_group = $2 and g.started_at >= now() - interval '4 weeks' and ${COUNTED} and s.target_label is not null
      group by 1, 2, 3`,
      [site, key],
    ),
    sql.query(
      `select distinct s.path from steps s join guides g on g.id = s.guide_id
      where g.site_id = $1 and g.question_group = $2 and g.started_at >= now() - interval '7 days'`,
      [site, key],
    ),
  ]);
  const finishedBefore = weeks.filter((week) => week.ago >= 1 && week.ago <= 3).reduce((sum, week) => sum + week.finished, 0);
  const stop = stops[0] ? { path: stops[0].path as string, step: stops[0].step as number, label: (stops[0].target_label as string | null) ?? null } : null;
  const missing = missingControl(pointed as PointedRow[], finishedBefore, new Set(reached.map((row) => row.path as string)));
  return { stop, ...(missing ? { missing } : {}) };
}

/**
 * A flagged group's news, in words, for the email to the company's people. The question, the page and the
 * control's name all came from visitors' browsers, and anyone can send the widget server those, so each is
 * quoted the way `quoted` makes safe, and the question is said to be a visitor's.
 */
export function describeBreak(group: Health): string[] {
  const flag = group.flag;
  if (!flag) return [];
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  const lines = [`Guides for "${quoted(group.question, 80)}", as a visitor last asked it, finished ${pct(flag.before)} of the time in the three weeks before, and ${pct(flag.now)} in the last seven days.`];
  if (flag.stop) lines.push(`Guides now stop at step ${flag.stop.step} on ${quotedPath(flag.stop.path)}${flag.stop.label ? `, at "${quoted(flag.stop.label, 40)}"` : ""}.`);
  if (flag.missing) lines.push(`Before, they pointed at "${quoted(flag.missing.label, 40)}" on ${quotedPath(flag.missing.path)}, and no guide has this week. It may have moved or been renamed.`);
  return lines;
}

/**
 * A word a mail program could make a link of, or a person could type into a browser: an address with a scheme,
 * one starting www., a name with a dot and at least two letters after it, as evil.example or bit.ly/x, or an IP
 * address. Abbreviations such as e.g. and U.S. end in one letter, and are left alone.
 */
const LINK_LIKE = /:\/\/|^\W*www[.。]|[\p{L}\p{N}][.。]\p{L}{2,}(?![\p{L}\p{N}])|\d{1,3}(?:[.。]\d{1,3}){3}/iu;

/**
 * Whether a word is LINK_LIKE, read without the marks that sit on a letter, such as an accent or an underline,
 * so none can split a name the check would otherwise see. The word itself keeps them.
 */
function linkLike(word: string): boolean {
  return LINK_LIKE.test(word.replace(/\p{M}/gu, ""));
}

/**
 * Text as it shows: full-width letters and dots written plainly, characters that draw nothing dropped, so none
 * can split a link the check above would see, and line breaks as spaces. What draws nothing is every format
 * character and every one Unicode says to ignore by default, among them the combining grapheme joiner, the
 * variation selectors and the Hangul fillers.
 */
function shown(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ");
}

/**
 * Words a visitor's browser sent, made safe to quote in an email that comes from alerts@joinhaptic.com and so
 * reads as Haptic's own. Anyone can put a question on a site, such as "Your account is locked, sign in again at
 * evil.example", so a word that could be a link becomes [link], emails and long numbers are masked as
 * everywhere else (cleanText), a double quote becomes a single one so the quote can't be closed early, and it
 * is cut short.
 */
export function quoted(text: string, max: number): string {
  // Masked first, so an email address reads as [email] and not as a link, then cut once the links are out.
  const words = cleanText(shown(text), Number.MAX_SAFE_INTEGER).split(" ").map((word) => (linkLike(word) ? "[link]" : word));
  return cleanText(words.join(" ").replace(/["“”„‟«»]/g, "'"), max);
}

/** A page's path, quoted the same way a segment at a time, so a page named like a file keeps the rest of its path. */
function quotedPath(path: string): string {
  const segments = shown(path).replace(/\s+/g, "").split("/").map((segment) => (linkLike(segment) ? "[link]" : segment));
  return cleanText(segments.join("/"), 80);
}

/** Line breaks, every other control character, and the marks that make text run the other way. */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/gu;

/**
 * A site's name on one line, as an email's subject must be: anything that could start another line, or turn
 * the subject around, is a space. The site's name is chosen by its company, and kept this way (app-api.ts).
 */
export function oneLine(text: string, max = 80): string {
  return Array.from(text.replace(BREAKS, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
}

/** What the email suggests, after the news. */
const ADVICE = "This often follows a change to the product. Open the guides on your dashboard to see where they stop, and correct a step if Haptic now points at the wrong thing.";

/** Who the alert comes from. Any address at joinhaptic.com sends through Resend once the domain is verified there. */
export const ALERTS_FROM = "Haptic <alerts@joinhaptic.com>";

/** A site as an alert names it. Its address tells two sites apart: a new site is named after its company. */
export interface AlertSite {
  id: string;
  name: string;
  origin: string;
}

/**
 * The email to a company's people about one flagged group on one of its sites, on the page every Haptic email
 * sits on (sign-in-email.ts). Everything a visitor sent is already quoted short by describeBreak, and escaped here.
 * The button opens that site on the dashboard. `id` is hidden at the end, so Gmail, which threads emails with one
 * subject and folds an ending it has shown before, doesn't fold a later alert's button away.
 */
export function alertEmail(site: AlertSite, group: Health, dashboard: string, id?: string): { subject: string; text: string; html: string } {
  const name = oneLine(site.name);
  const host = URL.canParse(site.origin) ? new URL(site.origin).host : oneLine(site.origin);
  const subject = `Guides for a common question on ${name} stopped finishing`;
  const lines = describeBreak(group);
  const link = `${dashboard}?site=${encodeURIComponent(site.id)}`;
  const paragraph = (text: string, last = false) => `<p class="muted" style="margin:0 0 ${last ? 24 : 16}px;${type(16, 24, 400)}color:#78716C;">${escape(text)}</p>`;
  const html = emailPage({
    title: subject,
    preview: lines[0] ?? subject,
    id,
    card: `<h1 class="ink" style="margin:0 0 8px;${type(24, 32, 500)}letter-spacing:-0.02em;color:#1C1917;">A common question stopped finishing</h1>
<p class="ink" style="margin:0 0 16px;${type(14, 20, 500)}color:#1C1917;word-break:break-all;">${escape(`${name}, ${host}`)}</p>
${lines.map((line) => paragraph(line)).join("\n")}
${paragraph(ADVICE, true)}
${emailButton("Open the site on the dashboard", link)}`,
  });
  return { subject, text: [`${name}, ${host}`, "", ...lines, "", ADVICE, link].join("\n"), html };
}

/** Resend's key, which every Haptic email is sent with. */
export type MailEnv = SendEnv;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One flagged group on one site, as 32 hex characters, whatever the group's key holds. */
async function alertId(site: string, group: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${site}\n${group}`)));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Days before the same group on the same site is emailed about again. */
const ALERT_AGAIN_DAYS = 14;

/** How many times one batch is tried, and the pauses between, in milliseconds. */
const PAUSES_MS = [1_000, 4_000];

/** Worth trying again: Resend couldn't be reached or timed out (0), was over its rate (429), or failed itself (5xx). */
const passing = (status: number) => status === 0 || status === 429 || status >= 500;

/**
 * Emails one flagged group to a company's people, through Resend, as every other Haptic email is. Cloudflare's
 * own email binding only delivers to inboxes verified under Email Routing, which a customer's are not.
 *
 * Everyone is sent it in one batch, which Resend sends whole or not at all, so one answer says whether the
 * team was emailed. A batch Resend couldn't take for a passing reason is tried again after a pause, with
 * the same key, so a retry it already took is not sent twice. `tried` is false with no key or no one to send
 * to; `emailed` is true only once everyone was sent it.
 */
export async function alertPeople(
  env: MailEnv,
  site: AlertSite,
  group: Health,
  people: string[],
  dashboard: string,
  fetcher: Fetch,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ tried: boolean; emailed: boolean }> {
  if (!env.RESEND_API_KEY || !people.length) return { tried: false, emailed: false };
  const id = await alertId(site.id, group.key);
  const { subject, text, html } = alertEmail(site, group, dashboard, id);
  const day = new Date().toISOString().slice(0, 10);
  let everyone = true;
  for (let start = 0; start < people.length; start += BATCH_MAX) {
    const emails = people.slice(start, start + BATCH_MAX).map((to) => ({ to, subject, text, html, from: ALERTS_FROM }));
    const key = `health-alert/${site.id}/${day}/${id}/${start / BATCH_MAX}`;
    let sent = await sendEmails(env, emails, key, fetcher);
    for (const ms of PAUSES_MS) {
      if (sent.ok || !passing(sent.status)) break;
      await pause(ms);
      sent = await sendEmails(env, emails, key, fetcher);
    }
    if (!sent.ok) {
      everyone = false;
      console.error(`Couldn't email ${site.id} about ${group.key}: Resend answered ${sent.status} ${sent.detail}`);
    }
  }
  return { tried: true, emailed: everyone };
}

/**
 * Run once a day by the Worker's schedule. For every company's site, finds the
 * common questions whose guides stopped finishing, and emails the company's
 * people about each one not already sent in the last fortnight. It runs apart
 * from any visitor's step.
 */
export async function sendHealthAlerts(sql: Sql, env: MailEnv, dashboard = "https://joinhaptic.com/dashboard/", fetcher: Fetch = (input, init) => fetch(input, init)): Promise<number> {
  const sites = (await sql`select id, name, origin, company_id from sites where company_id is not null`) as (AlertSite & { company_id: string })[];
  let sent = 0;
  for (const site of sites) {
    const broken = (await guideHealth(sql, site.id)).filter((group) => group.flag && group.flag.visitorsBefore >= COMMON_VISITORS);
    for (const group of broken) {
      const [recent] = await sql`
        select 1 as found from health_alerts where site_id = ${site.id} and question_group = ${group.key} and sent_at > now() - make_interval(days => ${ALERT_AGAIN_DAYS})`;
      if (recent) continue;
      const people = (await sql`
        select u.email from neon_auth.member m join neon_auth."user" u on u.id = m."userId"
        where m."organizationId" = ${site.company_id}::uuid and u."emailVerified" = true`) as { email: string }[];
      const { tried, emailed } = await alertPeople(env, site, group, people.map((person) => person.email), dashboard, fetcher);
      // Sent to nobody it was tried for: nothing is kept, so tomorrow's run tries again instead of waiting a
      // fortnight. With no key or no one to send to, the alert is kept for the dashboard only, as before.
      if (tried && !emailed) continue;
      await sql`
        insert into health_alerts (site_id, question_group, finished_before, finished_now, emailed)
        values (${site.id}, ${group.key}, ${group.flag!.before}, ${group.flag!.now}, ${emailed})`;
      if (emailed) sent++;
    }
  }
  return sent;
}
