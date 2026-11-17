// The Worker in front of the site on Cloudflare. This is the standard entry:
// Cloudflare serves the static pages from `out/` and hands them over as ASSETS.

import { handle, onSchedule, type Env } from "./handler";

const worker = {
  fetch(request: Request, env: Env, ctx?: { waitUntil(work: Promise<unknown>): void }): Promise<Response> {
    if (!env.ASSETS) return Promise.resolve(new Response("The site's files are not attached.", { status: 500 }));
    return handle(request, env, env.ASSETS, ctx ? (work) => ctx.waitUntil(work) : undefined);
  },
  // Every hour: send Stripe any finished guides still owed. Once a day: tell companies about common questions whose guides stopped finishing.
  scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(work: Promise<unknown>): void }) {
    ctx.waitUntil(onSchedule(event.cron, env));
  },
};

export default worker;
