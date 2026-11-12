// The Worker in front of the site on Cloudflare. This is the standard entry:
// Cloudflare serves the static pages from `out/` and hands them over as ASSETS.

import { handle, type Env } from "./handler";

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    if (!env.ASSETS) return Promise.resolve(new Response("The site's files are not attached.", { status: 500 }));
    return handle(request, env, env.ASSETS);
  },
};

export default worker;
