// What a company changes about how Haptic guides on its site, from the dashboard:
// "Point here instead" on any step, and the controls Haptic must never point at.
// Both are kept in the site's context, which the widget server reads with the
// site, so a change reaches visitors within a minute and a step never waits for it.

import { questionKey, type PageNode, type SiteContext } from "../../src/shared/types";
import type { ControlName, Correction } from "../../src/shared/corrections";
import type { Sql } from "./db";

const MAX_CORRECTIONS = 200;
const MAX_BLOCKED = 50;
/** The kinds of control a person can pick. They match the roles the widget gives what it lists. */
export const CONTROL_ROLES = ["button", "link", "tab", "menuitem", "textbox", "select", "checkbox", "radio", "switch", "combobox", "option", "clickable"];
/**
 * How many visitors must have seen a learned label, from how many networks, before it is offered here, as before the
 * prompt gets it (src/server/learned.ts). Anyone can make up visitors, so a label from one network is never offered.
 */
const LEARNED_SHOWN_AT = 3;

/** A correction or list turned away. `field` names the one input at fault, as Refusal's does in app-api.ts. */
export class Invalid extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

function control(input: unknown): ControlName {
  const raw = (input ?? {}) as Record<string, unknown>;
  const label = typeof raw.label === "string" ? raw.label.replace(/\s+/g, " ").trim() : "";
  if (!label) throw new Invalid("Name the control by the words on it.", "label");
  if (label.length > 80) throw new Invalid("That label is too long. Use the words on the control.", "label");
  const role = typeof raw.role === "string" && raw.role ? raw.role : undefined;
  if (role && !CONTROL_ROLES.includes(role)) throw new Invalid(`"${role.slice(0, 20)}" isn't a kind of control.`, "role");
  return role ? { role, label } : { label };
}

async function saveContextField(sql: Sql, siteId: string, orgId: string, field: "corrections" | "blocked", value: unknown) {
  await sql`
    update sites set context = jsonb_set(context, ${`{${field}}`}::text[], ${JSON.stringify(value)}::jsonb), updated_at = now()
    where id = ${siteId} and company_id = ${orgId}`;
}

/**
 * The controls known to be on a page, for the "Point here instead" picker: the
 * crawl's, and those enough visitors have seen there. The page itself is not
 * kept with a guide, so this is what can be offered, with a box for any other.
 * Learned ones come in the order the prompt reads them (`learnedLabels` in
 * src/server/db.ts): by networks, then seen lately, then known longest. Never
 * by how often a label was sent or how many visitor ids sent it, which anyone
 * can raise, so labels sent over and over don't push real ones out of the list.
 */
export async function knownControls(sql: Sql, site: { id: string; context: SiteContext }, route: string): Promise<ControlName[]> {
  const page: PageNode | undefined = (site.context.pages ?? []).find((item) => item.path === route);
  const found: ControlName[] = [];
  const add = (role: string, label: string) => {
    if (label && !found.some((item) => item.role === role && item.label === label)) found.push({ role, label });
  };
  for (const label of page?.buttons ?? []) add("button", label);
  for (const link of page?.links ?? []) add("link", link.label);
  for (const label of page?.fields ?? []) add("textbox", label);
  try {
    const learned = (await sql`
      select kind, label from outline_labels where site_id = ${site.id} and route = ${route} and kind in ('link', 'button')
        and visitor_count >= ${LEARNED_SHOWN_AT} and network_count >= ${LEARNED_SHOWN_AT}
      order by network_count desc, last_seen_at > now() - interval '30 days' desc, first_seen_at, kind, label, href limit 100`) as { kind: string; label: string }[];
    for (const row of learned) add(row.kind, row.label);
  } catch {
    // Nothing learned yet, or the table or its networks (db/migrations/0014) aren't there. The crawl's controls are still offered.
  }
  return found.slice(0, 200);
}

/**
 * Saves "Point here instead" for one step of one guide. The step says which
 * page it was on, what was asked and what was pointed at, so only the right
 * control comes from the person. A correction for the same question on the
 * same page replaces the one before.
 */
export async function addCorrection(sql: Sql, site: { id: string; context: SiteContext }, orgId: string, input: Record<string, unknown>): Promise<Correction[]> {
  const guide = typeof input.guide === "string" && /^[0-9a-f-]{36}$/.test(input.guide) ? input.guide : "";
  const step = Number(input.step);
  if (!guide || !Number.isInteger(step) || step < 0) throw new Invalid("Say which step to correct.");
  const right = control(input.right);
  const [row] = (await sql`
    select s.path, s.target_role, s.target_label, g.question from steps s join guides g on g.id = s.guide_id
    where g.id = ${guide} and g.site_id = ${site.id} and s.n = ${step}`) as { path: string; target_role: string | null; target_label: string | null; question: string }[];
  if (!row) throw new Invalid("That step isn't on this site.");
  const correction: Correction = {
    id: crypto.randomUUID().slice(0, 8),
    route: row.path,
    question: row.question,
    ...(row.target_label ? { wrong: { ...(row.target_role ? { role: row.target_role } : {}), label: row.target_label } } : {}),
    right,
    createdAt: new Date().toISOString(),
  };
  const key = questionKey(row.question);
  const kept = (site.context.corrections ?? []).filter((item) => !(item.route === correction.route && questionKey(item.question) === key));
  const corrections = [...kept, correction].slice(-MAX_CORRECTIONS);
  await saveContextField(sql, site.id, orgId, "corrections", corrections);
  return corrections;
}

export async function removeCorrection(sql: Sql, site: { id: string; context: SiteContext }, orgId: string, id: string): Promise<Correction[]> {
  const corrections = (site.context.corrections ?? []).filter((item) => item.id !== id);
  await saveContextField(sql, site.id, orgId, "corrections", corrections);
  return corrections;
}

/** Replaces the list of controls Haptic must never point at. */
export async function setBlocked(sql: Sql, siteId: string, orgId: string, input: unknown): Promise<ControlName[]> {
  if (!Array.isArray(input)) throw new Invalid("Send the controls as a list.");
  if (input.length > MAX_BLOCKED) throw new Invalid(`A site can list at most ${MAX_BLOCKED} controls.`);
  const blocked: ControlName[] = [];
  for (const item of input) {
    const next = control(item);
    if (!blocked.some((other) => other.label.toLowerCase() === next.label.toLowerCase() && other.role === next.role)) blocked.push(next);
  }
  await saveContextField(sql, siteId, orgId, "blocked", blocked);
  return blocked;
}
