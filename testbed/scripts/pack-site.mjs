// Packs the built app in dist/ into worker/site.generated.json, so the Worker in
// worker/index.js can serve it without a separate upload of the files. See
// wrangler.jsonc for when to use it.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const TARGET = new URL("../worker/site.generated.json", import.meta.url).pathname;

const TEXT = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = {};
let bytes = 0;
for (const path of walk(DIST)) {
  const key = relative(DIST, path).split("\\").join("/");
  const content = readFileSync(path);
  bytes += content.length;
  const type = TEXT[extname(path)];
  files[key] = type ? { type, text: content.toString("utf8") } : { type: "application/octet-stream", base64: content.toString("base64") };
}

writeFileSync(TARGET, JSON.stringify(files));
console.log(`Packed ${Object.keys(files).length} files (${(bytes / 1024).toFixed(0)} KB) into worker/site.generated.json`);
