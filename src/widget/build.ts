import { build, type BuildOptions, type Plugin } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Bundles the widget into the four files the server serves. widget.js is
// what the script tag loads on every page. widget-act.js is the code that acts
// ("Do it with me"), loaded by widget.js only on a site with acting on
// (src/widget/acting-code.ts). widget-teach.js is teach mode, loaded only by a
// tab with a teaching link or a teaching session (src/widget/teach-code.ts).
// Neither of those two brings any of the first file's code: their imports
// of the modules below are answered by what the first file hands each as it
// loads, so they share one copy of each. map.js is the mapper, loaded only in
// a tab where someone at the company is mapping their app
// (src/widget/map-pass.ts). It carries its own copies of what it uses.

const root = fileURLToPath(new URL("../..", import.meta.url));
export const WIDGET_FILE = `${root}dist/widget.js`;
/** The same file under a name the Worker's bundler brings in as a string. */
export const WIDGET_TEXT_FILE = `${root}dist/widget.txt`;
export const ACTING_FILE = `${root}dist/widget-act.js`;
export const ACTING_TEXT_FILE = `${root}dist/widget-act.txt`;
export const TEACH_FILE = `${root}dist/widget-teach.js`;
export const TEACH_TEXT_FILE = `${root}dist/widget-teach.txt`;
/** The mapper, which the widget fetches only in a tab where someone at the company is mapping their app (src/widget/map.ts). */
export const MAP_FILE = `${root}dist/map.js`;
export const MAP_TEXT_FILE = `${root}dist/map.txt`;

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
/** The modules teach mode takes from the first file, and the name the first file hands each over by (`teachModules`). */
const TEACH_SHARED: Record<string, string> = {
  "src/shared/types.ts": "types",
  "src/widget/snapshot.ts": "snapshot",
  "src/widget/ui.ts": "ui",
  "src/widget/teach-notice.ts": "teachNotice",
};
/** Modules only teach mode may hold. One of them in the first file would put teach mode, and the words matching reads questions by, on every page. */
const TEACH_ONLY = ["src/widget/teach.ts", "src/shared/teach.ts", "src/shared/task-match.ts"];
/** Modules only the mapper may hold. It is a file of its own, with its own copies of what it uses, so no visitor's page carries it. */
const MAP_ONLY = ["src/widget/map.ts", "src/widget/guard.ts"];

/** Points a later file's imports of the shared modules at what the first file hands over, under `slot`. */
function fromFirstFile(shared: Record<string, string>, slot: string): Plugin {
  return {
    name: `haptic-shared-${slot}`,
    setup(builder) {
      // Relative imports, with ".ts" or without it: files the website imports too are imported with none.
      builder.onResolve({ filter: /^\.\.?\// }, (args) => {
        const path = resolve(args.resolveDir, args.path);
        const name = shared[relative(root, path.endsWith(".ts") ? path : `${path}.ts`).split("\\").join("/")];
        return name ? { path: name, namespace: "haptic-shared" } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: "haptic-shared" }, (args) => ({
        contents: `module.exports = globalThis[Symbol.for(${JSON.stringify(slot)})][${JSON.stringify(args.path)}];`,
        loader: "js",
      }));
    },
  };
}

/** The build both files are made from: a hash of the widget's sources, so a first file never takes a second file of another build. */
async function buildId(): Promise<string> {
  const hash = createHash("sha256");
  for (const dir of ["src/widget", "src/shared"]) {
    for (const name of (await readdir(`${root}${dir}`)).filter((file) => file.endsWith(".ts")).sort()) hash.update(`${dir}/${name}\n`).update(await readFile(`${root}${dir}/${name}`));
  }
  return hash.digest("hex").slice(0, 12);
}

async function options(minify: boolean): Promise<{ widget: BuildOptions; acting: BuildOptions; teach: BuildOptions; map: BuildOptions }> {
  const common: BuildOptions = { bundle: true, format: "iife", target: "es2020", minify, legalComments: "none", define: { __HAPTIC_BUILD__: JSON.stringify(await buildId()) }, metafile: true };
  return {
    widget: { ...common, entryPoints: [`${root}src/widget/index.ts`] },
    acting: { ...common, entryPoints: [`${root}src/widget/acting.ts`], plugins: [fromFirstFile(SHARED, "haptic.acting.shared")] },
    teach: { ...common, entryPoints: [`${root}src/widget/teaching.ts`], plugins: [fromFirstFile(TEACH_SHARED, "haptic.teach.shared")] },
    map: { ...common, entryPoints: [`${root}src/widget/map-entry.ts`] },
  };
}

type Built = { metafile?: { inputs: Record<string, unknown> } };
const inputsOf = (result: Built) => Object.keys(result.metafile?.inputs ?? {}).map((path) => relative(root, resolve(root, path)).split("\\").join("/"));

/**
 * Fails the build when the first file holds acting code, teach mode or the
 * mapper, or a later file a copy of a module it should take from the first,
 * or teach mode acting code.
 */
function checkSplit(widget: Built, acting: Built, teach: Built) {
  const leaked = inputsOf(widget).filter((path) => ACTING_ONLY.includes(path));
  if (leaked.length) throw new Error(`widget.js holds acting code: ${leaked.join(", ")}. Reach it through src/widget/acting-code.ts.`);
  const teaching = inputsOf(widget).filter((path) => TEACH_ONLY.includes(path));
  if (teaching.length) throw new Error(`widget.js holds teach mode: ${teaching.join(", ")}. Reach it through src/widget/teach-code.ts.`);
  const mapping = inputsOf(widget).filter((path) => MAP_ONLY.includes(path));
  if (mapping.length) throw new Error(`widget.js holds the mapper: ${mapping.join(", ")}. Reach it through src/widget/map-pass.ts.`);
  const copied = inputsOf(acting).filter((path) => path in SHARED);
  if (copied.length) throw new Error(`widget-act.js holds its own copy of ${copied.join(", ")}.`);
  const copiedTeach = inputsOf(teach).filter((path) => path in TEACH_SHARED || ACTING_ONLY.includes(path));
  if (copiedTeach.length) throw new Error(`widget-teach.js holds its own copy of ${copiedTeach.join(", ")}.`);
}

/** Both files as text, without touching dist/. For tools that put the widget into a page themselves. `minify: false` keeps them readable. */
export async function widgetBundles({ minify = true }: { minify?: boolean } = {}): Promise<{ widget: string; acting: string; teach: string }> {
  const built = await options(minify);
  const [widget, acting, teach] = await Promise.all([build({ ...built.widget, write: false }), build({ ...built.acting, write: false }), build({ ...built.teach, write: false })]);
  checkSplit(widget, acting, teach);
  return { widget: widget.outputFiles[0]?.text ?? "", acting: acting.outputFiles[0]?.text ?? "", teach: teach.outputFiles[0]?.text ?? "" };
}

/** widget.js as text. */
export async function bundleWidget(): Promise<string> {
  return (await widgetBundles()).widget;
}

/** widget-act.js as text. */
export async function bundleActing(): Promise<string> {
  return (await widgetBundles()).acting;
}

/** widget-teach.js as text. */
export async function bundleTeaching(): Promise<string> {
  return (await widgetBundles()).teach;
}

/** map.js as text, without touching dist/. `minify: false` keeps it readable. */
export async function bundleMapper({ minify = true }: { minify?: boolean } = {}): Promise<string> {
  const built = await build({ ...(await options(minify)).map, write: false });
  return built.outputFiles[0]?.text ?? "";
}

/** Writes the four files to dist/, with the copies the Worker brings in as strings, and gives their sizes. */
export async function buildWidget(): Promise<{ widget: number; acting: number; teach: number; map: number; widgetGzip: number; actingGzip: number; teachGzip: number; mapGzip: number }> {
  const built = await options(true);
  const [widget, acting, teach, map] = await Promise.all([
    build({ ...built.widget, outfile: WIDGET_FILE }),
    build({ ...built.acting, outfile: ACTING_FILE }),
    build({ ...built.teach, outfile: TEACH_FILE }),
    build({ ...built.map, outfile: MAP_FILE }),
  ]);
  checkSplit(widget, acting, teach);
  await Promise.all([copyFile(WIDGET_FILE, WIDGET_TEXT_FILE), copyFile(ACTING_FILE, ACTING_TEXT_FILE), copyFile(TEACH_FILE, TEACH_TEXT_FILE), copyFile(MAP_FILE, MAP_TEXT_FILE)]);
  const gzipped = async (file: string) => gzipSync(await readFile(file), { level: 6 }).length;
  const bytes = (result: { metafile?: { outputs: Record<string, { bytes: number }> } }) => Object.values(result.metafile?.outputs ?? {})[0]?.bytes ?? 0;
  return {
    widget: bytes(widget),
    acting: bytes(acting),
    teach: bytes(teach),
    map: bytes(map),
    widgetGzip: await gzipped(WIDGET_FILE),
    actingGzip: await gzipped(ACTING_FILE),
    teachGzip: await gzipped(TEACH_FILE),
    mapGzip: await gzipped(MAP_FILE),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sizes = await buildWidget();
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log(`Built dist/widget.js (${kb(sizes.widget)}, ${kb(sizes.widgetGzip)} gzipped), loaded on every page`);
  console.log(`Built dist/widget-act.js (${kb(sizes.acting)}, ${kb(sizes.actingGzip)} gzipped), loaded only where acting is on`);
  console.log(`Built dist/widget-teach.js (${kb(sizes.teach)}, ${kb(sizes.teachGzip)} gzipped), loaded only with a teaching link`);
  console.log(`Built dist/map.js (${kb(sizes.map)}, ${kb(sizes.mapGzip)} gzipped), loaded only in a tab mapping the app`);
}
