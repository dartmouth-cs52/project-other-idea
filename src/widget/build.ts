import { build, type BuildOptions, type Plugin } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Bundles the widget into the two files the server serves. widget.js is what
// the script tag loads on every page. widget-act.js is the code that acts
// ("Do it with me"), loaded by widget.js only on a site with acting on
// (src/widget/acting-code.ts). The second file brings none of the first
// file's code: its imports of the modules below are answered by what the
// first file hands it as it loads, so the two share one copy of each.

const root = fileURLToPath(new URL("../..", import.meta.url));
export const WIDGET_FILE = `${root}dist/widget.js`;
/** The same file under a name the Worker's bundler brings in as a string. */
export const WIDGET_TEXT_FILE = `${root}dist/widget.txt`;
export const ACTING_FILE = `${root}dist/widget-act.js`;
export const ACTING_TEXT_FILE = `${root}dist/widget-act.txt`;

/** The modules the second file takes from the first, by path, and the name the first file hands each over by (`sharedModules`). */
const SHARED: Record<string, string> = {
  "src/shared/types.ts": "types",
  "src/widget/observe.ts": "observe",
  "src/widget/popups.ts": "popups",
  "src/widget/says.ts": "says",
  "src/widget/snapshot.ts": "snapshot",
};
/** Modules only the second file may hold. One of them in the first file would load the acting code on every page. */
const ACTING_ONLY = ["src/widget/act.ts", "src/widget/gate.ts", "src/shared/act-rules.ts"];

/** Points the second file's imports of the shared modules at what the first file hands over. */
const fromFirstFile: Plugin = {
  name: "haptic-shared",
  setup(builder) {
    builder.onResolve({ filter: /\.ts$/ }, (args) => {
      const name = SHARED[relative(root, resolve(args.resolveDir, args.path)).split("\\").join("/")];
      return name ? { path: name, namespace: "haptic-shared" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "haptic-shared" }, (args) => ({
      contents: `module.exports = globalThis[Symbol.for("haptic.acting.shared")][${JSON.stringify(args.path)}];`,
      loader: "js",
    }));
  },
};

/** The build both files are made from: a hash of the widget's sources, so a first file never takes a second file of another build. */
async function buildId(): Promise<string> {
  const hash = createHash("sha256");
  for (const dir of ["src/widget", "src/shared"]) {
    for (const name of (await readdir(`${root}${dir}`)).filter((file) => file.endsWith(".ts")).sort()) hash.update(`${dir}/${name}\n`).update(await readFile(`${root}${dir}/${name}`));
  }
  return hash.digest("hex").slice(0, 12);
}

async function options(minify: boolean): Promise<{ widget: BuildOptions; acting: BuildOptions }> {
  const common: BuildOptions = { bundle: true, format: "iife", target: "es2020", minify, legalComments: "none", define: { __HAPTIC_BUILD__: JSON.stringify(await buildId()) }, metafile: true };
  return {
    widget: { ...common, entryPoints: [`${root}src/widget/index.ts`] },
    acting: { ...common, entryPoints: [`${root}src/widget/acting.ts`], plugins: [fromFirstFile] },
  };
}

/** Fails the build when the first file holds acting code, or the second file a copy of a module it should take from the first. */
function checkSplit(widget: { metafile?: { inputs: Record<string, unknown> } }, acting: { metafile?: { inputs: Record<string, unknown> } }) {
  const inputs = (result: { metafile?: { inputs: Record<string, unknown> } }) => Object.keys(result.metafile?.inputs ?? {}).map((path) => relative(root, resolve(root, path)).split("\\").join("/"));
  const leaked = inputs(widget).filter((path) => ACTING_ONLY.includes(path));
  if (leaked.length) throw new Error(`widget.js holds acting code: ${leaked.join(", ")}. Reach it through src/widget/acting-code.ts.`);
  const copied = inputs(acting).filter((path) => path in SHARED);
  if (copied.length) throw new Error(`widget-act.js holds its own copy of ${copied.join(", ")}.`);
}

/** Both files as text, without touching dist/. For tools that put the widget into a page themselves. `minify: false` keeps them readable. */
export async function widgetBundles({ minify = true }: { minify?: boolean } = {}): Promise<{ widget: string; acting: string }> {
  const built = await options(minify);
  const [widget, acting] = await Promise.all([build({ ...built.widget, write: false }), build({ ...built.acting, write: false })]);
  checkSplit(widget, acting);
  return { widget: widget.outputFiles[0]?.text ?? "", acting: acting.outputFiles[0]?.text ?? "" };
}

/** widget.js as text. */
export async function bundleWidget(): Promise<string> {
  return (await widgetBundles()).widget;
}

/** widget-act.js as text. */
export async function bundleActing(): Promise<string> {
  return (await widgetBundles()).acting;
}

/** Writes both files to dist/, with the copies the Worker brings in as strings, and gives their sizes. */
export async function buildWidget(): Promise<{ widget: number; acting: number; widgetGzip: number; actingGzip: number }> {
  const built = await options(true);
  const [widget, acting] = await Promise.all([build({ ...built.widget, outfile: WIDGET_FILE }), build({ ...built.acting, outfile: ACTING_FILE })]);
  checkSplit(widget, acting);
  await Promise.all([copyFile(WIDGET_FILE, WIDGET_TEXT_FILE), copyFile(ACTING_FILE, ACTING_TEXT_FILE)]);
  const gzipped = async (file: string) => gzipSync(await readFile(file), { level: 6 }).length;
  return {
    widget: Object.values(widget.metafile?.outputs ?? {})[0]?.bytes ?? 0,
    acting: Object.values(acting.metafile?.outputs ?? {})[0]?.bytes ?? 0,
    widgetGzip: await gzipped(WIDGET_FILE),
    actingGzip: await gzipped(ACTING_FILE),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sizes = await buildWidget();
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log(`Built dist/widget.js (${kb(sizes.widget)}, ${kb(sizes.widgetGzip)} gzipped), loaded on every page`);
  console.log(`Built dist/widget-act.js (${kb(sizes.acting)}, ${kb(sizes.actingGzip)} gzipped), loaded only where acting is on`);
}
