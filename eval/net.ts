import type { GuideSet } from "./guide.ts";

// The net under every run on a site other people use.
//
// A list of risky words on buttons cannot catch every control that writes: a
// "Copy link" that makes a short link on the server reads as harmless. So on
// any guide set that is not a sandbox, every request the page makes is looked
// at before it leaves the browser. A plain read (GET, HEAD, OPTIONS) goes
// through. Anything else goes through only when it is known to be a read, and
// is otherwise stopped inside the browser, so it never reaches a server.
// Everything let through or stopped is counted, and the counts are printed and
// kept with the results, so that a write attempt is seen the day it happens.
//
// Known to be a read:
// - a GraphQL request whose every operation is a query;
// - what the guide set lists in `reads`: the site's own searches and queries
//   that happen to be sent as a POST;
// - what the set's own `before` does to sign in, which its author checked.
//
// A stopped request is one of two things. Most are the page talking to itself:
// usage counts and error reports, sent to another host, sent as a beacon, or
// listed in the set's `chatter`. The rest are requests to the site itself that
// nobody has said are harmless. Those may be a step trying to save, send or
// delete, or a read the set has not listed yet, and either way the page is no
// longer what a visitor would see. A run in which that happened is not scored:
// see `spoiled` below.
//
// What this does not watch: messages sent over a WebSocket once it is open.
// They are counted, and nothing more.

/** One kind of request the page made, and how often. The query and the body are never kept: they can hold what was typed. */
export interface Sent {
  method: string;
  /** Host and path. */
  to: string;
  why: string;
  times: number;
  /** For a stopped request the run cannot be scored with: what the visitor had just done, or "" if nothing yet. */
  after?: string;
}

/** What the net saw during one run. This is what goes in the results file. */
export interface SentLog {
  /** Requests that were not a plain read and were let through, because they are known only to read. */
  let: Sent[];
  /** Requests that were stopped in the browser and reached no server. */
  stopped: Sent[];
  /** WebSockets the page opened, with how many messages it sent on each. They are not stopped. */
  sockets: Sent[];
}

export interface Request {
  method: string;
  url: string;
  body?: string | null;
  /** Sent with sendBeacon or a link's ping: the page cannot read the answer, so it is a report and never a step. */
  beacon?: boolean;
}

export type Verdict =
  /** A plain read. Not counted. */
  | { act: "pass" }
  | { act: "let"; why: string }
  /** `unknown` is true when nobody has said this request is harmless, so the run cannot be scored. */
  | { act: "stop"; why: string; unknown: boolean };

type Site = Pick<GuideSet, "origin" | "reads" | "chatter">;

/** The last two parts of a host name: "api.example.com" and "app.example.com" are one site. */
const domainOf = (host: string) => host.split(".").slice(-2).join(".");

/**
 * Whether a request body is a GraphQL document that only reads: every
 * operation in it is a query. Anything that cannot be read as one is not.
 */
export function onlyQueries(body: string | null | undefined): boolean {
  if (!body) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const documents = Array.isArray(parsed) ? parsed : [parsed];
  if (!documents.length) return false;
  return documents.every((one) => {
    const text = (one as { query?: unknown } | null)?.query;
    if (typeof text !== "string") return false;
    // Strings and comments can hold any word, so they are taken out before the words are read.
    const bare = text.replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/#[^\n]*/g, "");
    // What each operation is, is written outside every pair of braces.
    let depth = 0;
    let outside = "";
    for (const char of bare) {
      if (char === "{") {
        if (depth === 0) outside += "{";
        depth++;
      } else if (char === "}") depth--;
      else if (depth === 0) outside += char;
      if (depth < 0) return false;
    }
    if (depth !== 0 || !outside.includes("{")) return false;
    const heads = outside.split("{").slice(0, -1).map((head) => head.trim());
    // A bare "{" is a query written short. A fragment is part of whichever operation uses it.
    return heads.every((head) => head === "" || /^(query|fragment)\b/.test(head));
  });
}

/** How a request is written in a pattern and in the log: "POST play.grafana.org/api/ds/query". */
export function describeRequest(request: Pick<Request, "method" | "url">): { method: string; to: string } {
  const url = new URL(request.url);
  return { method: request.method.toUpperCase(), to: url.host + url.pathname };
}

/** What to do with one request on a site other people use. `signingIn` is true while the set's own `before` runs. */
export function judge(request: Request, site: Site, signingIn = false): Verdict {
  const { method, to } = describeRequest(request);
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return { act: "pass" };
  const line = `${method} ${to}`;
  if (signingIn) return { act: "let", why: "part of the set's own sign-in" };
  if (site.reads && new RegExp(site.reads, "i").test(line)) return { act: "let", why: "the guide set says it only reads" };
  if (method === "POST" && onlyQueries(request.body)) return { act: "let", why: "a GraphQL query" };

  const host = new URL(request.url).hostname;
  const home = new URL(site.origin).hostname;
  if (host !== home && domainOf(host) !== domainOf(home)) return { act: "stop", why: "sent to another site", unknown: false };
  if (request.beacon) return { act: "stop", why: "a beacon the page sends by itself", unknown: false };
  if (site.chatter && new RegExp(site.chatter, "i").test(line)) return { act: "stop", why: "the guide set says the page sends it by itself", unknown: false };
  return { act: "stop", why: "not known to be a read", unknown: true };
}

/** Keeps count of what the page sent during one run, and of what the visitor was doing when it did. */
export class Net {
  readonly log: SentLog = { let: [], stopped: [], sockets: [] };
  /** True while the set's own `before` is signing in. */
  signingIn = false;
  /** What the visitor last did, in words. Empty until they have done anything. */
  private doing = "";

  constructor(private readonly site: Site) {}

  /** Says what the visitor is about to do, so that a request it sets off can be traced to it. */
  acting(what: string) {
    this.doing = what;
  }

  /** Decides one request and counts it. Returns true when it may go through. */
  decide(request: Request): boolean {
    const verdict = judge(request, this.site, this.signingIn);
    if (verdict.act === "pass") return true;
    const { method, to } = describeRequest(request);
    const list = verdict.act === "let" ? this.log.let : this.log.stopped;
    const unknown = verdict.act === "stop" && verdict.unknown;
    const same = list.find((sent) => sent.method === method && sent.to === to && sent.why === verdict.why && (!unknown || sent.after === this.doing));
    if (same) same.times++;
    else list.push({ method, to, why: verdict.why, times: 1, ...(unknown ? { after: this.doing } : {}) });
    return verdict.act === "let";
  }

  /** Counts a WebSocket the page opened, or one more message sent on it. */
  socket(url: string, opened: boolean) {
    const where = new URL(url);
    const to = where.host + where.pathname;
    let entry = this.log.sockets.find((sent) => sent.to === to);
    if (!entry) this.log.sockets.push((entry = { method: "WS", to, why: "a WebSocket, which is not watched", times: 0 }));
    if (!opened) entry.times++;
  }

  /**
   * Why this run cannot be scored, or "" when it can. A request to the site
   * itself was stopped and nobody has said it is harmless. After something the
   * visitor did, that is taken for the step trying to write. Before they did
   * anything it is the page's own, and the guide set has to say which it is.
   */
  spoiled(): { why: string; byAStep: boolean } | undefined {
    const first = this.log.stopped.find((sent) => sent.after !== undefined);
    if (!first) return undefined;
    const request = `${first.method} ${first.to}`;
    if (first.after) {
      return { byAStep: true, why: `after the visitor ${first.after}, the page tried to send ${request}, which was stopped: nothing is written to a site other people use` };
    }
    return {
      byAStep: false,
      why: `the page tried to send ${request} before the visitor did anything, and it was stopped. If it only reads, add it to "reads" in the guide set, and if the page sends it by itself, to "chatter"`,
    };
  }
}

/** The lines that say what a run's pages sent, for a person to read. */
export function describeSent(log: SentLog): string[] {
  const lines: string[] = [];
  const list = (title: string, sent: Sent[]) => {
    if (!sent.length) return;
    lines.push(title);
    for (const one of sent) lines.push(`  ${String(one.times).padStart(3)}x ${one.method} ${one.to}   (${one.why}${one.after ? `, after the visitor ${one.after}` : ""})`);
  };
  list("Let through, though not a plain read:", log.let);
  list("Stopped in the browser:", log.stopped);
  list("WebSockets opened, and messages the page sent on each:", log.sockets);
  return lines;
}

/** Adds up what several runs sent: how many requests were let through, stopped as the page's own, and stopped with no one vouching for them. */
export function countSent(logs: (SentLog | undefined)[]): { let: number; stopped: number; unknown: number } {
  const count = { let: 0, stopped: 0, unknown: 0 };
  for (const log of logs) {
    if (!log) continue;
    for (const sent of log.let) count.let += sent.times;
    for (const sent of log.stopped) {
      if (sent.after !== undefined) count.unknown += sent.times;
      else count.stopped += sent.times;
    }
  }
  return count;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/**
 * Puts the net on a browser context. It has to be called before any other
 * route is added: Playwright asks the newest route first, and the widget's own
 * requests are answered by routes added after this one, so they never get here.
 */
export async function watch(context: Loose, site: Site): Promise<Net> {
  const net = new Net(site);
  await context.route("**/*", async (route: Loose) => {
    const request = route.request();
    let allowed = false;
    try {
      allowed = net.decide({ method: request.method(), url: request.url(), body: request.postData(), beacon: request.resourceType() === "ping" });
    } catch {
      // An address or a body that cannot be read is not known to be a read.
    }
    // "aborted" leaves the page where it is. A plain failure would put the browser's error page in its place.
    await (allowed ? route.fallback() : route.abort("aborted")).catch(() => undefined);
  });
  context.on("page", (page: Loose) => {
    page.on("websocket", (socket: Loose) => {
      try {
        net.socket(socket.url(), true);
        socket.on("framesent", () => net.socket(socket.url(), false));
      } catch {
        // An address that cannot be read. Nothing to count.
      }
    });
  });
  return net;
}
