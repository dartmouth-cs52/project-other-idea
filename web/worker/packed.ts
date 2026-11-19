// The site's files packed inside the Worker (worker/embedded.ts), served the way
// Cloudflare serves a folder of static files. Kept apart from embedded.ts, which
// needs the file `scripts/embed-site.mjs` writes after a build, so this can be
// tested without one.

import type { Assets } from "./handler";

export type Packed = { type: string; text?: string; base64?: string };

/** A path as its file is named, or null for one with a stray %, such as /%E0%A4%A, which names no file. */
function decoded(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/** Serves packed files the way Cloudflare serves a folder of static files. */
export function packedAssets(site: Record<string, Packed>): Assets {
  const bytes = new Map<string, Uint8Array<ArrayBuffer>>();
  const body = (key: string, file: Packed): string | Uint8Array<ArrayBuffer> => {
    if (file.text !== undefined) return file.text;
    let held = bytes.get(key);
    if (!held) {
      held = Uint8Array.from(atob(file.base64 ?? ""), (char) => char.charCodeAt(0));
      bytes.set(key, held);
    }
    return held;
  };
  return {
    fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed.", { status: 405 });

      // A path that can't be decoded is answered as any other that names no file, with the 404 page.
      const path = decoded(url.pathname);
      let key = path === null ? "" : path.slice(1) + (path.endsWith("/") ? "index.html" : "");
      // A page asked for without its trailing slash is sent to the address with one.
      if (path !== null && !site[key] && !path.endsWith("/") && site[`${key}/index.html`]) {
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
}
