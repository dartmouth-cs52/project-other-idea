// What the Worker does for every request, whichever way the site's files are
// supplied: one address for the site, the request access form, and the static pages.

export interface Assets {
  fetch(request: Request): Promise<Response> | Response;
}

export interface Env {
  ASSETS?: Assets;
  ACCESS_REQUESTS: { put(key: string, value: string): Promise<void> };
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

/** Saves what the request access form sends: an email address and a company name. Nothing else is kept. */
async function requestAccess(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  // The form only posts from our own pages.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return json({ error: "Not allowed from this site." }, 403);

  const raw = await request.text();
  if (raw.length > 2000) return json({ error: "That is too long." }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "That was not valid JSON." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const company = typeof body.company === "string" ? body.company.trim().slice(0, 200) : "";
  if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);

  const at = new Date().toISOString();
  await env.ACCESS_REQUESTS.put(`${at} ${crypto.randomUUID()}`, JSON.stringify({ email, company, at }));
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
