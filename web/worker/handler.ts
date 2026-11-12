// What the Worker does for every request, whichever way the site's files are
// supplied: one address for the site, the request access form, and the static pages.

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
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

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

/** Trims one field of the form to a sensible length. Anything that is not text counts as empty. */
function field(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Saves what the request access form sends, then emails the team a copy.
 * It keeps the name, work email, company and details the person typed, and nothing else about them.
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
  if (field(body.fax, 200)) return json({ ok: true }, 200);

  const email = field(body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
  const entry = {
    email,
    company: field(body.company, 200),
    firstName: field(body.firstName, 100),
    lastName: field(body.lastName, 100),
    details: field(body.details, 2000),
    at: new Date().toISOString(),
  };

  await env.ACCESS_REQUESTS.put(`${entry.at} ${crypto.randomUUID()}`, JSON.stringify(entry));
  await notify(env, entry);
  return json({ ok: true }, 200);
}

/** Emails the team a copy of a request. The request is already saved, so a failed email never fails the form. */
async function notify(env: Env, entry: { email: string; company: string; firstName: string; lastName: string; details: string; at: string }): Promise<void> {
  if (!env.EMAIL || !env.NOTIFY_TO) return;
  const name = `${entry.firstName} ${entry.lastName}`.trim();
  // A subject is one line, so drop anything that could start a new one.
  const who = (entry.company || name || entry.email).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);
  try {
    const sent = await env.EMAIL.send({
      to: env.NOTIFY_TO,
      from: { email: `requests@${SITE}`, name: "Haptic requests" },
      // Replying to the email answers the person who asked.
      replyTo: entry.email,
      subject: `Access request from ${who}`,
      text: [
        `Name: ${name || "Not given"}`,
        `Work email: ${entry.email}`,
        `Company: ${entry.company || "Not given"}`,
        "",
        "Details:",
        entry.details || "None",
        "",
        `Sent from the request access form on ${SITE} at ${entry.at}.`,
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
