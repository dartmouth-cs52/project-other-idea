// A second entry for the same Worker, with the site's files packed inside it.
//
// Wrangler normally uploads the files in `out/` separately. That upload fails
// from machines whose network layer rewrites the Authorization header, such as
// a Claude cloud session. Packing the files into the Worker avoids the separate
// upload. It suits a small site: a Worker may be at most 3 MB compressed.
//
// `site.generated.json` is written by `scripts/embed-site.mjs` after a build.

import { handle, type Assets, type Env } from "./handler";
import files from "./site.generated.json";

type Packed = { type: string; text?: string; base64?: string };
const site = files as Record<string, Packed>;
const decoded = new Map<string, Uint8Array>();

function body(key: string, file: Packed): string | Uint8Array {
  if (file.text !== undefined) return file.text;
  let bytes = decoded.get(key);
  if (!bytes) {
    bytes = Uint8Array.from(atob(file.base64 ?? ""), (char) => char.charCodeAt(0));
    decoded.set(key, bytes);
  }
  return bytes;
}

/** Serves a packed file the way Cloudflare serves a folder of static files. */
const assets: Assets = {
  fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed.", { status: 405 });

    const path = decodeURIComponent(url.pathname);
    let key = path.slice(1) + (path.endsWith("/") ? "index.html" : "");
    // A page asked for without its trailing slash is sent to the address with one.
    if (!site[key] && !path.endsWith("/") && site[`${key}/index.html`]) {
      url.pathname = `${path}/`;
      return Response.redirect(url.toString(), 307);
    }
    let status = 200;
    if (!site[key]) {
      key = "404.html";
      status = 404;
    }
    const file = site[key];
    if (!file) return new Response("Not found.", { status: 404 });

    const headers = {
      "content-type": file.type,
      // Next gives its scripts, styles and fonts a new name whenever they change, so those can be kept forever.
      "cache-control": key.startsWith("_next/static/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    };
    return new Response(request.method === "HEAD" ? null : body(key, file), { status, headers });
  },
};

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, assets);
  },
};

export default worker;
