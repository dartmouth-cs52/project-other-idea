// What the Worker does for every request, whichever way the site's files are
// supplied: one address for the site, the request access form, and the static pages.

import { checkRequest, cleanRequest, emailDomain, isPersonalEmail, type AccessField, type AccessRequest } from "../lib/access-request";
import { appApi, approveLink, type AppEnv, type Later } from "./app-api";
import { billingSweep, stripeWebhook, WEBHOOK_PATH } from "./billing";
import { proxyAuth } from "./auth";
import { boundedRequest, boundedText } from "./body";
import { database, forgetOldNetworkDays } from "./db";
import { sendHealthAlerts } from "./health";
import { forgetOldSignInEmails, HOOK_PATH, neonHook, type HookEnv } from "./neon-hook";
import { forgetOldEmails } from "./setup-api";
import { isPlaybookPath, playbook } from "./playbook";
import { forgetOldTeaching } from "./teach";

export interface Assets {
  fetch(request: Request): Promise<Response> | Response;
}

export interface Env extends AppEnv, HookEnv {
  ASSETS?: Assets;
  /** Emails the team a copy of each request. Cloudflare only lets it send to an inbox verified under Email Routing. */
  EMAIL?: {
    send(message: { to: string; from: { email: string; name: string }; replyTo: string; subject: string; text: string }): Promise<{ messageId: string }>;
  };
  /** The inbox that gets the copy. Kept as a secret on the Worker, so the address is not in the code. */
  NOTIFY_TO?: string;
  /** Slows down anyone hammering the form. */
  FORM_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Slows down anyone hammering sign-in, which can send an email on each try. */
  AUTH_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const SITE = "joinhaptic.com";

/**
 * The most of a body anything under /api/ reads, in bytes. The largest bodies sent here are a pasted help doc
 * (DOC_BODY in app-api.ts, at most 732,000 bytes) and Stripe's webhook (billing.ts, 1,000,000 characters).
 */
const MAX_BODY = 1_000_000;
/** The most Neon's sign-in proxy reads. Signing in sends an address and where to come back to. */
const MAX_AUTH_BODY = 16 * 1024;

/** The Worker's schedules, in wrangler.jsonc: billing every hour, and the rest once a day. Runs apart from any request. */
export async function onSchedule(cron: string, env: Env): Promise<void> {
  if (cron === HOURLY) {
    await billingSweep(env).catch((error: Error) => console.error("Billing sweep failed:", error.message));
    return;
  }
  await daily(env);
}

/** The hourly schedule in wrangler.jsonc. Any other is the daily one. */
export const HOURLY = "17 * * * *";

/** Once a day. */
export async function daily(env: Env): Promise<void> {
  if (!env.DATABASE_URL) return;
  try {
    const sent = await sendHealthAlerts(database(env.DATABASE_URL), env);
    console.log(`Guide health: ${sent} emails sent.`);
  } catch (error) {
    console.error("Guide health check failed:", error);
  }
  // Each install email sent deletes the records older than a day. This catches a site that sends no more.
  await forgetOldEmails(database(env.DATABASE_URL)).catch((error: Error) => console.error("Could not delete old install email records:", error.message));
  // The same for sign-in emails, on a day nobody asks for one.
  await forgetOldSignInEmails(database(env.DATABASE_URL)).catch((error: Error) => console.error("Could not delete old sign-in email records:", error.message));
  // Teach sessions nobody saved, a week on, and any steps a saved or closed one still holds.
  await forgetOldTeaching(database(env.DATABASE_URL)).catch((error: Error) => console.error("Could not delete old teach sessions:", error.message));
  // What each network taught a site, or had answered from routes, on the days before today.
  await forgetOldNetworkDays(database(env.DATABASE_URL)).catch((error: Error) => console.error("Could not delete old network counts:", error.message));
}

/**
 * Sent with every answer, the static pages and /api/ alike: HTTPS only, no guessing at a file's type, no more
 * than our origin in the Referer other sites see, no camera, microphone or location, and no page of ours in
 * another site's frame, where a signed-in dashboard could be clicked on unseen. Nothing frames joinhaptic.com.
 * A Content-Security-Policy that limits scripts as well would need a hash for each script Next writes into a
 * page, and would have to let widget.joinhaptic.com in, so for now it says only who may frame a page.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/** The answer with SECURITY_HEADERS added. A header the answer already has is its own choice, and is kept. */
export function secured(response: Response): Response {
  // Copied first: the headers of a redirect, or of a file Cloudflare serves, can't be changed in place.
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(name)) out.headers.set(name, value);
  return out;
}

/** `later` finishes work after the answer has gone: the request's waitUntil on Cloudflare. */
export async function handle(request: Request, env: Env, assets: Assets, later?: Later): Promise<Response> {
  return secured(await route(request, env, assets, later));
}

async function route(request: Request, env: Env, assets: Assets, later?: Later): Promise<Response> {
  const url = new URL(request.url);

  // One address for the site: www goes to the bare domain, and plain http goes to https.
  const www = url.hostname === `www.${SITE}`;
  if (www || (url.hostname === SITE && url.protocol === "http:")) {
    url.hostname = SITE;
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  // Everything under /api/ is answered here, as JSON. Whatever goes wrong in it, the caller gets JSON back,
  // never the runtime's own error page.
  if (url.pathname.startsWith("/api/")) {
    // No body is read past its limit by anything under /api/. Most routes hold theirs to less, but Neon's
    // sign-in proxy and Stripe's webhook would read whatever was sent, before anyone signed in.
    const held = boundedRequest(request, url.pathname.startsWith("/api/auth/") ? MAX_AUTH_BODY : MAX_BODY);
    if (!held) return json({ error: "That is too long." }, 413);
    try {
      return await api(held.request, env, url, later);
    } catch (error) {
      if (held.cut()) return json({ error: "That is too long." }, 413);
      console.error(`${request.method} ${url.pathname} failed:`, error);
      return json({ error: "Something went wrong on our side." }, 500);
    }
  }
  // The install steps a coding agent fetches, /install/<site>.md. The install page itself is static.
  if (isPlaybookPath(url.pathname)) return playbook(request, env, url);

  const response = await assets.fetch(request);
  // Anything that is not the real domain is a preview, and search engines should skip it.
  if (url.hostname !== SITE) {
    const preview = new Response(response.body, response);
    preview.headers.set("X-Robots-Tag", "noindex");
    return preview;
  }
  return response;
}

/** The routes under /api/. Nothing static lives there, so a path none of them knows is answered here too. */
async function api(request: Request, env: Env, url: URL, later?: Later): Promise<Response> {
  if (url.pathname === "/api/request-access") return requestAccess(request, env, url);
  // Stripe, telling us a subscription or an invoice changed. Signed by Stripe, and checked in billing.ts.
  if (url.pathname === WEBHOOK_PATH) return stripeWebhook(request, env);
  // Neon Auth hands us each sign-in link to email. Signed by Neon, so it needs no rate limit of its own.
  if (url.pathname === HOOK_PATH) return neonHook(request, env);
  if (url.pathname.startsWith("/api/auth/")) {
    // Signing in can send an email, and Neon sees every caller as this Worker, so the limit has to be kept here.
    // Checking who is signed in is a GET and is not counted.
    if (request.method !== "GET" && env.AUTH_LIMIT && !(await env.AUTH_LIMIT.limit({ key: callerOf(request) })).success) {
      return json({ message: "Too many tries. Wait a minute and try again.", code: "TOO_MANY_REQUESTS" }, 429);
    }
    return proxyAuth(request, env);
  }
  if (url.pathname.startsWith("/api/app/")) return appApi(request, env, url, later);
  return json({ error: "Not found." }, 404);
}

/**
 * Saves what the request access form sends, then emails the team a copy.
 * It keeps the name, work email, company and details the person typed, and nothing else about them.
 * An entry with a missing field, or an email address that cannot receive mail, is turned away.
 */
async function requestAccess(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  // The form only posts from our own pages. A browser sends "null" from a sandboxed frame, a page saved to disk
  // or under some privacy settings, which is no page of ours, and neither is anything else that isn't an address.
  const origin = request.headers.get("origin");
  if (origin && !(URL.canParse(origin) && new URL(origin).host === url.host)) return json({ error: "Not allowed from this site." }, 403);

  // Each request sends an email, so one address only gets a few tries a minute.
  if (env.FORM_LIMIT && !(await env.FORM_LIMIT.limit({ key: callerOf(request) })).success) {
    return json({ error: "Too many requests. Try again in a minute." }, 429);
  }

  const raw = await boundedText(request, 8000);
  if (raw === null) return json({ error: "That is too long." }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "That was not valid JSON." }, 400);
  }

  // People never see the fax field, so anything in it came from a program. Say thanks and keep nothing.
  if (typeof body.fax === "string" && body.fax.trim()) return json({ ok: true }, 200);

  // The same rules the page applies, applied again here, because a request can be sent without the page.
  const entry = cleanRequest(body);
  const errors = checkRequest(entry);
  const first = (Object.keys(errors) as AccessField[])[0];
  if (first) return json({ error: errors[first], field: first }, 400);
  if (!(await takesMail(emailDomain(entry.email)))) {
    return json({ error: "That email address cannot receive mail. Check the part after the @.", field: "email" }, 400);
  }

  const at = new Date().toISOString();
  const key = `${at} ${crypto.randomUUID()}`;
  await env.ACCESS_REQUESTS.put(key, JSON.stringify({ ...entry, at }));
  await notify(env, entry, at, await approveLink(env, url.origin, key));
  return json({ ok: true }, 200);
}

/**
 * Asks DNS whether a domain can receive email, so a mistyped or made up address is caught before it is saved.
 * If the lookup itself fails, the address is let through, so a DNS hiccup never costs a real request.
 */
async function takesMail(domain: string): Promise<boolean> {
  const lookup = async (type: "MX" | "A" | "AAAA") => {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`DNS lookup answered ${response.status}`);
    return (await response.json()) as { Status: number; Answer?: { type: number; data: string }[] };
  };
  try {
    const mx = await lookup("MX");
    // 3 means the domain does not exist.
    if (mx.Status === 3) return false;
    const servers = (mx.Answer ?? []).filter((answer) => answer.type === 15);
    // A lone "0 ." is how a domain says it takes no mail at all.
    if (servers.length > 0) return !servers.every((answer) => /^\d+\s+\.$/.test(answer.data.trim()));
    // With no mail servers listed, mail goes to the domain's own address, if it has one.
    for (const [type, code] of [["A", 1], ["AAAA", 28]] as const) {
      if (((await lookup(type)).Answer ?? []).some((answer) => answer.type === code)) return true;
    }
    return false;
  } catch (error) {
    console.error("Could not check the email domain, so it was let through.", (error as Error).message);
    return true;
  }
}

/** Emails the team a copy of a request. The request is already saved, so a failed email never fails the form. */
async function notify(env: Env, entry: AccessRequest, at: string, approve?: string): Promise<void> {
  if (!env.EMAIL || !env.NOTIFY_TO) return;
  const name = `${entry.firstName} ${entry.lastName}`;
  // A subject is one line, so drop anything that could start a new one.
  const who = entry.company.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);
  try {
    const sent = await env.EMAIL.send({
      to: env.NOTIFY_TO,
      from: { email: `requests@${SITE}`, name: "Haptic requests" },
      // Replying to the email answers the person who asked.
      replyTo: entry.email,
      subject: `Access request from ${who}`,
      text: [
        `Name: ${name}`,
        `Work email: ${entry.email}${isPersonalEmail(entry.email) ? " (a personal mailbox, not a company address)" : ""}`,
        `Company: ${entry.company}`,
        "",
        "Details:",
        entry.details || "None",
        "",
        ...(approve
          ? ["To let them in, open this link and choose their address or their whole domain. Haptic then emails them a sign-in link:", approve, ""]
          : []),
        `Sent from the request access form on ${SITE} at ${at}.`,
        "Reply to this email to answer them.",
      ].join("\n"),
    });
    console.log("Emailed a copy of the request.", sent.messageId);
  } catch (error) {
    console.error("The request was saved, but the email copy failed.", (error as { code?: string }).code, (error as Error).message);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/**
 * Who a rate limit counts a request against: its address, or for IPv6 the /64 it is in. A home, an office or
 * a server is usually given a whole /64, so counting each IPv6 address on its own would give one caller more
 * tries than could ever be used up.
 */
export function callerOf(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return ip.includes(":") ? (network64(ip) ?? ip) : ip;
}

/** The /64 an IPv6 address is in, written one way however the address was, or undefined for anything that isn't one. */
function network64(ip: string): string | undefined {
  // An IPv4 address written as IPv6 is that IPv4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const halves = ip.split("::");
  if (halves.length > 2) return undefined;
  const parts = halves.map((half) => (half ? half.split(":") : []));
  // An IPv4 address at the end fills the last two of the eight groups.
  const written = parts.flat().reduce((sum, group) => sum + (group.includes(".") ? 2 : 1), 0);
  // "::" stands for one group of zeros or more.
  const left = 8 - written;
  if (halves.length === 1 ? left !== 0 : left < 1) return undefined;
  const groups = halves.length === 1 ? parts[0]! : [...parts[0]!, ...Array<string>(left).fill("0"), ...parts[1]!];
  const network = groups.slice(0, 4);
  if (!network.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  return `${network.map((group) => parseInt(group, 16).toString(16)).join(":")}::/64`;
}
