// The Worker in front of the site on Cloudflare. It serves the static pages
// from `out/` and answers the contact form.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ACCESS_REQUESTS: { put(key: string, value: string): Promise<void> };
}

const SITE = "joinhaptic.com";
const TOPICS = new Set(["access", "sales", "other"]);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // One address for the site: www goes to the bare domain.
    if (url.hostname === `www.${SITE}`) {
      url.hostname = SITE;
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/request-access") return requestAccess(request, env, url);

    const response = await env.ASSETS.fetch(request);
    // Anything that is not the real domain is a preview, and search engines should skip it.
    if (url.hostname !== SITE) {
      const preview = new Response(response.body, response);
      preview.headers.set("X-Robots-Tag", "noindex");
      return preview;
    }
    return response;
  },
};

export default worker;

/** Saves what the contact form sends: an email address, a company name and a topic. Nothing else is kept. */
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
  const topic = typeof body.topic === "string" && TOPICS.has(body.topic) ? body.topic : "access";
  if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);

  const at = new Date().toISOString();
  await env.ACCESS_REQUESTS.put(`${at} ${crypto.randomUUID()}`, JSON.stringify({ email, company, topic, at }));
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
