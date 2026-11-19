// A second entry for the same Worker, with the site's files packed inside it.
//
// Wrangler normally uploads the files in `out/` separately. That upload fails
// from machines whose network layer rewrites the Authorization header, such as
// a Claude cloud session. Packing the files into the Worker avoids the separate
// upload. It suits a small site: a Worker may be at most 3 MB compressed.
//
// `site.generated.json` is written by `scripts/embed-site.mjs` after a build.
// The files in it are served by `packedAssets`, in packed.ts.

import { handle, onSchedule, type Env } from "./handler";
import { packedAssets, type Packed } from "./packed";
import files from "./site.generated.json";

const assets = packedAssets(files as Record<string, Packed>);

const worker = {
  fetch(request: Request, env: Env, ctx?: { waitUntil(work: Promise<unknown>): void }): Promise<Response> {
    return handle(request, env, assets, ctx ? (work) => ctx.waitUntil(work) : undefined);
  },
  scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(work: Promise<unknown>): void }) {
    ctx.waitUntil(onSchedule(event.cron, env));
  },
};

export default worker;
