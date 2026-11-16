import type { SnapElement, Snapshot, TurnReply } from "../shared/types.ts";

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

/**
 * The control on the page that the sentence tells the visitor to use, when
 * the reply points at nothing. Undefined when the reply points at something,
 * or the sentence names no listed control after a word that says to use it.
 * Whatever the status: "continue" with no pointer means "do this, I'm
 * watching", which is no more right for a control that could be pointed at.
 */
export function namedButNotPointed(snapshot: Snapshot, reply: TurnReply): SnapElement | undefined {
  if (reply.target !== null) return undefined;
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
  return undefined;
}

/**
 * What the model is told when its reply named a control and pointed at
 * nothing, as the next message of the same conversation. It is told what it
 * did, and given both ways out: point at the control, or stop telling the
 * visitor to use one.
 */
export function namedButNotPointedNote(element: SnapElement): string {
  return (
    `Your reply tells the visitor to use ${element.role} "${element.label}" (${element.id}), but its target is null, so nothing is pointed at. ` +
    `If they still have to use it, reply again with ${element.id} as the target and status "continue". ` +
    `If nothing is left for them to use, reply "done" with target null and a sentence that does not tell them to use anything.`
  );
}
