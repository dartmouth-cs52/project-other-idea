// What the Worker does for every request, whichever way the site's files are
// supplied: one address for the site, the request access form, and the static pages.

import { checkRequest, cleanRequest, emailDomain, isPersonalEmail, type AccessField, type AccessRequest } from "../lib/access-request";

export interface Assets {
  fetch(request: Request): Promise<Response> | Response;
}

export interface Env {
  ASSETS?: Assets;
  ACCESS_REQUESTS: { put(key: string, value: string): Promise<void> };
  /** Emails the team a copy of each request. Cloudflare only lets it send to an inbox verified under Email Routing. */
  EMAIL?: {
    send(message: { to: string; from: { email: string; name: string }; replyTo: string; subject: string; text: string }): Promise<{ messageId: string }>;
  };
  /** The inbox that gets the copy. Kept as a secret on the Worker, so the address is not in the code. */
  NOTIFY_TO?: string;
  /** Slows down anyone hammering the form. */
  FORM_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const SITE = "joinhaptic.com";

export async function handle(request: Request, env: Env, assets: Assets): Promise<Response> {
  const url = new URL(request.url);

  // One address for the site: www goes to the bare domain, and plain http goes to https.
  const www = url.hostname === `www.${SITE}`;
  if (www || (url.hostname === SITE && url.protocol === "http:")) {
    url.hostname = SITE;
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  if (url.pathname === "/api/request-access") return requestAccess(request, env, url);

  const response = await assets.fetch(request);
  // Anything that is not the real domain is a preview, and search engines should skip it.
  if (url.hostname !== SITE) {
    const preview = new Response(response.body, response);
    preview.headers.set("X-Robots-Tag", "noindex");
    return preview;
  }
  return response;
}

/**
 * Saves what the request access form sends, then emails the team a copy.
 * It keeps the name, work email, company and details the person typed, and nothing else about them.
 * An entry with a missing field, or an email address that cannot receive mail, is turned away.
 */
async function requestAccess(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  // The form only posts from our own pages.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return json({ error: "Not allowed from this site." }, 403);

  // Each request sends an email, so one address only gets a few tries a minute.
  const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.FORM_LIMIT && !(await env.FORM_LIMIT.limit({ key: caller })).success) {
    return json({ error: "Too many requests. Try again in a minute." }, 429);
  }

  const raw = await request.text();
  if (raw.length > 8000) return json({ error: "That is too long." }, 413);
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
  await env.ACCESS_REQUESTS.put(`${at} ${crypto.randomUUID()}`, JSON.stringify({ ...entry, at }));
  await notify(env, entry, at);
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
async function notify(env: Env, entry: AccessRequest, at: string): Promise<void> {
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
