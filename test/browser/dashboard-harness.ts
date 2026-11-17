import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { siteBrand } from "../../web/worker/brand.ts";
import { groupGuides } from "../../web/worker/health.ts";
import { finishedGuides, guideSteps, headline, insights, live, sitesOverview } from "../../web/worker/insights.ts";
import { checkSuggestions, SuggestionsRefused, usableSuggestions } from "../../src/shared/suggestions.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "../psql.ts";

// The dashboard as it ships, in a real browser: the pages `next build` wrote to
// web/out, served as the Worker serves them, with every number read from a real
// Postgres by the Worker's own queries. A test writes a question and its steps
// to the database the way the widget server does, and watches the open page.
//
// What is real: the built pages, their styles and scripts, the router, and the
// queries behind /insights, /metrics, /live, /sites, /guides, /groups,
// /finished and /brand. What is stood in for: sign-in (everyone is signed in,
// to COMPANY unless a tab is opened as another company, and what the sign-in
// page sends is kept, so nothing is emailed and nobody is sent to Google), and
// the site's own record, which is kept here in a few lines and not by
// worker/app-api.ts, since that needs Neon's HTTP driver and Neon Auth. Its
// suggested questions are checked by the same code app-api.ts checks them with.
//
//   cd web && npm run build && cd ..
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/haptic_test npm run test:browser
//   CHROMIUM_PATH=/path/to/chrome ...      when Playwright's own build isn't installed
//
// Without the build or the database the suite is skipped, and says which is missing.

const root = fileURLToPath(new URL("../..", import.meta.url));
const OUT = `${root}web/out`;

export const HAS_BUILD = existsSync(`${OUT}/dashboard/index.html`);
/** Why the suite can't run here, or false when it can. */
export const SKIP: string | false = !TEST_DATABASE_URL ? "set TEST_DATABASE_URL to a local, empty database to run these" : !HAS_BUILD ? "build the site first: cd web && npm run build" : false;

export const COMPANY = "11111111-1111-4111-8111-111111111111";
/** The site whose script is running, with questions on it. */
export const SITE = "site_dash_run01";
/** A second site, added and still waiting for its script. */
export const WAITING = "site_dash_wait1";
/** A company with one site, whose script is running, with the same fortnight of questions as SITE. */
export const ONE_SITE_COMPANY = "22222222-2222-4222-8222-222222222222";
export const ONE_SITE = "site_dash_one01";
/** A company with one site, part way through the setup screens, on adding the script. */
export const SETTING_UP_COMPANY = "33333333-3333-4333-8333-333333333333";
export const SETTING_UP = "site_dash_setup";
/** A company that hasn't added a site yet. */
export const NO_SITE_COMPANY = "44444444-4444-4444-8444-444444444444";
/** The colour the fixture site calls its own, in its stylesheet. */
export const BRAND = "#17633A";

type Sql = Parameters<typeof live>[0];

export interface Dashboard {
  /** Where the dashboard is served. */
  url: string;
  /** The address of the fixture site the running site points at. */
  siteOrigin: string;
  /** Every call the page made to /api/app, in order. */
  calls: { method: string; path: string }[];
  /** Every call the page made to /api/auth, in order, with what it sent. */
  auth: { method: string; path: string; body: Record<string, any> }[];
  browser: Browser;
  /** A new tab on a page of the dashboard, signed in to `company`, waited for until it has drawn. */
  open(path?: string, size?: { width: number; height: number }, company?: string): Promise<Page>;
  /** A visitor asks something: the row the widget server writes when a question arrives. Returns the guide's id. */
  ask(question: string, path?: string): string;
  /** Haptic answers a step: the row for it, and the guide moved on. */
  step(guide: string, n: number, label: string, said: string, path?: string): void;
  /** The guide ends. */
  end(guide: string, outcome?: string): void;
  /** Nothing has happened on the guide for this long. */
  quietFor(guide: string, interval: string): void;
  /** The site's record, as the stand-in holds it. */
  site(id?: string): Promise<Record<string, any>>;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain" };
const quoted = (text: string) => `'${text.replace(/'/g, "''")}'`;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, any>> {
  let text = "";
  for await (const chunk of request) text += chunk;
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

/** A customer's site, as far as the dashboard reads it: a first page that names an icon and a stylesheet, and a stylesheet that names its colour. */
function fixtureSite(): Server {
  return createServer((request, response) => {
    const send = (type: string, body: string) => (response.writeHead(200, { "content-type": type }), response.end(body));
    if (request.url === "/") return send("text/html", `<!doctype html><html><head><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css"><title>Northpine</title></head><body><h1>Northpine</h1></body></html>`);
    if (request.url === "/site.css") return send("text/css", `:root{--np-ink:#18201c;--np-brand:${BRAND.toLowerCase()};--np-brand-ink:#ffffff;--np-brand-soft:#e5f2ea}`);
    if (request.url === "/icon.svg") return send("image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#14532d"/></svg>`);
    response.writeHead(404);
    response.end();
  });
}

/** A fortnight of questions on the running site, the newest two hours old, so nothing seeded reads as under way. */
function seed(db: string, siteOrigin: string) {
  // The running site has Do it with me on, so a suggested question there can be one Haptic does. The waiting one has it off.
  const context = (id: string, name: string, origin: string, more: Record<string, unknown> = {}) =>
    JSON.stringify({ version: 1, id, name, origin, allowedOrigins: [origin], appearance: { accent: "#1E6EF4", position: "bottom-right", launcherLabel: "Ask" }, notes: "", docs: [], pages: [], corrections: [], blocked: [], ...more });
  const flows: [string, [string, string, string][], string | null][] = [
    ["How do I issue a new card?", [["/", "Cards", "Open Cards."], ["/cards", "Issue card", "Press Issue card."], ["/cards/new", "Create card", "Press Create card."]], "finished"],
    ["Where do I add a receipt?", [["/", "Expenses", "Open Expenses."], ["/expenses", "Add receipt", "Press Add receipt."]], "finished"],
    ["How do I connect Slack?", [["/", "Settings", "Open Settings."]], "nothing_to_point_at"],
    ["How do I submit a mileage claim?", [["/expenses", "Reimbursements", "Mileage is under Reimbursements."]], null],
    ["What is the per diem rate?", [["/", "", "Per diem is 68 dollars a day."]], "answered"],
  ];
  const guides: string[] = [];
  const steps: string[] = [];
  let n = 0;
  for (let day = 13; day >= 0; day--) {
    for (let at = 0; at < 3; at++) {
      const [question, path, outcome] = flows[(day * 3 + at) % flows.length]!;
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const started = `now() - interval '${day} days ${2 + at} hours'`;
      const key = question.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      guides.push(`('${id}', '${SITE}', ${quoted(question)}, ${quoted(key)}, ${quoted(path[0]![0])}, ${started}, ${outcome ? `${started} + interval '40 seconds'` : "null"}, ${outcome ? `'${outcome}'` : "null"}, ${started} + interval '30 seconds', ${path.length}, 'visitor${n % 7}')`);
      path.forEach(([route, label, said], step) =>
        steps.push(`('${id}', ${step}, ${quoted(route)}, ${label ? "'button'" : "null"}, ${label ? quoted(label) : "null"}, ${quoted(said)}, '${outcome === "finished" && step === path.length - 1 ? "done" : "continue"}', 2000, 1700, 'test')`),
      );
    }
  }
  exec(
    db,
    `insert into sites (id, company_id, name, origin, allowed_origins, context, created_at) values
      ('${WAITING}', '${COMPANY}', 'Northpine', 'https://staging.northpine.example', '{https://staging.northpine.example}', ${quoted(context(WAITING, "Northpine", "https://staging.northpine.example"))}, now() - interval '30 days'),
      ('${SITE}', '${COMPANY}', 'Northpine', ${quoted(siteOrigin)}, '{${siteOrigin}}', ${quoted(context(SITE, "Northpine", siteOrigin, { acting: { enabled: true } }))}, now() - interval '20 days');
    insert into site_origins (site_id, origin, allowed, requests) values ('${SITE}', ${quoted(siteOrigin)}, true, 40);
    insert into guides (id, site_id, question, question_key, started_path, started_at, ended_at, outcome, last_step_at, step_count, visitor) values ${guides.join(",\n")};
    insert into steps (guide_id, n, path, target_role, target_label, said, status, ms, ms_to_target, model) values ${steps.join(",\n")};
    insert into sites (id, company_id, name, origin, allowed_origins, context, created_at) values
      ('${ONE_SITE}', '${ONE_SITE_COMPANY}', 'Northpine', ${quoted(siteOrigin)}, '{${siteOrigin}}', ${quoted(context(ONE_SITE, "Northpine", siteOrigin))}, now() - interval '20 days'),
      ('${SETTING_UP}', '${SETTING_UP_COMPANY}', 'Northpine', 'https://app.northpine.example', '{https://app.northpine.example}', ${quoted(context(SETTING_UP, "Northpine", "https://app.northpine.example", { setup: { step: "install" } }))}, now() - interval '1 day');
    insert into site_origins (site_id, origin, allowed, requests) values ('${ONE_SITE}', ${quoted(siteOrigin)}, true, 40);
    insert into guides (id, site_id, question, question_key, started_path, started_at, ended_at, outcome, last_step_at, step_count, visitor)
      select gen_random_uuid(), '${ONE_SITE}', question, question_key, started_path, started_at, ended_at, outcome, last_step_at, step_count, visitor from guides where site_id = '${SITE}';`,
  );
}

export async function startDashboard(): Promise<Dashboard> {
  const db = testDatabase("dashboard");
  freshDatabase(db);
  const sql = psqlSql(db) as unknown as Sql;
  const fixture = fixtureSite();
  const siteOrigin = await listen(fixture);
  seed(db, siteOrigin);
  const calls: Dashboard["calls"] = [];
  const auth: Dashboard["auth"] = [];
  let made = 100;

  /** A site as worker/app-api.ts answers for one, from its row. */
  async function siteStatus(id: string, company = COMPANY): Promise<Record<string, any> | null> {
    const [row] = (await sql`select id, name, origin, allowed_origins, context from sites where id = ${id} and company_id = ${company}`) as Record<string, any>[];
    if (!row) return null;
    const origins = (await sql`select origin, first_seen_at, last_seen_at, requests from site_origins where site_id = ${id}`) as Record<string, any>[];
    const seen = origins.map((origin) => ({ ...origin, allowed: row.allowed_origins.includes(origin.origin) }));
    return {
      id: row.id,
      name: row.name,
      origin: row.origin,
      allowedOrigins: row.allowed_origins,
      scriptUrl: "https://widget.joinhaptic.com/widget.js",
      connected: seen.some((origin) => origin.allowed),
      origins: seen,
      corrections: [],
      blocked: [],
      reading: null,
      // Where the setup screens are, kept in the context as worker/setup-api.ts keeps it. Most seeded sites were
      // set up before there were setup screens, so they have none, and the dashboard keeps them.
      setup: row.context.setup ?? null,
      appearance: row.context.appearance,
      notes: row.context.notes ?? "",
      docs: { budget: 60000, used: 0, list: [] },
      answers: { on: false, chosen: null },
      suggestions: usableSuggestions(row.context.suggestions),
      acting: row.context.acting?.enabled === true,
    };
  }

  async function api(method: string, url: URL, request: IncomingMessage, company: string): Promise<[number, unknown]> {
    const path = url.pathname.replace(/\/$/, "");
    const days = Number(url.searchParams.get("days")) || 30;
    if (path === "/api/app/me") {
      const sites = (await sitesOverview(sql, company)).sites.map(({ id, name, origin, connected }) => ({ id, name, origin, connected }));
      return [200, { user: { email: "ada@northpine.example", name: "Ada Lovelace" }, approved: true, organization: { id: company, name: "Northpine", role: "owner" }, sites }];
    }
    if (path === "/api/app/sites" && method === "GET") return [200, await sitesOverview(sql, company, Number(url.searchParams.get("tz")) || 0)];
    const match = /^\/api\/app\/sites\/([^/]+)(?:\/([a-z-]+))?(?:\/([^/]+))?$/.exec(path);
    if (!match) return [404, { error: "Not found." }];
    const [, id = "", sub, rest] = match;
    const site = await siteStatus(id, company);
    if (!site) return [404, { error: "No such site." }];
    if (!sub && method === "GET") return [200, site];
    if (!sub && method === "PATCH") {
      const input = await bodyOf(request);
      if (typeof input.name === "string" && input.name.trim()) await sql`update sites set name = ${input.name.trim()} where id = ${id}`;
      if (input.appearance) {
        const next = { ...site.appearance, ...input.appearance };
        if (input.appearance.launcher === null) delete next.launcher;
        await sql`update sites set context = jsonb_set(context, '{appearance}', ${JSON.stringify(next)}::jsonb) where id = ${id}`;
      }
      if (input.suggestions !== undefined) {
        let suggestions;
        try {
          suggestions = checkSuggestions(input.suggestions);
        } catch (error) {
          if (!(error instanceof SuggestionsRefused)) throw error;
          return [400, { error: error.message, field: error.index === undefined ? "suggestions" : `suggestions.${error.index}` }];
        }
        await sql`update sites set context = jsonb_set(context, '{suggestions}', ${JSON.stringify(suggestions)}::jsonb) where id = ${id}`;
      }
      return [200, await siteStatus(id, company)];
    }
    if (!sub && method === "DELETE") {
      await sql`delete from sites where id = ${id}`;
      return [200, { deleted: id }];
    }
    if (sub === "insights") return [200, await insights(sql, id, days)];
    if (sub === "metrics") return [200, await headline(sql, id, days)];
    if (sub === "live") return [200, await live(sql, id)];
    if (sub === "brand") return [200, await siteBrand(site.origin)];
    if (sub === "guides" && rest) {
      const guide = await guideSteps(sql, id, rest);
      return guide ? [200, guide] : [404, { error: "No such guide." }];
    }
    if (sub === "groups") return [200, { guides: await groupGuides(sql, id, url.searchParams.get("key") ?? "", new Date(Date.now() - days * 86_400_000).toISOString()) }];
    if (sub === "finished") return [200, await finishedGuides(sql, id, url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7))];
    if (sub === "controls") return [200, { controls: [] }];
    if (sub === "read") return [200, null];
    return [404, { error: "Not found." }];
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown) => (response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }), response.end(JSON.stringify(body)));
    if (url.pathname.startsWith("/api/auth")) {
      // Kept, and answered as signed in: no email goes out, and Google is never asked.
      auth.push({ method: request.method ?? "GET", path: url.pathname, body: await bodyOf(request) });
      return json(200, { session: { id: "s", userId: "u", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, user: { id: "u", email: "ada@northpine.example", name: "Ada Lovelace", emailVerified: true } });
    }
    if (url.pathname.startsWith("/api/")) {
      calls.push({ method: request.method ?? "GET", path: url.pathname.replace(/\/$/, "") });
      // The company the tab was opened as, which `open` keeps in a cookie.
      const company = /(?:^|;\s*)company=([^;]+)/.exec(request.headers.cookie ?? "")?.[1] ?? COMPANY;
      try {
        return json(...(await api(request.method ?? "GET", url, request, company)));
      } catch (error) {
        return json(500, { error: (error as Error).message });
      }
    }
    // The built pages, as the Worker serves them: a folder's index.html for an address that ends in a slash.
    const wanted = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(OUT, wanted.endsWith("/") ? `${wanted}index.html` : wanted);
    if (!file.startsWith(OUT) || !existsSync(file)) return (response.writeHead(404), response.end("Not found"));
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  const url = await listen(server);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  return {
    url,
    siteOrigin,
    calls,
    auth,
    browser,
    async open(path = `/dashboard/?site=${SITE}`, size = { width: 1440, height: 900 }, company = COMPANY) {
      const context = await browser.newContext({ viewport: size });
      await context.addCookies([{ name: "company", value: company, url }]);
      const tab = await context.newPage();
      await tab.goto(`${url}${path}`);
      await tab.locator("header").first().waitFor();
      return tab;
    },
    ask(question, path = "/") {
      const id = `00000000-0000-4000-9000-${String(++made).padStart(12, "0")}`;
      exec(db, `insert into guides (id, site_id, question, question_key, started_path, origin, last_step_at, step_count, visitor) values ('${id}', '${SITE}', ${quoted(question)}, ${quoted(question.toLowerCase().replace(/[^a-z0-9 ]/g, ""))}, ${quoted(path)}, ${quoted(siteOrigin)}, now(), 0, 'asker${made}')`);
      return id;
    },
    step(guide, n, label, said, path = "/") {
      exec(
        db,
        `insert into steps (guide_id, n, path, target_role, target_label, said, status, ms, ms_to_target, model) values ('${guide}', ${n}, ${quoted(path)}, 'button', ${quoted(label)}, ${quoted(said)}, 'continue', 2000, 1700, 'test');
        update guides set last_step_at = now(), step_count = ${n + 1} where id = '${guide}';`,
      );
    },
    end(guide, outcome = "finished") {
      exec(db, `update guides set outcome = '${outcome}', ended_at = now() where id = '${guide}'`);
    },
    quietFor(guide, interval) {
      exec(db, `update guides set last_step_at = now() - interval '${interval}', started_at = least(started_at, now() - interval '${interval}') where id = '${guide}'`);
    },
    async site(id = SITE) {
      return (await siteStatus(id)) ?? {};
    },
    async close() {
      await browser.close();
      await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => fixture.close(resolve))]);
    },
  };
}
