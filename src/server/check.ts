import { checkAction } from "../shared/act-rules.ts";
import type { SnapElement, Snapshot, TurnReply, TurnRequest } from "../shared/types.ts";

// Checks on a reply before it reaches the visitor. A reply can be well formed
// and still contradict itself: its sentence tells the visitor to use a control
// that is on the page while its pointer is on nothing. Seen on joinhaptic.com,
// three runs in three: "Click FAQ in the top bar to read it", with status
// "done" and no pointer, and the link FAQ listed. The visitor is left to find
// the control the sentence names, and the guide ends there.

/** Words that tell the visitor to use a control, in front of its name. English only: a sentence in another language is never caught. */
const USE = String.raw`(?:click|tap|press|select|choose|pick|open|use|expand|hover over|go to|head to|switch to|fill in|type in|type into)`;
/**
 * Words a little before the instruction that turn it round or make it a
 * description: "don't click Delete" tells the visitor not to, and "It explains
 * how to use Mermaid diagrams" tells them nothing to do (backstage, on a page
 * whose list had a link called Mermaid).
 */
const NOT_AN_INSTRUCTION = /\b(?:not|never|don't|dont|no need to|without|instead of|how to)\b[^.!?]{0,20}$/i;
/** What a control is called when a sentence sends the visitor through it: "open it through the FAQ link in the top bar". */
const THROUGH = String.raw`(?:through|via|using|from)\s+the`;
const KIND = String.raw`(?:link|button|tab|menu|box|field|icon|dropdown|checkbox|toggle|switch)`;
/** The shortest name looked for. A name of one letter would be found inside too many sentences. */
const SHORTEST = 2;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The roles a visitor types into. */
const TYPED = new Set(["textbox", "searchbox", "combobox"]);
/** Words that say to type into a field, a few words before its name: "Try typing Skyline Air in the Search expenses box". Not the key: "press Enter in the Search box". */
const TYPE_IN = String.raw`(?:type|typing|(?<!\b(?:press|pressing|hit|hitting|tap|tapping)\s+)(?:enter|entering)|search|searching)`;

/**
 * The fields the sentence tells the visitor to type into, by their name
 * ("typing Skyline Air in the Search expenses box") or, when the page has
 * one field whose name says it searches, as "the search box" ("Click the
 * search box above the table and type Skyline Air"). Both seen on
 * Northpine's expenses on 16 November, in replies of "stuck".
 */
function fieldsTold(snapshot: Snapshot, say: string): { element: SnapElement; at: number; end: number }[] {
  const found: { element: SnapElement; at: number; end: number }[] = [];
  const fields = snapshot.elements.filter((element) => TYPED.has(element.role) && element.label.trim().length >= SHORTEST);
  const add = (element: SnapElement, at: number, end: number, from: number) => {
    if (!NOT_AN_INSTRUCTION.test(say.slice(0, from))) found.push({ element, at, end });
  };
  for (const field of fields) {
    const name = escape(field.label.trim()).replace(/\s+/g, "\\s+");
    const into = new RegExp(String.raw`\b${TYPE_IN}\b[^.!?;]{0,40}?\b(?:in|into)\s+(?:the\s+)?["“'‘]?(${name})["”'’]?(?:\s+(?:box|field|bar))?(?=$|[\s.,;:!?)])`, "gi");
    for (const match of say.matchAll(into)) {
      const at = match.index + match[0].lastIndexOf(match[1]!);
      add(field, at, at + match[1]!.length, match.index);
    }
  }
  const searching = fields.filter((field) => /\bsearch/i.test(field.label));
  if (searching.length === 1) {
    const box = new RegExp(String.raw`\b(?:${USE}|${TYPE_IN}\s+(?:in|into))\s+(?:on\s+)?(?:the\s+)?search\s+(?:box|field|bar)\b`, "gi");
    for (const match of say.matchAll(box)) add(searching[0]!, match.index, match.index + match[0].length, match.index);
  }
  return found;
}

/**
 * The control on the page that the sentence tells the visitor to use, when
 * the reply points at nothing. Undefined when the reply points at something,
 * or the sentence names no listed control after a word that says to use it.
 * Whatever the status: "continue" with no pointer means "do this, I'm
 * watching", which is no more right for a control that could be pointed at,
 * and "stuck" points at nothing whatever its target, since the widget shows
 * no pointer with it.
 */
export function namedButNotPointed(snapshot: Snapshot, reply: TurnReply): SnapElement | undefined {
  if (reply.target !== null && reply.status !== "stuck") return undefined;
  const say = reply.say;
  // The longest name first, so that "Request access" is found before "Request" when both are listed.
  const named = snapshot.elements
    .filter((element) => element.label.trim().length >= SHORTEST)
    .sort((a, b) => b.label.length - a.label.length);
  for (const element of named) {
    const name = escape(element.label.trim()).replace(/\s+/g, "\\s+");
    const told = new RegExp(String.raw`\b${USE}\s+(?:on\s+)?(?:the\s+)?["“'‘]?${name}["”'’]?(?=$|[\s.,;:!?)])`, "gi");
    const through = new RegExp(String.raw`\b${THROUGH}\s+["“'‘]?${name}["”'’]?\s+${KIND}\b`, "gi");
    for (const match of [...say.matchAll(told), ...say.matchAll(through)]) {
      if (!NOT_AN_INSTRUCTION.test(say.slice(0, match.index))) return element;
    }
  }
  return fieldsTold(snapshot, say)[0]?.element;
}

/**
 * What the model is told when its reply named a control and pointed at
 * nothing, as the next message of the same conversation. It is told what it
 * did, and given both ways out: point at the control, or stop telling the
 * visitor to use one.
 */
export function namedButNotPointedNote(element: SnapElement, status?: TurnReply["status"]): string {
  const why = status === "stuck" ? `its status is "stuck"` : "its target is null";
  return (
    `Your reply tells the visitor to use ${element.role} "${element.label}" (${element.id}), but ${why}, so nothing is pointed at. ` +
    `If they still have to use it, reply again with ${element.id} as the target and status "continue". ` +
    `If nothing is left for them to use, reply "done" with target null and a sentence that does not tell them to use anything.`
  );
}

// The same contradiction after the first step. On Northpine the owner asked
// to add a budget, was led to Budgets, and the guide ended there: "You're on
// the Budgets page now, where every team's budget is listed. To add one, use
// New budget at the top.", "done" and no pointer. Only the first question was
// ever asked again, because once the goal is reached a control named in
// passing is usually an extra, and right as it is: "The left menu is now
// hidden. To bring it back, click Main menu" (grafana), "Click Close when
// you're finished" (jira). In the replies recorded on the 12 tuned apps
// (2,433 single steps and 232 whole-guide steps with their pages, 3,455
// whole-guide steps without), 76 after the first step named a listed control
// with nothing pointed at. Pointing at it would have been right 7 times and
// wrong 69: most came once the goal was reached, or while ParaBank was down.
// Judged as below, none is pointed at, 61 are left as they were (59 of them
// rightly) and 15 are asked about again. So such a reply is judged first:
// - "point": the control is plainly the goal's next step. It is pointed at,
//   with the same sentence and "continue", and no model call is made.
// - "aside": it is named as something optional or for later, or the goal was
//   a question about what the site has and is answered. The reply stands.
// - "ask": anything else. The model is asked once more (namedButNotPointedNote).

/** What is done with a guide's reply whose sentence tells the visitor to use a listed control while nothing is pointed at. */
export type NamedVerdict = "point" | "aside" | "ask";

/**
 * Words that make using the control optional, conditional, for later, or a
 * way back: "if you want", "when you're finished", "to bring it back", "for
 * more". Matched anywhere in the sentence.
 */
const ASIDE = new RegExp(
  [
    String.raw`\b(?:if|unless|whenever|in case|otherwise|optionally|anytime|any time|later|also|meanwhile|in the meantime|for example|for instance)\b`,
    String.raw`\b(?:when|once|after|until|as soon as)\s+(?:you|it)\b`,
    String.raw`\b(?:try again|see more|see the rest|bring it back|get it back|go back|come back)\b`,
    String.raw`(?:^|[.!?;:]\s+)to\s+(?:check|confirm|double-check|verify|review|undo|leave|exit|return)\b`,
    String.raw`\bfor\s+(?:more|the rest|later|other|newer|older)\b`,
  ].join("|"),
  "i",
);
/** Words that say the goal, or something, is already done: "is now hidden", "has been added", "Done.". */
const REACHED = new RegExp(
  [
    String.raw`^\s*(?:done|all set|you're all set|you're set|that's it)\b`,
    String.raw`\b(?:is|are|was|were)\s+now\b`,
    String.raw`\bnow\s+(?:shows?|lists?|has|have|holds?|contains?|open|closed|hidden|showing|listed|selected|filtered|grouped|sorted|applied|in|on|off|set|enabled|disabled|saved|added|created)\b`,
    String.raw`\b(?:has|have)\s+(?:now\s+)?been\b`,
    String.raw`\bshould\s+now\b`,
    String.raw`\b(?:this is it|you're on it|you're already (?:on|there|in))\b`,
    String.raw`\byou(?:'ve| have)?\s+(?:just\s+)?(?:clicked|pressed|selected|added|saved|created|submitted|sent)\b`,
    String.raw`\b(?:confirms|confirmed|successfully)\b`,
  ].join("|"),
  "i",
);
/** Words that say something is missing or failing, so a control named after them may be a way around it rather than the step. */
const UNABLE = /\b(?:can't|cannot|can not|couldn't|could not|unable|isn't|aren't|doesn't|don't see|didn't|won't|hasn't|haven't|no longer|not (?:showing|shown|listed|there|here|available|loaded)|error|failed|still loading)\b/i;
/** Controls that close or leave what is open. Named after the goal is reached, they are how to get out of it. */
const DISMISS = /^(?:close|cancel|back|dismiss|ok|okay|done|no thanks|not now|skip|x|×|back to\b.*)$/i;
/** A goal that asks for a way, though it may start like a question: "How do I…", "where can I…", "I want to…". */
const ASKS_FOR_A_WAY = /\b(?:how (?:do|can|could|would|should|to)|i(?:'d| would)?\s+(?:really\s+|only\s+|just\s+)?(?:want|need|like) to|help me|let me|walk me|take me|show me how|where(?:'s|\s+(?:do|can|could|should|would|is|are)))\b/i;
/** A goal that asks what the site has or shows: "which budgets are over", "is there a cheat sheet of hotkeys?". */
const ASKS_A_FACT = /^\s*(?:what|what's|which|who|who's|whose|when|why|how (?:many|much|long|often|far)|is|are|does|do|did|has|have|can|could|will|would|was|were)\b/i;
/** Words too common to tie a control to a goal: "New budget" and "add a budget" share "budget", not "new" or "add". */
const COMMON = new Set(
  (
    "the and for with from into onto this that these those there here then than what which who how where when why can could would should will does did " +
    "have has had are was were been you your our ours their them they she her him his its mine want need like please just get got make set add new create edit " +
    "change update open close view show see use find take let help put give all any every each more other some one page menu button link tab list item items " +
    "top bottom left right side next back way thing now again also only own not out off about over under after before yes done save"
  ).split(" "),
);

/** A text's words that say what it is about, lower case and without a plural "s". */
function keyWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const stem = (word: string) => (word.endsWith("ies") && word.length > 4 ? `${word.slice(0, -3)}y` : word.endsWith("s") && !word.endsWith("ss") && word.length > 3 ? word.slice(0, -1) : word);
  return new Set(words.filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !COMMON.has(word)).map(stem));
}

/** Whether a control's name shares a word with the goal: "New budget" with "how do I add a budget". */
function namesTheGoal(label: string, goal: string): boolean {
  const wanted = keyWords(goal);
  return [...keyWords(label)].some((word) => wanted.has(word));
}

/** Whether the goal only asks what the site has or shows, which the owner decided an answer in words can finish. */
export function asksForAFact(goal: string): boolean {
  return ASKS_A_FACT.test(goal) && !ASKS_FOR_A_WAY.test(goal);
}

/** Every listed control the sentence tells the visitor to use, in the order the sentence names them. */
function toldToUse(snapshot: Snapshot, say: string): { element: SnapElement; at: number }[] {
  const found: { element: SnapElement; at: number; end: number }[] = [];
  const named = snapshot.elements.filter((element) => element.label.trim().length >= SHORTEST).sort((a, b) => b.label.length - a.label.length);
  for (const element of named) {
    const name = escape(element.label.trim()).replace(/\s+/g, "\\s+");
    const told = new RegExp(String.raw`\b${USE}\s+(?:on\s+)?(?:the\s+)?["“'‘]?${name}["”'’]?(?=$|[\s.,;:!?)])`, "gi");
    const through = new RegExp(String.raw`\b${THROUGH}\s+["“'‘]?${name}["”'’]?\s+${KIND}\b`, "gi");
    for (const match of [...say.matchAll(told), ...say.matchAll(through)]) {
      const end = match.index + match[0].length;
      if (NOT_AN_INSTRUCTION.test(say.slice(0, match.index))) continue;
      if (found.some((other) => match.index < other.end && end > other.at)) continue;
      found.push({ element, at: match.index, end });
    }
  }
  for (const field of fieldsTold(snapshot, say)) if (!found.some((other) => field.at < other.end && field.end > other.at)) found.push(field);
  return found.sort((a, b) => a.at - b.at);
}

/**
 * What to do with a guide's reply, after its first question, whose sentence
 * tells the visitor to use `element` and points at nothing (namedButNotPointed).
 *
 * "point" only when nothing in the reply makes the control anything but the
 * next step: the goal asks for a way, not a fact; the control shares a word
 * with the goal; it is the only control the sentence sends the visitor to,
 * and the first thing that sentence asks of them; nothing says it is
 * optional, for later, already done or failing; the reply is not "stuck";
 * and the control does not close or leave something.
 *
 * "aside" when the sentence makes it optional or for later ("if", "when
 * you're finished", "to bring it back", "for more"), when the goal only asks
 * what the site has and the reply is "done", or when the sentence says
 * something is already done and the control has nothing to do with the goal.
 *
 * "ask" otherwise. On the first question nothing can be done yet, so there a
 * reply is never an aside: it is pointed or asked about, as before. An act
 * reply is also an aside when it leaves a field or a value to the visitor, as
 * namedButNotDone has it.
 */
export function judgeNamed(request: Pick<TurnRequest, "goal" | "step" | "event" | "snapshot" | "mode">, reply: TurnReply, element: SnapElement): NamedVerdict {
  const first = request.step === 0 && !request.event;
  const say = reply.say.replace(/[’‘]/g, "'");
  // An act reply that leaves a field or a value to the visitor is their turn, whatever else it names ("and I'll click Next after").
  if (request.mode === "act" && !first && leavesItToTheVisitor(say, request.snapshot)) return "aside";
  const aside = ASIDE.test(say);
  const fact = asksForAFact(request.goal);
  if (!first && (aside || (fact && reply.status === "done"))) return "aside";
  const reached = REACHED.test(say);
  const ofTheGoal = namesTheGoal(element.label, request.goal);
  const told = toldToUse(request.snapshot, say);
  const at = told.find((one) => one.element === element)?.at ?? -1;
  // The sentence the instruction is in, up to it: something else asked of the visitor there comes first.
  const before = say.slice(0, Math.max(at, 0)).split(/[.!?]\s+/).at(-1) ?? "";
  const asksFirst = new RegExp(String.raw`\bthen\b|(?<!\bto\s)\b(?:${USE}|${ASK_FOR})\b`, "i").test(before);
  const sure =
    reply.status !== "stuck" &&
    !aside &&
    !reached &&
    !fact &&
    ofTheGoal &&
    at >= 0 &&
    !asksFirst &&
    new Set(told.map((one) => one.element.id)).size === 1 &&
    !UNABLE.test(say) &&
    !DISMISS.test(element.label.trim());
  if (sure) return "point";
  if (!first && reached && !ofTheGoal) return "aside";
  return "ask";
}

// In act mode the same contradiction stops the run, at any step. A reply of
// "continue" with nothing pointed at is the visitor's turn on nothing: Haptic
// does nothing, and the visitor is left with nothing to use. Seen on
// Northpine's card wizard in 2 demo runs of 9, on its second page: "Virtual is
// already selected, so I'm skipping that choice. Next to open Limits and
// controls.", with button Next listed. No word in front of Next says to use
// it, so here a control's name counts on its own.

/** The roles of a control that is pressed and holds no value. A field, a list or a choice may be the visitor's to fill in, so it is never one of these. */
const PRESSED = new Set(["button", "link", "tab", "menuitem", "clickable"]);
/** Words with which an act reply says what Haptic does to a control: "Clicking Next". */
const DOING = String.raw`(?:clicking|tapping|pressing|opening|selecting|choosing|using)`;
/** Words that ask the visitor for something, in the plain form a request takes ("Type the amount"), never the form Haptic uses for itself ("Typing 500"). */
const ASK_FOR = String.raw`(?:fill in|fill out|fill|type|enter|choose|pick|select|write|tell|add|upload|attach|set)`;
/** What ends a control's name in a sentence, as for the guide's check: "FAQs" is not "FAQ". */
const NAME_END = String.raw`["”'’]?(?=$|[\s.,;:!?)])`;

const nameIn = (element: SnapElement) => String.raw`["“'‘]?${escape(element.label.trim()).replace(/\s+/g, "\\s+")}`;

/** Whether Haptic could press this control itself: one that holds no value, and that the check every act reply passes would let it click. */
function hapticMayPress(element: SnapElement, request: Pick<TurnRequest, "goal" | "snapshot">, commitWords: readonly string[] | undefined): boolean {
  if (!PRESSED.has(element.role) || (element.state ?? []).includes("opens a list")) return false;
  const press: TurnReply = { target: element.id, do: "click", enter: null, commits: false, status: "continue", say: "" };
  try {
    return !checkAction(press, request, commitWords ? { commitWords } : {}).withheld;
  } catch {
    // What cannot be checked is not offered to the model as something to do.
    return false;
  }
}

/**
 * Whether the sentence leaves something to the visitor on purpose: it asks
 * them a question, it starts by asking them for something ("Type the amount
 * you want"), it tells them they will need to ("you'll need to pick one"), or
 * it asks for something in a listed field or choice ("please type it in Card
 * name"). That is the visitor's turn at a field or a value they did not give,
 * and it is never asked about again.
 */
function leavesItToTheVisitor(say: string, snapshot: Snapshot): boolean {
  if (say.includes("?")) return true;
  const opening = new RegExp(String.raw`(?:^|[.!:;]\s+)(?:(?:please|now|then|just)\s+)?${ASK_FOR}\b`, "i");
  const toYou = new RegExp(String.raw`\byou(?:'ll|’ll| will)?(?:\s+(?:need to|have to|must|can|should|may want to))?\s+${ASK_FOR}\b`, "i");
  if (opening.test(say.trim()) || toYou.test(say)) return true;
  const fields = snapshot.elements.filter((element) => !PRESSED.has(element.role) || (element.state ?? []).includes("opens a list"));
  return fields
    .filter((field) => field.label.trim().length >= SHORTEST)
    .some((field) => new RegExp(String.raw`\b${ASK_FOR}\b[^.!?]*?${nameIn(field)}${NAME_END}`, "i").test(say));
}

/**
 * The control an act reply names while it points at nothing with status
 * "continue", when it is one Haptic could press itself: no field, list or
 * choice, and nothing that commits or that the act check would stop.
 * Undefined for any other reply: one that points at something, the
 * hand-over ("done", `commits` true), and a sentence that leaves a field or
 * a value to the visitor on purpose. A name counts after a word that says
 * to use it or that Haptic is using it ("Clicking Next"), in any case, or
 * on its own when written with the control's own capitals ("Next to open
 * Limits"), and never just after a word that turns it round ("don't click
 * Back"). Of several, one after such a word comes first, and then the one
 * named last: a sentence says what is so before what comes next.
 */
export function namedButNotDone(request: Pick<TurnRequest, "goal" | "snapshot">, reply: TurnReply, commitWords?: readonly string[]): SnapElement | undefined {
  if (reply.target !== null || reply.status !== "continue" || reply.commits === true) return undefined;
  const say = reply.say;
  if (leavesItToTheVisitor(say, request.snapshot)) return undefined;
  const mentions: { element: SnapElement; at: number; end: number; told: boolean }[] = [];
  const free = (at: number, end: number) => mentions.every((mention) => end <= mention.at || at >= mention.end);
  // The longest name first, so that "Request access" is found before "Request" when both are listed.
  const candidates = request.snapshot.elements
    .filter((element) => element.label.trim().length >= SHORTEST && hapticMayPress(element, request, commitWords))
    .sort((a, b) => b.label.length - a.label.length);
  for (const element of candidates) {
    const told = new RegExp(String.raw`\b(?:${USE}|${DOING})\s+(?:on\s+)?(?:the\s+)?(${nameIn(element)})${NAME_END}`, "giu");
    const alone = new RegExp(String.raw`(?<![\p{L}\p{N}_])${nameIn(element)}${NAME_END}`, "gu");
    for (const [pattern, isTold] of [[told, true], [alone, false]] as const) {
      for (const match of say.matchAll(pattern)) {
        if (NOT_AN_INSTRUCTION.test(say.slice(0, match.index))) continue;
        const at = isTold ? match.index + match[0].lastIndexOf(match[1]!) : match.index;
        const end = isTold ? at + match[1]!.length : match.index + match[0].length;
        if (free(at, end)) mentions.push({ element, at, end, told: isTold });
      }
    }
  }
  const told = mentions.filter((mention) => mention.told);
  const pick = (told.length ? told : mentions).sort((a, b) => b.at - a.at)[0];
  return pick?.element;
}

/**
 * What the model is told when its act reply named a control Haptic could
 * press and pointed at nothing with "continue". As with the guide's note, it
 * is told what it did and given the ways out: do the step, leave a field to
 * the visitor by pointing at it, or end.
 */
export function namedButNotDoneNote(element: SnapElement): string {
  return (
    `Your reply names ${element.role} "${element.label}" (${element.id}), but its target is null and its status "continue", so nothing is done and the visitor is left with nothing to use. ` +
    `If using it is the next step, reply again with ${element.id} as the target, the "do" for it and status "continue". ` +
    `If the visitor has to fill something in first, point at that field with "do" null. ` +
    `If nothing is left to do, reply "done" with target null and a sentence that does not name a control to use.`
  );
}

// In act mode the model sometimes writes a step as a guide would: it points
// at a control Haptic could press, with "do" null, and tells the visitor to
// click it. On Northpine's card wizard, at its Limits page, 2 demo runs of
// the last 3 gave the visitor a turn for "Click Next to go to the Review
// step. The $500 monthly limit is set.", on button Next, and earlier rounds
// did the same. When that press is all the sentence asks of the visitor, the
// server makes the step Haptic's: "do" becomes "click", and the sentence
// says that Haptic does it ("Clicking Next to go to the Review step."). No
// model call is made for it. The widget's gate judges the press as it
// judges every other, so a control that commits is still never pressed.

/** The words with which a sentence tells the visitor to press a control, and how Haptic says it does the same. */
const PRESS: Record<string, string> = { click: "clicking", tap: "tapping", press: "pressing" };
/** Where an instruction can begin: a sentence, a clause after a comma, colon or semicolon, or after "so" or "and". */
const CLAUSE = String.raw`(?<=^|[.!?…]["'”’)]*\s+|[,;:]\s+|\b(?:so|and)\s+)`;
/** What ends the sentence before an instruction that opens the next one. */
const SENTENCE_BEFORE = /(?:^|[.!?…]["'”’)]*\s+)$/;
/** Words that leave the visitor to judge or change something: "Check that the limit is right". */
const JUDGE = String.raw`(?:check|make sure|verify|confirm|double[- ]check|review|look over|ensure|decide|change|edit|adjust|correct|fix|tick|untick|uncheck|toggle|turn on|turn off)`;
/** Words that make the step a choice, or leave it to the visitor's wish or time: "or Back", "if you want", "then", "when you're ready". */
const NOT_ONLY_THE_PRESS = /\b(?:if|unless|whether|or|either|instead|optional|optionally|then)\b|\b(?:when|once|after|before|until|as soon as)\s+you\b/i;

/**
 * Whether a sentence, once its instruction to press is written as Haptic's,
 * still leaves something to the visitor: a question, a value or a field, as
 * for namedButNotDone; a choice, a wish or a time ("or", "if you want",
 * "when you're ready"); something after it ("then"); or anything else to
 * use, fill in, pick or check, asked of them or said to be theirs ("where
 * you can choose Virtual").
 */
function stillLeavesSomething(say: string, snapshot: Snapshot): boolean {
  if (leavesItToTheVisitor(say, snapshot) || NOT_ONLY_THE_PRESS.test(say)) return true;
  const verbs = String.raw`(?:${USE}|${ASK_FOR}|${JUDGE})\b`;
  const asked = new RegExp(String.raw`${CLAUSE}(?:(?:please|just|now|also|first)\s+)*${verbs}`, "i");
  const theirs = new RegExp(String.raw`\byou(?:'ll|’ll| will)?(?:\s+(?:need to|have to|must|can|could|should|may want to|might want to|want to))?\s+${verbs}`, "i");
  return asked.test(say) || theirs.test(say);
}

/**
 * The press an act reply leaves to the visitor that Haptic could make
 * itself, with the sentence written as Haptic's own. Undefined unless the
 * reply has status "continue", points at a listed control, has "do" null and
 * "commits" not true, and is not the answer to a closing question; the
 * control is one Haptic could press (no field, list or choice, and nothing
 * that commits or that the act check would stop); and the sentence tells the
 * visitor to click, tap or press that control by its name, once, and asks
 * nothing else of them. Only the instruction is changed: "Click Next to go
 * on." becomes "Clicking Next to go on.", and "The limit is set, so click
 * Next." becomes "The limit is set, so I'm clicking Next."
 */
export function pressLeftToVisitor(
  request: Pick<TurnRequest, "goal" | "snapshot" | "closing">,
  reply: TurnReply,
  commitWords?: readonly string[],
): { element: SnapElement; say: string } | undefined {
  if (reply.status !== "continue" || reply.target === null || reply.do || reply.commits === true || request.closing) return undefined;
  const element = request.snapshot.elements.find((listed) => listed.id === reply.target);
  if (!element || element.label.trim().length < SHORTEST || !hapticMayPress(element, request, commitWords)) return undefined;
  const say = reply.say;
  // One instruction to press: in "Click Next, and click Issue card after" the second press is still the visitor's.
  if ((say.match(/\b(?:click|tap|press)\b/gi) ?? []).length !== 1) return undefined;
  const told = new RegExp(String.raw`${CLAUSE}(?:(?:please|just|now)\s+)*(click|tap|press)\s+(?:on\s+)?(?:the\s+)?${nameIn(element)}${NAME_END}`, "iu").exec(say);
  if (!told || NOT_AN_INSTRUCTION.test(say.slice(0, told.index))) return undefined;
  const verb = told[1]!;
  const doing = PRESS[verb.toLowerCase()]!;
  const end = told.index + told[0].indexOf(verb) + verb.length;
  const ours = SENTENCE_BEFORE.test(say.slice(0, told.index)) ? doing[0]!.toUpperCase() + doing.slice(1) : `I'm ${doing}`;
  const rewritten = say.slice(0, told.index) + ours + say.slice(end);
  return stillLeavesSomething(rewritten, request.snapshot) ? undefined : { element, say: rewritten };
}
