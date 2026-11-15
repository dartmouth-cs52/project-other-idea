import { build, type BuildOptions } from "esbuild";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Bundles the widget into the one file the script tag loads.

const root = fileURLToPath(new URL("../..", import.meta.url));
export const WIDGET_FILE = `${root}dist/widget.js`;
/** The same file under a name the Worker's bundler brings in as a string. */
export const WIDGET_TEXT_FILE = `${root}dist/widget.txt`;

const OPTIONS: BuildOptions = {
  entryPoints: [`${root}src/widget/index.ts`],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
};

export async function buildWidget(): Promise<number> {
  const result = await build({ ...OPTIONS, outfile: WIDGET_FILE, metafile: true });
  await copyFile(WIDGET_FILE, WIDGET_TEXT_FILE);
  return Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
}

/** The same bundle as text, without touching dist/. For tools that put the widget into a page themselves. */
export async function bundleWidget(): Promise<string> {
  const result = await build({ ...OPTIONS, write: false });
  return result.outputFiles[0]?.text ?? "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Built dist/widget.js (${((await buildWidget()) / 1024).toFixed(1)} KB)`);
}
