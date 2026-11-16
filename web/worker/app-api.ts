// What the signed-in part of joinhaptic.com asks the Worker for, under /api/app/.
//
//   GET    /api/app/me                          who is signed in, and their company; makes the company on first sign-in
//   POST   /api/app/sites                       add a site from its address, and start reading its public pages
//   GET    /api/app/sites/:id                   a site, its install health and how far the reading has got
//   PATCH  /api/app/sites/:id                   change its name or the origins it may run on
//   POST   /api/app/sites/:id/read              read a few more public pages
//   GET    /api/app/sites/:id/insights          the dashboard: questions, outcomes, what to fix
//   GET    /api/app/sites/:id/guides/:guide     one guide, step by step
//   GET    /api/app/sites/:id/groups?key=…      the guides for one question, grouped by meaning
//   GET    /api/app/sites/:id/controls?route=…  the controls known on a page, for "Point here instead"
//   POST   /api/app/sites/:id/corrections       point a step of a guide at another control from now on
//   DELETE /api/app/sites/:id/corrections/:id   take a correction back
//   PUT    /api/app/sites/:id/blocked           the controls Haptic must never point at
//   GET    /api/app/approve?key=…&sig=…         an access request, for the team's approve page
//   POST   /api/app/approve                     approve it, and email the person a sign-in link
//
// The setup screens, the email to a developer and the dashboard's top numbers
// are answered in setup-api.ts.
//
// Every site is looked up together with the caller's organization, so a site
// id, which is public, is never enough to read or change someone's data.

import { cleanText, DEFAULT_APPEARANCE, type Appearance, type Doc, type PageNode, type SiteContext } from "../../src/shared/types";
import { DOCS_BUDGET, docFromUrl, docsThatFit, MAX_DOC_CHARS, MAX_DOCS, pastedDoc } from "./docs";
import { isPersonalEmail, emailDomain, type AccessRequest } from "../lib/access-request";
import { pageControls } from "../lib/setup";
import { currentUser, sendSignInLink, type AuthEnv, type SignedInUser } from "./auth";
import { database, joinOrganization, organizationOf, type Organization, type Sql } from "./db";
import { addCorrection, Invalid, knownControls, removeCorrection, setBlocked } from "./corrections";
import { groupGuides } from "./health";
import { finishedCsv, finishedGuides, guideSteps, insights, monthOf } from "./insights";
import { MAX_PAGES, readMore, startReading, type BrowserBinding, type Reading } from "./reader";
import { readingExtras, setupOf, setupRoutes } from "./setup-api";
import type { SendEnv } from "./sign-in-email";

export interface AppEnv extends AuthEnv, SendEnv {
  ACCESS_REQUESTS: { put(key: string, value: string): Promise<void>; get(key: string): Promise<string | null> };
  /** Neon's connection string. A secret. */
  DATABASE_URL?: string;
  /** Signs the Approve links in the team's request emails. A secret. */
  APPROVE_SECRET?: string;
  /** Cloudflare Browser Rendering, for reading pages built with JavaScript. Optional. */
  BROWSER?: BrowserBinding;
  /** The widget server, as it goes in the script tag. */
  WIDGET_URL?: string;
}

const SITE_ID = /^site_[a-z0-9_]{3,40}$/;
const MAX_SITES = 5;
const MAX_ORIGINS = 20;
const MAX_REFUSED_SHOWN = 5;

interface SeenOrigin {
  origin: string;
  allowed: boolean;
  first_seen_at: string;
  last_seen_at: string;
  requests: number;
}

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function appApi(request: Request, env: AppEnv, url: URL): Promise<Response> {
  const cookies: string[] = [];
  const reply = (body: unknown, status = 200) => {
    const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return new Response(JSON.stringify(body), { status, headers });
  };
  try {
    if (!env.DATABASE_URL) throw new Refusal(503, "The database is not set up on this server.");
    // Changes only come from our own pages. Sessions are SameSite=Lax cookies as well.
    if (request.method !== "GET" && request.headers.get("origin") !== url.origin) throw new Refusal(403, "Not allowed from this site.");
    const sql = database(env.DATABASE_URL);
    const path = url.pathname.slice("/api/app".length).replace(/\/$/, "");

    if (path === "/approve") return reply(request.method === "POST" ? await approve(request, env, sql, url) : await showRequest(env, sql, url));

    const session = await currentUser(request, env);
    cookies.push(...session.cookies);
    if (!session.user) throw new Refusal(401, "Sign in first.");
    const user = session.user;

    if (path === "/me" && request.method === "GET") return reply(await me(sql, user));

    const org = await organizationOf(sql, user.id);
    if (!org) throw new Refusal(403, "Your account isn't approved yet.");

    if (path === "/sites" && request.method === "POST") return reply(await addSite(sql, org, await body(request)), 201);
    const more = await setupRoutes({ request, env, sql, org, user, path, url });
    if (more) return reply(more.body, more.status);

    const match = /^\/sites\/([^/]+)(\/read|\/insights|\/finished|\/docs|\/guides\/([^/]+)|\/controls|\/groups|\/blocked|\/corrections(?:\/([0-9a-f]{8}))?)?$/.exec(path);
    if (match) {
      const id = match[1] ?? "";
      if (!SITE_ID.test(id)) throw new Refusal(404, "No such site.");
      const sub = match[2];
      if (!sub && request.method === "GET") return reply(await siteStatus(sql, env, org, id));
      if (!sub && request.method === "PATCH") return reply(await changeSite(sql, env, org, id, await body(request)));
      if (!sub && request.method === "DELETE") return reply(await deleteSite(sql, org, id, await body(request)));
      if (sub === "/docs" && request.method === "POST") return reply(await addDoc(sql, env, org, id, await body(request)), 201);
      if (sub === "/docs" && request.method === "DELETE") return reply(await removeDoc(sql, env, org, id, url.searchParams.get("source") ?? ""));
      if (sub === "/read" && request.method === "POST") return reply(await readSite(sql, env, org, id, (await body(request)).restart === true));
      if (sub === "/insights" && request.method === "GET") {
        await ownedSite(sql, org, id);
        const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
        return reply(await insights(sql, id, days));
      }
      if (sub === "/finished" && request.method === "GET") {
        const site = await ownedSite(sql, org, id);
        const asked = url.searchParams.get("month") ?? "";
        const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : monthOf(new Date());
        const list = await finishedGuides(sql, id, month);
        if (url.searchParams.get("format") !== "csv") return reply(list);
        const name = `haptic-finished-guides-${new URL(site.origin).hostname}-${month}.csv`.replace(/[^a-z0-9.-]/gi, "-");
        const headers = new Headers({ "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" });
        for (const cookie of cookies) headers.append("set-cookie", cookie);
        return new Response(finishedCsv(list), { headers });
      }
      if (sub === "/groups" && request.method === "GET") {
        await ownedSite(sql, org, id);
        const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
        return reply({ guides: await groupGuides(sql, id, url.searchParams.get("key") ?? "", new Date(Date.now() - days * 86_400_000).toISOString()) });
      }
      if (sub === "/controls" && request.method === "GET") {
        const site = await ownedSite(sql, org, id);
        return reply({ controls: await knownControls(sql, site, url.searchParams.get("route") ?? "/") });
      }
      if (sub?.startsWith("/corrections") || sub === "/blocked") {
        const site = await ownedSite(sql, org, id);
        try {
          if (sub === "/corrections" && request.method === "POST") return reply({ corrections: await addCorrection(sql, site, org.id, await body(request)) }, 201);
          if (match[4] && request.method === "DELETE") return reply({ corrections: await removeCorrection(sql, site, org.id, match[4]) });
          if (sub === "/blocked" && request.method === "PUT") return reply({ blocked: await setBlocked(sql, id, org.id, (await body(request)).controls) });
        } catch (error) {
          if (error instanceof Invalid) throw new Refusal(400, error.message);
          throw error;
        }
      }
      if (match[3] && request.method === "GET") {
        await ownedSite(sql, org, id);
        const steps = await guideSteps(sql, id, match[3]);
        if (!steps) throw new Refusal(404, "No such guide.");
        return reply(steps);
      }
    }
    throw new Refusal(404, "Not found.");
  } catch (error) {
    if (error instanceof Refusal) return reply({ error: error.message }, error.status);
    console.error("app api:", error);
    return reply({ error: "Something went wrong on our side." }, 500);
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 20_000) throw new Refusal(413, "That is too long.");
  try {
    const value = JSON.parse(text || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Falls through to the refusal.
  }
  throw new Refusal(400, "That was not valid JSON.");
}

// Who is signed in -----------------------------------------------------------

async function me(sql: Sql, user: SignedInUser) {
  const who = { email: user.email, name: user.name };
  let org = await organizationOf(sql, user.id);
  if (!org) {
    // An address nobody has confirmed could be anyone's, so it is never matched against the list.
    // The session copy in the cookie can be up to five minutes old, so a "no" is checked with the database.
    if (!user.emailVerified) {
      const [row] = await sql`select "emailVerified" as verified from neon_auth."user" where id = ${user.id}`;
      if (row?.verified !== true) return { user: who, approved: false, reason: "unverified" };
    }
    org = await joinOrganization(sql, user.email, user.id);
    if (!org) return { user: who, approved: false, reason: "not_approved" };
  }
  const sites = await sql`
    select s.id, s.name, s.origin, s.created_at,
      exists (select 1 from site_origins o where o.site_id = s.id and o.origin = any(s.allowed_origins)) as connected
    from sites s where s.company_id = ${org.id} order by s.created_at`;
  return { user: who, approved: true, organization: org, sites };
}

// Sites ----------------------------------------------------------------------

interface SiteRow {
  id: string;
  name: string;
  origin: string;
  allowed_origins: string[];
  context: SiteContext;
  reading: Reading | null;
  created_at: string;
}

async function ownedSite(sql: Sql, org: Organization, id: string): Promise<SiteRow> {
  const rows = (await sql`select id, name, origin, allowed_origins, context, reading, created_at from sites where id = ${id} and company_id = ${org.id}`) as SiteRow[];
  if (!rows[0]) throw new Refusal(404, "No such site.");
  return rows[0];
}

/** An address someone pasted, as a URL Haptic can read, or a refusal that says what is wrong with it. */
function siteAddress(input: unknown): URL {
  let text = typeof input === "string" ? input.trim() : "";
  if (!text) throw new Refusal(400, "Paste your site's address.");
  // With no scheme, a local or private address is a developer's own machine, which serves plain http. Anything else gets https.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `${/^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(text) ? "http" : "https"}://${text}`;
  if (!URL.canParse(text)) throw new Refusal(400, "That isn't a web address. Try something like https://app.example.com.");
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Refusal(400, "Use an address that starts with https://.");
  if (!url.hostname.includes(".") && url.hostname !== "localhost") throw new Refusal(400, "That address is missing its domain, like .com.");
  url.hash = "";
  return url;
}

/** A list of origins, each checked to be exactly an origin, such as https://staging.example.com. */
function originList(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Refusal(400, "allowedOrigins must be a list.");
  const origins = new Set<string>();
  for (const item of input) {
    const text = typeof item === "string" ? item.trim().replace(/\/$/, "") : "";
    if (!URL.canParse(text) || new URL(text).origin !== text || !/^https?:$/.test(new URL(text).protocol)) {
      throw new Refusal(400, `"${String(item).slice(0, 80)}" isn't an origin. An origin is the start of an address only, like https://app.example.com.`);
    }
    origins.add(text);
  }
  if (origins.size > MAX_ORIGINS) throw new Refusal(400, `A site can list at most ${MAX_ORIGINS} origins.`);
  return [...origins];
}

async function addSite(sql: Sql, org: Organization, input: Record<string, unknown>) {
  const url = siteAddress(input.url);
  const [{ count } = { count: 0 }] = (await sql`select count(*)::int as count from sites where company_id = ${org.id}`) as { count: number }[];
  if (count >= MAX_SITES) throw new Refusal(400, `A company can have up to ${MAX_SITES} sites for now. Write to us if you need more.`);
  const id = `site_${[...crypto.getRandomValues(new Uint8Array(6))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const now = new Date().toISOString();
  const context: SiteContext = {
    version: 1,
    id,
    name: org.name,
    origin: url.origin,
    allowedOrigins: [url.origin],
    appearance: DEFAULT_APPEARANCE,
    notes: "",
    docs: [],
    pages: [],
    source: { url: url.href, maxPages: MAX_PAGES, docs: [] },
    createdAt: now,
    updatedAt: now,
  };
  await sql`
    insert into sites (id, company_id, name, origin, allowed_origins, context, reading)
    values (${id}, ${org.id}, ${org.name}, ${url.origin}, ${[url.origin]}, ${JSON.stringify(context)}::jsonb, ${JSON.stringify(startReading(url.href))}::jsonb)`;
  return { id, name: org.name, origin: url.origin };
}

function readingSummary(reading: Reading | null, pages: PageNode[]) {
  if (!reading) return null;
  return {
    read: pages.length,
    max: reading.max,
    done: Boolean(reading.finishedAt),
    failed: reading.failed.length,
    thin: reading.thin.length,
    via: reading.via ?? null,
    pages: pages.slice(0, 60).map((page) => ({ path: page.path, title: page.title, controls: pageControls(page) })),
    ...readingExtras(reading, pages),
  };
}

async function siteStatus(sql: Sql, env: AppEnv, org: Organization, id: string) {
  const site = await ownedSite(sql, org, id);
  // Whether an origin is allowed is read from the list as it stands now, not from what it was when
  // the script last called, so allowing an address shows at once. Anyone can send a request with a
  // made-up Origin header, so only the few refused origins seen most recently are shown.
  const seen = (await sql`
    select origin, first_seen_at, last_seen_at, requests from site_origins where site_id = ${id} order by last_seen_at desc`) as Omit<SeenOrigin, "allowed">[];
  const all = seen.map((row) => ({ ...row, allowed: site.allowed_origins.includes(row.origin) }));
  const origins = [...all.filter((row) => row.allowed), ...all.filter((row) => !row.allowed).slice(0, MAX_REFUSED_SHOWN)];
  const widget = (env.WIDGET_URL ?? "https://widget.joinhaptic.com").replace(/\/$/, "");
  return {
    id: site.id,
    name: site.name,
    origin: site.origin,
    allowedOrigins: site.allowed_origins,
    createdAt: site.created_at,
    scriptUrl: `${widget}/widget.js`,
    // Connected means the script has called from an origin the site allows. Seen but refused is the other common failure.
    connected: origins.some((row) => row.allowed),
    origins,
    corrections: site.context.corrections ?? [],
    blocked: site.context.blocked ?? [],
    reading: readingSummary(site.reading, site.context.pages ?? []),
    setup: setupOf(site.context),
    appearance: { ...DEFAULT_APPEARANCE, ...site.context.appearance },
    notes: site.context.notes ?? "",
    docs: docsSummary(site.context.docs ?? []),
  };
}

/** The docs as the settings page lists them: no text, and whether each one is in the prompt. */
function docsSummary(docs: Doc[]) {
  const fit = docsThatFit(docs);
  const used = docs.filter((doc) => fit.has(doc.source)).reduce((sum, doc) => sum + doc.text.length, 0);
  return {
    budget: DOCS_BUDGET,
    used,
    list: docs.map((doc) => ({
      title: doc.title,
      source: doc.source,
      pasted: doc.source.startsWith("pasted:"),
      chars: doc.text.length,
      inPrompt: fit.has(doc.source),
    })),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_NOTES = 20_000;

/** The widget's look, checked field by field. Anything not given keeps its value. */
function appearanceFrom(input: unknown, current: Appearance): Appearance {
  if (!input || typeof input !== "object") throw new Refusal(400, "appearance must be an object.");
  const raw = input as Record<string, unknown>;
  const next = { ...current };
  if (raw.accent !== undefined) {
    if (typeof raw.accent !== "string" || !HEX.test(raw.accent)) throw new Refusal(400, "The colour must be a hex value like #1E6EF4.");
    next.accent = raw.accent.toUpperCase();
  }
  if (raw.position !== undefined) {
    if (raw.position !== "bottom-right" && raw.position !== "bottom-left") throw new Refusal(400, "The corner must be bottom-right or bottom-left.");
    next.position = raw.position;
  }
  if (raw.launcherLabel !== undefined) {
    const label = typeof raw.launcherLabel === "string" ? cleanText(raw.launcherLabel, 24) : "";
    if (!label) throw new Refusal(400, "Give the button a label, such as Ask.");
    next.launcherLabel = label;
  }
  return next;
}

/** Adds a help doc, from its address or pasted in. Fetching a page takes a few seconds. */
async function addDoc(sql: Sql, env: AppEnv, org: Organization, id: string, input: Record<string, unknown>) {
  const site = await ownedSite(sql, org, id);
  const docs = site.context.docs ?? [];
  if (docs.length >= MAX_DOCS) throw new Refusal(400, `A site can have up to ${MAX_DOCS} help docs. Remove one first.`);
  let doc: Doc;
  if (typeof input.url === "string" && input.url.trim()) {
    let text = input.url.trim();
    if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
    if (!URL.canParse(text)) throw new Refusal(400, "That isn't a web address.");
    try {
      doc = await docFromUrl(new URL(text));
    } catch (error) {
      throw new Refusal(400, `Haptic couldn't read that page. ${(error as Error).message}`);
    }
  } else {
    const title = typeof input.title === "string" ? input.title : "";
    const text = typeof input.text === "string" ? input.text : "";
    if (!title.trim() || !text.trim()) throw new Refusal(400, "Give the doc a title and some text.");
    doc = pastedDoc(title, text.slice(0, MAX_DOC_CHARS * 2));
  }
  if (doc.text.length < 40) throw new Refusal(400, "There was almost no text there. Paste the text instead.");
  if (doc.text.length > MAX_DOC_CHARS) throw new Refusal(400, `That doc is ${doc.text.length.toLocaleString()} characters. One doc can be up to ${MAX_DOC_CHARS.toLocaleString()}. Split it, or paste the part that matters.`);
  if (docs.some((existing) => existing.source === doc.source)) throw new Refusal(400, "That page is already one of the help docs.");
  await sql`
    update sites set context = jsonb_set(context, '{docs}', coalesce(context->'docs', '[]'::jsonb) || ${JSON.stringify([doc])}::jsonb), updated_at = now()
    where id = ${id} and company_id = ${org.id}`;
  return siteStatus(sql, env, org, id);
}

async function removeDoc(sql: Sql, env: AppEnv, org: Organization, id: string, source: string) {
  const site = await ownedSite(sql, org, id);
  const docs = (site.context.docs ?? []).filter((doc) => doc.source !== source);
  await sql`update sites set context = jsonb_set(context, '{docs}', ${JSON.stringify(docs)}::jsonb), updated_at = now() where id = ${id} and company_id = ${org.id}`;
  return siteStatus(sql, env, org, id);
}

/**
 * Deletes a site and everything recorded on it: its guides, steps and the
 * origins it was seen on. The caller types the site's address to confirm.
 */
async function deleteSite(sql: Sql, org: Organization, id: string, input: Record<string, unknown>) {
  const site = await ownedSite(sql, org, id);
  const host = new URL(site.origin).host;
  if (typeof input.confirm !== "string" || input.confirm.trim().toLowerCase() !== host.toLowerCase()) {
    throw new Refusal(400, `Type ${host} to confirm.`);
  }
  await sql`delete from sites where id = ${id} and company_id = ${org.id}`;
  return { deleted: id };
}

async function changeSite(sql: Sql, env: AppEnv, org: Organization, id: string, input: Record<string, unknown>) {
  const site = await ownedSite(sql, org, id);
  const name = input.name === undefined ? site.name : typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : null;
  if (!name) throw new Refusal(400, "Give the site a name.");
  const origins = input.allowedOrigins === undefined ? site.allowed_origins : originList(input.allowedOrigins);
  if (!origins.length) throw new Refusal(400, "Keep at least one origin, or the widget can't run anywhere.");
  const appearance = input.appearance === undefined ? null : appearanceFrom(input.appearance, { ...DEFAULT_APPEARANCE, ...site.context.appearance });
  if (input.notes !== undefined && typeof input.notes !== "string") throw new Refusal(400, "notes must be text.");
  const notes = typeof input.notes === "string" ? input.notes.trim() : null;
  if (notes !== null && notes.length > MAX_NOTES) throw new Refusal(400, `Notes can be up to ${MAX_NOTES.toLocaleString()} characters.`);
  // Only the fields given change, inside the context too, so a page read finishing meanwhile keeps its pages.
  await sql`
    update sites set name = ${name}, allowed_origins = ${origins},
      context = jsonb_set(jsonb_set(context, '{appearance}', coalesce(${appearance === null ? null : JSON.stringify(appearance)}::jsonb, context->'appearance', '{}'::jsonb)),
        '{notes}', coalesce(to_jsonb(${notes}::text), context->'notes', '""'::jsonb)),
      updated_at = now()
    where id = ${id} and company_id = ${org.id}`;
  // The widget server keeps its copy of a site for up to a minute, so a newly allowed address starts working within that.
  return siteStatus(sql, env, org, id);
}

async function readSite(sql: Sql, env: AppEnv, org: Organization, id: string, restart: boolean) {
  const site = await ownedSite(sql, org, id);
  const pages = site.context.pages ?? [];
  // A reading that ended with nothing read may be tried again. One that read anything is kept as it is.
  const reading = restart && site.reading?.finishedAt && !pages.length ? startReading(site.context.source.url) : site.reading;
  if (!reading || reading.finishedAt) return readingSummary(reading, pages);
  const batch = await readMore(reading, env.BROWSER);
  const byPath = new Map(pages.map((page) => [page.path, page]));
  for (const page of batch.pages) byPath.set(page.path, page);
  const merged = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  // The address pasted may be the site's other name, acme.com for www.acme.com. The widget will run on the
  // one it redirects to, so that becomes the site's origin and is allowed too.
  const moved = batch.movedTo ?? null;
  // Only the pages, the reading and that origin change, so an edit to the name or origins made meanwhile is kept.
  await sql`
    update sites set
      context = jsonb_set(jsonb_set(context, '{pages}', ${JSON.stringify(merged)}::jsonb), '{updatedAt}', to_jsonb(now()::text)),
      reading = ${JSON.stringify(batch.reading)}::jsonb,
      origin = coalesce(${moved}::text, origin),
      allowed_origins = case
        when ${moved}::text is null or ${moved}::text = any(allowed_origins) or cardinality(allowed_origins) >= ${MAX_ORIGINS} then allowed_origins
        else array_append(allowed_origins, ${moved}::text) end,
      updated_at = now()
    where id = ${id} and company_id = ${org.id}`;
  return readingSummary(batch.reading, merged);
}

// Approving access requests ---------------------------------------------------

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The link in the team's email that approves one access request. Anyone holding it can approve that request, and only that one. */
export async function approveLink(env: AppEnv, siteOrigin: string, key: string): Promise<string | undefined> {
  if (!env.APPROVE_SECRET) return undefined;
  const params = new URLSearchParams({ key, sig: await hmac(env.APPROVE_SECRET, `approve ${key}`) });
  return `${siteOrigin}/approve/?${params}`;
}

async function checkedRequest(env: AppEnv, key: unknown, sig: unknown): Promise<{ key: string; entry: AccessRequest }> {
  if (!env.APPROVE_SECRET) throw new Refusal(503, "Approving is not set up on this server.");
  if (typeof key !== "string" || typeof sig !== "string" || key.length > 200) throw new Refusal(400, "That approve link is incomplete.");
  const expected = await hmac(env.APPROVE_SECRET, `approve ${key}`);
  // Compared in full whatever the inputs, so timing says nothing about how much of it matched.
  let diff = expected.length ^ sig.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  if (diff !== 0) throw new Refusal(403, "That approve link isn't valid. Use the one in the request email.");
  const stored = await env.ACCESS_REQUESTS.get(key);
  if (!stored) throw new Refusal(404, "That request is no longer stored.");
  return { key, entry: JSON.parse(stored) as AccessRequest };
}

async function showRequest(env: AppEnv, sql: Sql, url: URL) {
  const { entry } = await checkedRequest(env, url.searchParams.get("key"), url.searchParams.get("sig"));
  const domain = emailDomain(entry.email);
  const rows = await sql`select email, domain from approvals where email = ${entry.email} or domain = ${domain}`;
  return {
    name: `${entry.firstName} ${entry.lastName}`.trim(),
    email: entry.email,
    company: entry.company,
    details: entry.details,
    domain,
    // A free mailbox's domain is shared by millions of strangers. It can never be approved as a whole.
    domainAllowed: !isPersonalEmail(entry.email),
    approved: { email: rows.some((row) => row.email === entry.email), domain: rows.some((row) => row.domain === domain) },
  };
}

async function approve(request: Request, env: AppEnv, sql: Sql, url: URL) {
  const input = await body(request);
  const { key, entry } = await checkedRequest(env, input.key, input.sig);
  const scope = input.scope === "domain" ? "domain" : "email";
  if (scope === "domain" && isPersonalEmail(entry.email)) throw new Refusal(400, `${emailDomain(entry.email)} is a free mailbox, so it can't be approved as a whole domain.`);
  const company = entry.company.slice(0, 200);
  if (scope === "domain") {
    // If people at this domain were approved one by one and already share exactly one organization,
    // the domain takes it on, so the next person joins that company and does not start a second.
    const domain = emailDomain(entry.email);
    await sql`
      insert into approvals (domain, company, request_key, organization_id)
      values (${domain}, ${company}, ${key}, (
        select case when count(distinct organization_id) = 1 then min(organization_id::text)::uuid end
        from approvals where split_part(email, '@', 2) = ${domain} and organization_id is not null))
      on conflict (domain) do update set organization_id = coalesce(approvals.organization_id, excluded.organization_id)`;
  } else {
    await sql`insert into approvals (email, company, request_key) values (${entry.email}, ${company}, ${key}) on conflict (email) do nothing`;
  }
  // The sign-in link is their invitation. If it expires, they ask for another on the sign-in page.
  const sent = await sendSignInLink(env, url.origin, entry.email, `${url.origin}/dashboard/`);
  return { ok: true, scope, sent, email: entry.email };
}
