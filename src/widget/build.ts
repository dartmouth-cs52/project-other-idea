import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Bundles the widget into the one file the script tag loads.

const root = fileURLToPath(new URL("../..", import.meta.url));
export const WIDGET_FILE = `${root}dist/widget.js`;
/** The same file under a name the Worker's bundler brings in as a string. */
export const WIDGET_TEXT_FILE = `${root}dist/widget.txt`;

/** The mapper, which the widget fetches only in a tab where someone at the company is mapping their app (src/widget/map.ts). */
export const MAP_FILE = `${root}dist/map.js`;
export const MAP_TEXT_FILE = `${root}dist/map.txt`;

export async function buildWidget(): Promise<number> {
  const bundle = (entry: string, outfile: string) =>
    build({ entryPoints: [`${root}src/widget/${entry}`], outfile, bundle: true, format: "iife", target: "es2020", minify: true, metafile: true, legalComments: "none" });
  const [result] = await Promise.all([bundle("index.ts", WIDGET_FILE), bundle("map-entry.ts", MAP_FILE)]);
  await Promise.all([copyFile(WIDGET_FILE, WIDGET_TEXT_FILE), copyFile(MAP_FILE, MAP_TEXT_FILE)]);
  return Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Built dist/widget.js (${((await buildWidget()) / 1024).toFixed(1)} KB)`);
}
