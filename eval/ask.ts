import { measureTurn, type TurnSettings } from "../src/server/model.ts";
import { STREAM_TYPE, type SiteContext, type TurnReply, type TurnRequest } from "../src/shared/types.ts";

// Where a benchmark gets its answers from. Either a model called from here,
// through the same code as the live server, or a server that is already
// running, which is asked the way the widget asks it. The second needs no key
// on this machine, and measures the setting that visitors actually get.

/** One answer, timed. */
export interface Asked {
  reply: TurnReply;
  ms: number;
  /** How long until the control was named, which is when the pointer starts to move. */
  msToTarget: number;
  /** The model that answered, or the server's address when it does not say. */
  servedBy: string;
  /** Whether the sentence could be shown as the model wrote it. Unknown when a server answered. */
  clean?: boolean;
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
}

export type Asker = (site: SiteContext, request: Omit<TurnRequest, "site">) => Promise<Asked>;

/** "claude-haiku-5-5@off" is Haiku with no thinking. "@low", "@medium" and "@high" set the effort. */
export function parseModel(spec: string): { name: string; settings: TurnSettings } {
  const [model = "", ...flags] = spec.trim().split("@");
  const settings: TurnSettings = { model, effort: "low", thinking: "default" };
  for (const flag of flags) {
    if (flag === "low" || flag === "medium" || flag === "high") settings.effort = flag;
    else if (flag === "off") settings.thinking = "off";
    else throw new Error(`"${flag}" in "${spec}" isn't a setting. Use low, medium, high or off.`);
  }
  if (!model) throw new Error("A model is missing from --models.");
  return { name: spec.trim(), settings };
}

/** Answers from a model called here. Real models need ANTHROPIC_API_KEY. */
export function modelAsker(settings: TurnSettings): Asker {
  return async (site, request) => {
    const measure = await measureTurn(site, { ...request, site: site.id }, settings);
    return {
      reply: measure.reply,
      ms: measure.ms,
      msToTarget: measure.msToTarget,
      servedBy: measure.model,
      clean: measure.wrote === measure.reply.say,
      ...(measure.tokens ? { tokens: measure.tokens } : {}),
    };
  };
}

/**
 * The live server lets one caller ask 30 steps a minute on a site. This stays
 * under that. A server with a higher limit, like the staging one, can be asked
 * faster by setting HAPTIC_SERVER_GAP_MS.
 */
const SERVER_GAP_MS = Number(process.env.HAPTIC_SERVER_GAP_MS) || 2100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Answers from a running Haptic server, like "https://widget.joinhaptic.com".
 * The site has to be on that server already (npm run site:publish). Timings
 * include the trip from this machine to the server.
 */
export function serverAsker(address: string): Asker {
  const base = address.replace(/\/$/, "");
  const lastAsked = new Map<string, number>();
  return async (site, request) => {
    for (let attempt = 0; ; attempt++) {
      const wait = (lastAsked.get(site.id) ?? 0) + SERVER_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastAsked.set(site.id, Date.now());

      const started = Date.now();
      const response = await fetch(`${base}/v1/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: STREAM_TYPE },
        body: JSON.stringify({ ...request, site: site.id }),
      });
      if ((response.status === 429 || response.status === 503) && attempt < 6) {
        await sleep(15_000);
        continue;
      }
      if (response.status === 404) throw new Error(`${base} has no site called ${site.id}. Put it there first: npm run site:publish -- ${site.id}`);
      if (!response.ok || !response.body) throw new Error(`${base} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);

      // One JSON value per line: the control first, then the whole reply.
      let msToTarget: number | undefined;
      let reply: TurnReply | undefined;
      let buffered = "";
      const decoder = new TextDecoder();
      const read = (line: string) => {
        if (!line.trim()) return;
        const message = JSON.parse(line) as Partial<TurnReply> & { error?: string; code?: number };
        if (message.error) throw new Error(`${base} answered ${message.code}: ${message.error}`);
        msToTarget ??= Date.now() - started;
        if (typeof message.say === "string") reply = message as TurnReply;
      };
      for await (const chunk of response.body) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        lines.forEach(read);
      }
      read(buffered);
      if (!reply) throw new Error(`${base} ended its reply before it was complete.`);
      const ms = Date.now() - started;
      return { reply, ms, msToTarget: msToTarget ?? ms, servedBy: base };
    }
  };
}
