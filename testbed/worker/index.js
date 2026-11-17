// Serves Northpine from files packed inside the Worker by scripts/pack-site.mjs.
//
// Wrangler normally uploads the files in dist/ separately. That upload fails from
// machines whose network layer rewrites the Authorization header, such as a
// Claude cloud session, so the files travel inside the Worker instead.

import site from "./site.generated.json";

const decoded = new Map();

function body(key, file) {
  if (file.text !== undefined) return file.text;
  let bytes = decoded.get(key);
  if (!bytes) {
    bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
    decoded.set(key, bytes);
  }
  return bytes;
}

export default {
  fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed.", { status: 405 });
    const path = decodeURIComponent(new URL(request.url).pathname);
    let key = path.slice(1);
    // A single-page app: any address that is not a file gets the app, which picks the page.
    if (!site[key]) key = "index.html";
    const file = site[key];
    const headers = {
      "content-type": file.type,
      // Vite names each script and style after its contents, so those can be kept forever.
      "cache-control": key.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
      // Northpine is a made-up product, so search engines should skip it.
      "x-robots-tag": "noindex",
    };
    return new Response(request.method === "HEAD" ? null : body(key, file), { headers });
  },
};
