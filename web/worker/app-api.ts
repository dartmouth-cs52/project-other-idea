// What the signed-in part of joinhaptic.com asks the Worker for, under /api/app/.
//
//   GET    /api/app/me                          who is signed in, and their company; makes the company on first sign-in
//   POST   /api/app/sites                       add a site from its address, and start reading its public pages
//   GET    /api/app/sites/:id                   a site, its install health and how far the reading has got
//   PATCH  /api/app/sites/:id                   change its name or the origins it may run on
//   POST   /api/app/sites/:id/read              read a few more public pages
//   GET    /api/app/sites/:id/insights          the dashboard: questions, outcomes, what to fix
//   GET    /api/app/sites/:id/guides/:guide     one guide, step by step
//   GET    /api/app/approve?key=…&sig=…         an access request, for the team's approve page
//   POST   /api/app/approve                     approve it, and email the person a sign-in link
//
// Every site is looked up together with the caller's organization, so a site
// id, which is public, is never enough to read or change someone's data.

import { DEFAULT_APPEARANCE, type PageNode, type SiteContext } from "../../src/shared/types";
import { isPersonalEmail, emailDomain, type AccessRequest } from "../lib/access-request";
import { currentUser, sendSignInLink, type AuthEnv, type SignedInUser } from "./auth";
import { approvalFor, database, joinOrganization, organizationOf, type Organization, type Sql } from "./db";
import { insights, guideSteps } from "./insights";
import { MAX_PAGES, readMore, startReading, type BrowserBinding, type Reading } from "./reader";

export interface AppEnv extends AuthEnv {
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

    const match = /^\/sites\/([^/]+)(\/read|\/insights|\/guides\/([^/]+))?$/.exec(path);
    if (match) {
      const id = match[1] ?? "";
      if (!SITE_ID.test(id)) throw new Refusal(404, "No such site.");
      const sub = match[2];
      if (!sub && request.method === "GET") return reply(await siteStatus(sql, env, org, id));
      if (!sub && request.method === "PATCH") return reply(await changeSite(sql, env, org, id, await body(request)));
      if (sub === "/read" && request.method === "POST") return reply(await readSite(sql, env, org, id));
      if (sub === "/insights" && request.method === "GET") {
        await ownedSite(sql, org, id);
        const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
        return reply(await insights(sql, id, days));
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
    const approval = await approvalFor(sql, user.email);
    if (!approval) return { user: who, approved: false, reason: "not_approved" };
    org = await joinOrganization(sql, approval, user.id);
  }
  const sites = await sql`
    select s.id, s.name, s.origin, s.created_at,
      exists (select 1 from site_origins o where o.site_id = s.id and o.allowed) as connected
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
  const [{ count }] = (await sql`select count(*)::int as count from sites where company_id = ${org.id}`) as { count: number }[];
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
    pages: pages.slice(0, 60).map((page) => ({ path: page.path, title: page.title })),
  };
}

async function siteStatus(sql: Sql, env: AppEnv, org: Organization, id: string) {
  const site = await ownedSite(sql, org, id);
  const origins = await sql`
    select origin, allowed, first_seen_at, last_seen_at, requests from site_origins where site_id = ${id} order by allowed desc, last_seen_at desc`;
  const widget = (env.WIDGET_URL ?? "https://widget.joinhaptic.com").replace(/\/$/, "");
  return {
    id: site.id,
    name: site.name,
    origin: site.origin,
    allowedOrigins: site.allowed_origins,
    createdAt: site.created_at,
    scriptUrl: `${widget}/widget.js`,
    tag: `<script src="${widget}/widget.js" data-site="${site.id}" async></script>`,
    // Connected means the script has called from an origin the site allows. Seen but refused is the other common failure.
    connected: origins.some((row) => row.allowed),
    origins,
    reading: readingSummary(site.reading, site.context.pages ?? []),
  };
}

async function changeSite(sql: Sql, env: AppEnv, org: Organization, id: string, input: Record<string, unknown>) {
  const site = await ownedSite(sql, org, id);
  const name = input.name === undefined ? site.name : typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : null;
  if (!name) throw new Refusal(400, "Give the site a name.");
  const origins = input.allowedOrigins === undefined ? site.allowed_origins : originList(input.allowedOrigins);
  if (!origins.length) throw new Refusal(400, "Keep at least one origin, or the widget can't run anywhere.");
  await sql`update sites set name = ${name}, allowed_origins = ${origins}, updated_at = now() where id = ${id} and company_id = ${org.id}`;
  // Origins seen before and refused may be allowed now. The next request from each one updates its row.
  return siteStatus(sql, env, org, id);
}

async function readSite(sql: Sql, env: AppEnv, org: Organization, id: string) {
  const site = await ownedSite(sql, org, id);
  const pages = site.context.pages ?? [];
  if (!site.reading || site.reading.finishedAt) return readingSummary(site.reading, pages);
  const batch = await readMore(site.reading, env.BROWSER);
  const byPath = new Map(pages.map((page) => [page.path, page]));
  for (const page of batch.pages) byPath.set(page.path, page);
  const merged = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  // Only the pages and the reading change, so an edit to the name or origins made meanwhile is kept.
  await sql`
    update sites set
      context = jsonb_set(jsonb_set(context, '{pages}', ${JSON.stringify(merged)}::jsonb), '{updatedAt}', to_jsonb(now()::text)),
      reading = ${JSON.stringify(batch.reading)}::jsonb, updated_at = now()
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
    await sql`insert into approvals (domain, company, request_key) values (${emailDomain(entry.email)}, ${company}, ${key}) on conflict (domain) do nothing`;
  } else {
    await sql`insert into approvals (email, company, request_key) values (${entry.email}, ${company}, ${key}) on conflict (email) do nothing`;
  }
  // The sign-in link is their invitation. If it expires, they ask for another on the sign-in page.
  const sent = await sendSignInLink(env, url.origin, entry.email, `${url.origin}/dashboard/`);
  return { ok: true, scope, sent, email: entry.email };
}
