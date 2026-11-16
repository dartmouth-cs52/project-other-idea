import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { checkAction } from "../shared/act-rules.ts";
import { ACTING_LIMITS, ACTS, actionsAllowed, type Act, type SiteContext, type SnapElement, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { actingFor, type NotActing } from "./acting.ts";
import { namedButNotDone, namedButNotDoneNote, namedButNotPointed, namedButNotPointedNote, pressLeftToVisitor } from "./check.ts";
import { buildSystemPrompt, buildUserMessage } from "./prompt.ts";

// One model call per step. HAPTIC_MODEL picks the model, or "mock" for a
// keyword matcher that needs no API key. The reply is streamed, so the control
// to point at is known before the sentence that goes with it is finished.
//
// A step is a guide's unless the widget asked to act and the site allows it
// (acting.ts). Only then is the model given the act instructions and the act
// reply's shape, its reply checked with the same rules the widget uses, and
// `mode: "act"` put on it: the widget acts on no reply without that.

type Effort = "low" | "medium" | "high";

/**
 * What is done with a reply whose sentence tells the visitor to use a listed
 * control while it points at nothing (check.ts). "ask" asks the model once
 * more when it is the guide's first question, and only says so in the
 * server's log after that. "log" only logs, "off" does neither.
 *
 * Measured on 16 November 2026 over four runs of the 469 tuned single steps
 * (1,870 replies): on every step it caught 34 replies (1.8%), of which 14 were
 * scored wrong. Nearly all the other 20 came after the goal was reached and
 * named an optional extra ("Click Close when you're finished"), and asking
 * again made the model point at the extra in 3 of 27 tries. On first
 * questions it caught 9 replies (0.5%), all 9 wrong, such as "Click FAQ in the
 * top bar to read it" with nothing pointed at. Nothing can have been reached
 * before the first step, so there a control the sentence names is the step.
 *
 * In act mode "ask" also asks once more at any step when a reply of
 * "continue" points at nothing and its sentence names a control Haptic could
 * press itself (check.ts, namedButNotDone). There every step is Haptic's to
 * do, and such a reply leaves the visitor waiting on nothing: on Northpine's
 * card wizard, 2 demo runs in 9 stopped on "Virtual is already selected, so
 * I'm skipping that choice. Next to open Limits and controls."
 *
 * Whatever this is set to, a reply in act mode that points at a control
 * Haptic could press, with "do" null, and only tells the visitor to click it
 * is made a click (check.ts, pressLeftToVisitor). That takes no model call.
 */
export type Recheck = "off" | "log" | "ask";

/** How a step is asked for. The server reads these from the environment, and the benchmark tries several. */
export interface TurnSettings {
  /** Any Claude model ID, or "mock". */
  model: string;
  effort: Effort;
  /** "off" asks for no thinking before the answer, on the models that allow it. */
  thinking: "default" | "off";
  recheck?: Recheck;
}

/** The names the settings are read from: HAPTIC_MODEL, HAPTIC_EFFORT, HAPTIC_THINKING, HAPTIC_RECHECK and ANTHROPIC_API_KEY. */
export type ModelEnv = Record<string, string | undefined>;

const EFFORTS: readonly string[] = ["low", "medium", "high"];
const RECHECKS: readonly string[] = ["off", "log", "ask"];

function settingsFrom(env: ModelEnv): TurnSettings {
  return {
    model: env.HAPTIC_MODEL || "claude-sonnet-5-5",
    // Each step is a small decision and the visitor is waiting on it, so the least effort is the default.
    effort: EFFORTS.includes(env.HAPTIC_EFFORT ?? "") ? (env.HAPTIC_EFFORT as Effort) : "low",
    thinking: env.HAPTIC_THINKING === "off" ? "off" : "default",
    recheck: RECHECKS.includes(env.HAPTIC_RECHECK ?? "") ? (env.HAPTIC_RECHECK as Recheck) : "ask",
  };
}

// On Node the settings are in process.env when this file loads. A Cloudflare
// Worker is only handed its settings with each request, so its entry point
// passes them to configure().
const startEnv: ModelEnv = typeof process === "undefined" ? {} : process.env;
export let SETTINGS: TurnSettings = settingsFrom(startEnv);
/** For trying the early pointer with no API key: the stand-in names its control, then waits this long before finishing. */
let mockPauseMs = Number(startEnv.HAPTIC_MOCK_PAUSE_MS) || 0;
let apiKey: string | undefined;
let client: Anthropic | undefined;

/** The calls this file makes to the model. Tests give a stand-in that answers from a script. */
type ModelClient = Pick<Anthropic, "beta">;
let given: ModelClient | undefined;

export function configure(env: ModelEnv, stand?: ModelClient) {
  SETTINGS = settingsFrom(env);
  mockPauseMs = Number(env.HAPTIC_MOCK_PAUSE_MS) || 0;
  if (env.ANTHROPIC_API_KEY !== apiKey) {
    apiKey = env.ANTHROPIC_API_KEY;
    client = undefined;
  }
  given = stand;
}

/** A step's reply, with what it took to get. */
export interface TurnMeasure {
  reply: TurnReply;
  /** The model that answered. After a fallback it is not the one asked for. */
  model: string;
  /** The whole step. */
  ms: number;
  /** Until the control to point at was known, which is when the pointer can start moving. */
  msToTarget: number;
  /** The sentence exactly as the model wrote it, before tidySay. The benchmark compares the two. */
  wrote: string;
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
  /**
   * The listed control the first reply's sentence told the visitor to use while it pointed at nothing, and whether the model was asked again.
   * `act` is set when it was an act reply of "continue" naming a control Haptic could press (namedButNotDone).
   */
  recheck?: { named: string; asked: boolean; act?: true };
  /**
   * Set when the widget asked to act. `refused`: why the step was answered as
   * a guide. `capped`: the step was past the site's cap, so the model was not
   * asked. `modelDo`: the model's own "do", before the server's check.
   * `converted`: the model left a click to the visitor on a control Haptic
   * could press, and the server made it Haptic's (check.ts,
   * pressLeftToVisitor). Names from Haptic's own code only, never anything
   * from the page.
   */
  acting?: { refused?: NotActing; capped?: boolean; modelDo?: Act | null; converted?: true };
}

const Reply = z.object({
  target: z.string().nullable().describe('Id of the element to point at, like "e12", or null'),
  status: z.enum(["continue", "done"]),
  say: z.string().describe("One or two short sentences for the visitor"),
});

/**
 * The act-mode reply, in the order the model writes it (DESIGN 1.1): the
 * target first, so the pointer can still start early; what Haptic does to it
 * before the sentence. The act instructions say what each field means.
 */
const ActReply = z.object({
  target: Reply.shape.target,
  do: z.enum(ACTS).nullable(),
  enter: z.string().nullable(),
  commits: z.boolean(),
  status: Reply.shape.status,
  say: Reply.shape.say,
});

/** What the visitor reads when a step in act mode is past the site's cap. The widget, told why by `withheld`, says it in its own words. */
export const ACT_CAP_SAY = "That's as far as I'll go on my own.";

/** A guide's reply has these three fields and nothing else, whatever the model or the stand-in wrote, so no guide reply can carry an act. */
const asGuide = (reply: TurnReply): TurnReply => ({ target: reply.target, status: reply.status, say: reply.say });
/** An act reply's own fields, without anything the model may not set: the echo and `withheld` are the server's. */
const asAct = (reply: TurnReply): TurnReply => ({
  target: reply.target,
  do: reply.do ?? null,
  enter: reply.enter ?? null,
  commits: reply.commits === true,
  status: reply.status,
  say: reply.say,
});

/**
 * The server's check of an act reply (DESIGN 4): the same pure rules the
 * widget runs again before its gate. It can only remove a "do". If the
 * rules themselves fail, the "do" is removed too: nothing is acted on that
 * was not checked.
 */
function checked(reply: TurnReply, request: TurnRequest, commitWords: readonly string[] | undefined): TurnReply {
  try {
    const check = checkAction(reply, request, commitWords ? { commitWords } : {});
    return check.withheld ? { ...check.reply, withheld: check.withheld } : check.reply;
  } catch (error) {
    console.error("checkAction failed, so the step is left to the visitor:", error instanceof Error ? error.message : error);
    const { do: removed, ...rest } = reply;
    return removed ? { ...rest, enter: null, withheld: "unknown", removed } : { ...rest, enter: null };
  }
}

/** The reply's first field, as soon as it is complete in the text streamed so far. */
const TARGET_SO_FAR = /"target"\s*:\s*(?:"([^"]*)"|null)/;

/** The most a visitor is shown. Of 1,555 live sentences, every one that was fine had at most four sentences and 258 characters. */
export const SAY_MAX_SENTENCES = 4;
export const SAY_MAX_CHARS = 300;

// The sentence is one string in the reply's JSON, and it is read only when the
// whole reply has arrived. So nothing wrong with it comes from cutting a reply
// that is still streaming: the model wrote it. About one live sentence in
// thirty has something that is not for the visitor, nearly always after its
// last full stop: a line-break tag, the reply's own closing quote mark and
// brace written with the wrong characters, a character with no width, a stray
// word. The tests hold every kind that was seen, as it was written.

/** What ends a sentence. */
const STOP = ".!?…。！？";
/** A stop, then any quote marks or brackets that close with it, and nothing more. */
const PROPER_END = new RegExp(`[${STOP}]["'”’»«)\\]]*$`);
/**
 * Tags that break a line. The sentence is shown as plain text, so a tag would
 * be read out as one. Only the line-break tag has been seen. A name in angle
 * brackets that is not one of these, like a key, is left alone.
 */
const BREAK_TAG = /<\/?(?:br|p|div)\s*\/?>/gi;
/** Tags that only dress the words between them. */
const DRESS_TAG = /<\/?(?:b|i|em|strong|u|code|span)\s*\/?>/gi;
/** Characters that take no room and mean nothing here. */
const NO_WIDTH = /[\u200B\u2060\uFEFF]/g;
/** The two joiners are part of how some languages are written, but only between letters, never beside a space or at an end. */
const LOOSE_JOINER = /(?<=^|[\s.!?,;:])[\u200C\u200D]+|[\u200C\u200D]+(?=$|[\s.!?,;:])/g;
/** A check mark or a picture where a sentence would start, with the marks that can trail a picture. Inside a sentence it may be part of a control's name. */
const SIGN_AFTER_STOP = /(?<=[.!?…])\s*(?:[\p{So}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]+\s*)+/gu;
/** "its menu.Step 1": a full stop with a new sentence right behind it. */
const NO_SPACE_AFTER_STOP = /(\p{Ll}[.!?])(?=\p{Lu}\p{Ll})/gu;
/**
 * What can be left stuck to the last full stop: quote marks and stops and then
 * one word of code ("start.”.replace"), or one bare word ("list.markdown").
 * A bare word has to be five letters or more, which spares the end of a file
 * name or a web address when a sentence stops on one with no full stop.
 */
const SCRAP = /^(?:["'”’»«)\]}.]+[A-Za-z_$][\w$]*(?:\(\))?|[A-Za-z]{5,})$/;
const OPENS: Record<string, string> = { "}": "{", "]": "[", ")": "(" };

const count = (text: string, chars: string) => [...text].filter((char) => chars.includes(char)).length;

/** Takes off what follows the last sentence and is not part of it. */
function withoutLeftovers(text: string): string {
  for (;;) {
    const before = (text = text.trimEnd());
    const last = text.at(-1) ?? "";
    const rest = text.slice(0, -1);
    // A bracket that closes nothing: most often the brace that ends the reply itself.
    if (OPENS[last] && count(text, last) > count(text, OPENS[last])) text = rest;
    // A quote mark with no partner. French and German marks are counted with their own kind.
    else if ('"“”'.includes(last) && count(text, '"“”„') % 2) text = rest;
    else if ("«»".includes(last) && count(text, "«»") % 2) text = rest;
    // A single one counts only after a stop, and only when no word in the sentence opens with one: "we'll" does not.
    else if ("'’".includes(last) && STOP.includes(rest.at(-1) ?? " ") && !/(?:^|[\s(])['‘’]\S/.test(rest)) text = rest;
    // A comma, colon or semicolon after the last stop and any marks that close with it ends nothing: it is the reply's own JSON, written as text.
    else if (",;:".includes(last) && PROPER_END.test(rest)) text = rest;
    else if (!PROPER_END.test(text)) {
      // The last run of characters holds a full stop with more stuck to it.
      const word = /\S+$/.exec(text)?.[0] ?? "";
      const stuck = /^.*?\p{L}[.!?](?=\D)/su.exec(word)?.[0];
      if (stuck && word.length - stuck.length > 1 && SCRAP.test(word.slice(stuck.length))) text = text.slice(0, text.length - word.length + stuck.length);
    }
    if (text === before) return text;
  }
}

/** Where one sentence ends and the next begins. A lower-case letter after the stop means it was a short form, like "e.g.". */
const BETWEEN_SENTENCES = /[.!?…]["'”’»)\]]*(?=\s+[^\s\p{Ll}])|[。！？]["”’」』）]*(?=.)/gsu;

/** Keeps to the limits above, cutting after a whole sentence wherever one ends in time. */
function capped(text: string): string {
  let sentences = 0;
  let cut = 0;
  for (const end of text.matchAll(BETWEEN_SENTENCES)) {
    const at = end.index + end[0].length;
    if (at > SAY_MAX_CHARS) break;
    cut = at;
    if (++sentences === SAY_MAX_SENTENCES) return text.slice(0, cut);
  }
  if (text.length <= SAY_MAX_CHARS) return text;
  if (cut) return text.slice(0, cut);
  // One sentence longer than the limit: stop at a word, and show that there was more.
  const room = text.slice(0, SAY_MAX_CHARS - 1);
  return room.slice(0, Math.max(room.lastIndexOf(" "), 0) || room.length).replace(/[\s,;:(–-]+$/, "") + "…";
}

/**
 * The sentence a visitor reads, tidied. It comes out as plain prose on one
 * line: no tags, no characters without width, no blank lines or double
 * spaces, a space after every full stop, nothing left over after the last
 * sentence, and no longer than a caption can show. A sentence that was fine
 * comes out exactly as it went in.
 */
export function tidySay(say: string): string {
  const prose = say
    .replace(BREAK_TAG, " ")
    .replace(DRESS_TAG, "")
    .replace(NO_WIDTH, "")
    .replace(LOOSE_JOINER, "")
    .replace(SIGN_AFTER_STOP, " ")
    .replace(/\s*[\n\r]\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(NO_SPACE_AFTER_STOP, "$1 ")
    .trim();
  return capped(withoutLeftovers(prose));
}

/** Thrown for failures the visitor's browser should hear about with a specific status. */
export class TurnError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function runTurn(site: SiteContext, request: TurnRequest): Promise<TurnReply> {
  return (await measureTurn(site, request)).reply;
}

/**
 * One step, timed. `onTarget` is called once, as soon as the control to point
 * at is known and only if it is on the page the model was shown. The benchmark
 * calls this with the settings it wants to compare.
 */
export async function measureTurn(
  site: SiteContext,
  asked: TurnRequest,
  settings: TurnSettings = SETTINGS,
  onTarget?: (id: string) => void,
): Promise<TurnMeasure> {
  const started = Date.now();
  // Decided again on every step, from the site as it is now.
  const acting = actingFor(site, asked);
  // A step answered as a guide is asked exactly as a guide's, whatever the widget asked for. From here, `request.mode` is the mode answered in.
  const request: TurnRequest = acting.act || asked.mode === undefined ? asked : withoutMode(asked);
  const actingMeasure: TurnMeasure["acting"] = asked.mode === "act" ? (acting.act ? {} : { refused: acting.refused ?? "site" }) : undefined;

  // Past the site's cap, acting ends without asking the model. The widget's own cap comes first; this is for a widget that does not keep it.
  if (acting.act && request.step > actionsAllowed(acting.settings) + ACTING_LIMITS.stepAllowance) {
    const reply: TurnReply = { target: null, status: "done", say: ACT_CAP_SAY, mode: "act", withheld: "cap" };
    const ms = Date.now() - started;
    return { reply, model: "none", ms, msToTarget: ms, wrote: reply.say, acting: { ...actingMeasure, capped: true } };
  }

  let msToTarget: number | undefined;
  let pointed = false;
  const onPage = (id: string | null): id is string => id !== null && request.snapshot.elements.some((element) => element.id === id);
  // A reply that names nothing may be followed by one that does, when the model is asked again, and that one is sent early too.
  const targetKnown = (id: string | null) => {
    if (pointed) return;
    if (msToTarget === undefined || onPage(id)) msToTarget = Date.now() - started;
    if (!onPage(id)) return;
    pointed = true;
    onTarget?.(id);
  };

  let answer: Answer;
  if (settings.model === "mock") {
    const reply = mockTurn(request);
    if (mockPauseMs > 0) {
      targetKnown(reply.target);
      await new Promise((resolve) => setTimeout(resolve, mockPauseMs));
    }
    answer = { reply, model: "mock" };
  } else answer = await claudeTurn(site, request, settings, targetKnown);
  // The model can only point at what's on the page it was shown.
  if (!onPage(answer.reply.target)) answer.reply.target = null;

  const checking = settings.model !== "mock" && settings.recheck !== "off";
  // In act mode at any step: a "continue" that points at nothing stops the run, so a control it names that Haptic could press is asked about.
  const stalled = checking && acting.act ? namedButNotDone(request, answer.reply, acting.settings.commitWords) : undefined;
  const named = checking && !stalled ? namedButNotPointed(request.snapshot, answer.reply) : undefined;
  const found = stalled ?? named;
  if (found) {
    const ask = settings.recheck === "ask" && (stalled !== undefined || (request.step === 0 && !request.event));
    // Ids only: the server's log holds nothing from the visitor's page.
    console.log(
      stalled
        ? `recheck ${site.id} step ${request.step}: an act reply of "continue" names ${found.id}, which Haptic could press, and nothing is pointed at${ask ? ", asking again" : ""}`
        : `recheck ${site.id} step ${request.step}: the sentence tells the visitor to use ${found.id} and nothing is pointed at${ask ? ", asking again" : ""}`,
    );
    answer.recheck = { named: found.id, asked: ask, ...(stalled ? { act: true as const } : {}) };
    if (ask) {
      try {
        const note = stalled ? namedButNotDoneNote(stalled) : namedButNotPointedNote(found);
        const again = await claudeTurn(site, request, settings, targetKnown, { reply: answer.reply, note });
        if (!onPage(again.reply.target)) again.reply.target = null;
        answer = { ...again, tokens: added(answer.tokens, again.tokens), recheck: answer.recheck };
      } catch (error) {
        // The first reply is still one the visitor can be shown.
        console.warn(`recheck ${site.id} step ${request.step}: asking again failed, so the first reply stands:`, error instanceof Error ? error.message : error);
      }
    }
  }
  targetKnown(answer.reply.target);
  const wrote = answer.reply.say;
  answer.reply.say = tidySay(wrote);
  if (acting.act) {
    const modelDo = answer.reply.do ?? null;
    // A press the model left to the visitor that Haptic could make itself is made Haptic's, with no model call (check.ts). The check below and the widget's gate judge it as any other.
    const pressed = pressLeftToVisitor(request, answer.reply, acting.settings.commitWords);
    if (pressed) {
      // Ids only: the server's log holds nothing from the visitor's page.
      console.log(`press ${site.id} step ${request.step}: an act reply of "continue" left a click on ${pressed.element.id} to the visitor, which Haptic could press, so Haptic clicks it`);
      answer.reply = { ...answer.reply, do: "click", enter: null, say: pressed.say };
    }
    answer.reply = { ...checked(asAct(answer.reply), request, acting.settings.commitWords), mode: "act" };
    answer.acting = { ...actingMeasure, modelDo, ...(pressed ? { converted: true as const } : {}) };
  } else {
    answer.reply = asGuide(answer.reply);
    if (actingMeasure) answer.acting = actingMeasure;
  }
  return { ...answer, ms: Date.now() - started, msToTarget: msToTarget ?? Date.now() - started, wrote };
}

/** The request without the mode the widget asked for, for a step answered as a guide. */
function withoutMode(request: TurnRequest): TurnRequest {
  const { mode: _asked, ...rest } = request;
  return rest;
}

type Answer = Omit<TurnMeasure, "ms" | "msToTarget" | "wrote">;

function added(one: TurnMeasure["tokens"], two: TurnMeasure["tokens"]): TurnMeasure["tokens"] {
  if (!one || !two) return one ?? two;
  return { input: one.input + two.input, cacheRead: one.cacheRead + two.cacheRead, cacheWrite: one.cacheWrite + two.cacheWrite, output: one.output + two.output };
}

/**
 * The setting that turns thinking off, for the models that take one. Haiku and
 * Sonnet each have their own. Opus always thinks, so it gets nothing here.
 */
function withoutThinking(model: string): { thinking?: { type: "disabled" } | { type: "between_tools" } } {
  if (model.includes("haiku")) return { thinking: { type: "disabled" } };
  if (model.includes("sonnet")) return { thinking: { type: "between_tools" } };
  return {};
}

async function claudeTurn(
  site: SiteContext,
  request: TurnRequest,
  settings: TurnSettings,
  targetKnown: (id: string | null) => void,
  /** The reply to ask about again, and what to tell the model about it. */
  followUp?: { reply: TurnReply; note: string },
): Promise<Answer> {
  const model = given ?? (client ??= new Anthropic(apiKey ? { apiKey } : {}));
  const messages: Anthropic.Beta.BetaMessageParam[] = request.history.map((turn) => ({ role: turn.role, content: turn.text }));
  // The conversation has to start with a user message.
  while (messages[0]?.role === "assistant") messages.shift();
  messages.push({ role: "user", content: buildUserMessage(request) });
  if (followUp) messages.push({ role: "assistant", content: JSON.stringify(followUp.reply) }, { role: "user", content: followUp.note });

  // If the model declines a request on policy grounds, the API retries it on a
  // fallback model inside the same call. Haiku has no server-side fallback.
  const fallback = settings.model.includes("haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  const started = Date.now();
  let response;
  try {
    const stream = model.beta.messages.stream({
      model: settings.model,
      max_tokens: 4000,
      ...fallback,
      ...(settings.thinking === "off" ? withoutThinking(settings.model) : {}),
      output_config: { effort: settings.effort, format: request.mode === "act" ? betaZodOutputFormat(ActReply) : betaZodOutputFormat(Reply) },
      // Rules and site knowledge are the same for every turn on a site, so they're cached: once for guides and once for acting.
      system: [{ type: "text", text: buildSystemPrompt(site, request.mode), cache_control: { type: "ephemeral" } }],
      messages,
    });
    // The reply is JSON with "target" first, so it is the first thing that can be acted on.
    stream.on("text", (_delta, soFar) => {
      const found = TARGET_SO_FAR.exec(soFar);
      if (found) targetKnown(found[1] ?? null);
    });
    response = await stream.finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new TurnError(500, "The server's Anthropic credentials are missing or invalid.");
    if (error instanceof Anthropic.RateLimitError) throw new TurnError(503, "The model is rate limited. Try again shortly.");
    if (error instanceof Anthropic.APIError) throw new TurnError(502, `The model call failed (${error.status ?? "no status"}): ${error.message}`);
    throw error;
  }

  const { usage } = response;
  console.log(
    `turn ${site.id} step ${request.step}: ${Date.now() - started} ms, ${response.model}, ` +
      `input ${usage.input_tokens}, cache read ${usage.cache_read_input_tokens ?? 0}, output ${usage.output_tokens}`,
  );

  const tokens = {
    input: usage.input_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    output: usage.output_tokens,
  };
  if (response.stop_reason === "refusal") return { reply: { target: null, status: "done", say: "I can't help with that one." }, model: response.model, tokens };
  if (!response.parsed_output) throw new TurnError(502, `The model's reply couldn't be read (stop reason: ${response.stop_reason}).`);
  return { reply: response.parsed_output, model: response.model, tokens };
}

/**
 * Replies the stand-in gives before its own, one per step, so that a test can
 * have it write what a keyword matcher never would: a "do" on a control that
 * commits, a value the visitor did not give. Each call replaces the script.
 */
const mockScript: TurnReply[] = [];
export function scriptMock(...replies: TurnReply[]): void {
  mockScript.splice(0, mockScript.length, ...replies);
}

/**
 * Stand-in for the model: points at the element whose label shares the most
 * words with the goal, and never at the same label twice. Good enough to test
 * everything around the model, not to guide anyone. In act mode it also says
 * what Haptic does to the control (`mockAct`).
 */
function mockTurn(request: TurnRequest): TurnReply {
  const scripted = mockScript.shift();
  if (scripted) return structuredClone(scripted);
  const act = request.mode === "act";
  const words = (text: string) => text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const goal = new Set(words(request.goal));
  const used = request.history.filter((turn) => turn.role === "assistant").map((turn) => turn.text);
  // Every sentence the stand-in writes about a control ends with its label: "Click Billing." in a guide, "Clicking Billing." when acting.
  const usedBefore = (label: string) => used.some((text) => text.endsWith(`Click ${label}.`) || (act && text.endsWith(` ${label}.`)));
  const visitorDoes = (reply: TurnReply): TurnReply => (act ? { target: reply.target, do: null, enter: null, commits: false, status: reply.status, say: reply.say } : reply);
  // After a wrong click, point again at the control it meant, if that is still on the page.
  const strayed = /instead of|without using/.test(request.event ?? "");
  if (strayed) {
    const meant = /Click (.+)\.$/.exec(used.pop() ?? "")?.[1];
    const again = request.snapshot.elements.find((element) => element.label === meant && !element.state?.includes("disabled"));
    if (again) return visitorDoes({ target: again.id, status: "continue", say: `Not that one. Click ${again.label}.` });
  }
  let best: { element: SnapElement; score: number } | undefined;
  for (const element of request.snapshot.elements) {
    if (!element.label || element.state?.includes("disabled") || usedBefore(element.label)) continue;
    const score = words(element.label).filter((word) => goal.has(word)).length;
    if (score > (best?.score ?? 0)) best = { element, score };
  }
  if (!best) return visitorDoes({ target: null, status: "done", say: request.step ? "That should be it." : "I don't see that on this page." });
  if (act && !strayed) return mockAct(best.element, request.goal);
  return visitorDoes({ target: best.element.id, status: "continue", say: `${strayed ? "Not that one. " : ""}Click ${best.element.label}.` });
}

/** Words that start the name of a control the stand-in takes to commit. Its own short list: the real rules are in act-rules.ts, and the server checks every reply with them. */
const MOCK_COMMITS = /^(?:save|send|submit|pay|delete|issue|publish|invite|approve|confirm|create)\b/i;

/**
 * The stand-in's act reply for the control it chose, as the act instructions
 * ask: the hand-over at a control that commits; a value only from quote marks
 * in the visitor's question, and otherwise the visitor fills the field in;
 * a click, a check or a choice by the control's role.
 */
function mockAct(element: SnapElement, goal: string): TurnReply {
  const { id: target, label } = element;
  if (MOCK_COMMITS.test(label)) return { target, do: null, enter: null, commits: true, status: "done", say: `Ready. Check it and click ${label}.` };
  const given = /["“]([^"“”]+)["”]/.exec(goal)?.[1]?.trim() || null;
  const step = (act: Act, say: string, enter: string | null = null): TurnReply => ({ target, do: act, enter, commits: false, status: "continue", say });
  switch (element.role) {
    case "textbox":
    case "searchbox":
    case "spinbutton":
      return given ? step("type", `Typing in ${label}.`, given) : { target, do: null, enter: null, commits: false, status: "continue", say: `Fill in ${label}.` };
    case "combobox":
    case "select":
      return given ? step("choose", `Choosing in ${label}.`, given) : { target, do: null, enter: null, commits: false, status: "continue", say: `Choose in ${label}.` };
    case "checkbox":
    case "switch":
      return step("check", `Checking ${label}.`);
    default:
      return step("click", `Clicking ${label}.`);
  }
}
