// The install steps a coding agent follows, at /install/<site>.md. The prompt
// the dashboard's "Onboard your agent" pill copies points here, so the steps
// can improve without changing what people paste.
//
// It needs no sign-in and no database. A site id is public, because it is in
// the tag, and the file says nothing else about the site. An id no site has
// still gets the steps: the widget then says in the console that no site has it.

import { installPlaybook } from "../lib/install";

const PLAYBOOK = /^\/install\/(site_[a-z0-9_]{3,40})\.md$/;

/** True for an address this file answers, so the Worker hands it over before the static pages. */
export function isPlaybookPath(pathname: string): boolean {
  return pathname.startsWith("/install/") && pathname.endsWith(".md");
}

export function playbook(request: Request, env: { WIDGET_URL?: string }, url: URL): Response {
  const headers = new Headers({
    "content-type": "text/markdown; charset=utf-8",
    // Agents fetch it from anywhere, and it holds nothing private.
    "access-control-allow-origin": "*",
    "x-robots-tag": "noindex",
  });
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("allow", "GET, HEAD");
    return new Response("Use GET.\n", { status: 405, headers });
  }
  const id = PLAYBOOK.exec(url.pathname)?.[1];
  if (!id) {
    headers.set("cache-control", "no-store");
    return new Response("# Not found\n\nThis install link is incomplete. Copy the prompt again from the Haptic dashboard.\n", { status: 404, headers });
  }
  const widget = (env.WIDGET_URL ?? "https://widget.joinhaptic.com").replace(/\/$/, "");
  headers.set("cache-control", "public, max-age=300");
  return new Response(request.method === "HEAD" ? null : installPlaybook(`${widget}/widget.js`, id), { status: 200, headers });
}
