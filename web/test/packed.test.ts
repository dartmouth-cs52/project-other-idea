import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "../worker/handler";
import { packedAssets } from "../worker/packed";

// The site's files packed inside the Worker, as `npm run deploy:embedded` ships
// them, served the way Cloudflare serves a folder of them. A handful of files
// stands in for a build.

const assets = packedAssets({
  "index.html": { type: "text/html; charset=utf-8", text: "<h1>Haptic</h1>" },
  "pricing/index.html": { type: "text/html; charset=utf-8", text: "<h1>Pricing</h1>" },
  "404.html": { type: "text/html; charset=utf-8", text: "<h1>Not found</h1>" },
  "_next/static/app.js": { type: "text/javascript; charset=utf-8", text: "console.log(1)" },
  "icon.png": { type: "image/png", base64: btoa("\x89PNG") },
});
const env = { ACCESS_REQUESTS: { put: async () => {}, get: async () => null } };
const get = (path: string, method = "GET") => handle(new Request(`https://joinhaptic.com${path}`, { method }), env, assets);

test("a page, a script and an image are served as Cloudflare serves them, and a page without its slash is sent to it", async () => {
  const page = await get("/pricing/");
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "<h1>Pricing</h1>");
  assert.equal(page.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  const script = await get("/_next/static/app.js");
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(script.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.deepEqual(new Uint8Array(await (await get("/icon.png")).arrayBuffer()), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  const bare = await get("/pricing");
  assert.equal(bare.status, 307);
  assert.equal(bare.headers.get("location"), "https://joinhaptic.com/pricing/");
  assert.equal((await get("/", "POST")).status, 405);
});

test("an address with a stray %, which can't be decoded, gets the 404 page like any address that names no file", async () => {
  for (const path of ["/%E0%A4%A", "/%", "/pricing/%zz", "/%E0%A4%A/"]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), "<h1>Not found</h1>", path);
    assert.equal(response.headers.get("x-frame-options"), "DENY", `${path}: with the headers every answer has`);
  }
  assert.equal((await get("/nothing-here/")).status, 404);
  assert.equal(await (await get("/%70ricing/")).text(), "<h1>Pricing</h1>", "an address that decodes is still found");
});
