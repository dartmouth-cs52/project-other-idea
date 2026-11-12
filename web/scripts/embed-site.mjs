// Packs the built site in out/ into worker/site.generated.json, so the Worker
// in worker/embedded.ts can serve it without a separate upload of the files.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const OUT = new URL("../out/", import.meta.url).pathname;
const TARGET = new URL("../worker/site.generated.json", import.meta.url).pathname;

const TEXT = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".xml": "application/xml",
  ".map": "application/json",
};
const BINARY = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = {};
let bytes = 0;
for (const path of walk(OUT)) {
  const key = relative(OUT, path).split("\\").join("/");
  const ext = extname(path);
  const content = readFileSync(path);
  bytes += content.length;
  if (TEXT[ext]) files[key] = { type: TEXT[ext], text: content.toString("utf8") };
  else files[key] = { type: BINARY[ext] ?? "application/octet-stream", base64: content.toString("base64") };
}

writeFileSync(TARGET, JSON.stringify(files));
console.log(`Packed ${Object.keys(files).length} files (${(bytes / 1024).toFixed(0)} KB) into worker/site.generated.json`);
