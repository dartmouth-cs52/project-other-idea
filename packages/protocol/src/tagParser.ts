// Streaming parser for the model's reply. The model writes plain text with a
// few inline tags: <point id="e3"/>, <wait/>, <done/>. Deltas can split a tag
// anywhere, so anything that might still become a tag is held back until it
// either closes or stops looking like one.

export type ParsedEvent =
  | { type: "text"; text: string }
  | { type: "point"; id: string; label?: string }
  | { type: "wait" }
  | { type: "done" };

/** Tags we act on, plus tags reserved for later that we swallow silently. */
const KNOWN_TAGS = ["point", "wait", "done", "click", "type", "navigate", "scroll"];
const MAX_TAG_LENGTH = 200;

export class TagStreamParser {
  private buffer = "";

  push(delta: string): ParsedEvent[] {
    this.buffer += delta;
    const out: ParsedEvent[] = [];

    while (this.buffer.length > 0) {
      const lt = this.buffer.indexOf("<");
      if (lt === -1) {
        emitText(out, this.buffer);
        this.buffer = "";
        break;
      }
      if (lt > 0) {
        emitText(out, this.buffer.slice(0, lt));
        this.buffer = this.buffer.slice(lt);
      }

      const gt = this.buffer.indexOf(">");
      if (gt === -1) {
        if (couldBecomeTag(this.buffer)) break;
        emitText(out, "<");
        this.buffer = this.buffer.slice(1);
        continue;
      }

      const tag = parseTag(this.buffer.slice(0, gt + 1));
      if (tag === undefined) {
        // Not one of our tags, e.g. "a < b > c". Keep the "<" as text.
        emitText(out, "<");
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (tag) out.push(tag);
      this.buffer = this.buffer.slice(gt + 1);
    }

    return out;
  }

  /** Flush at end of stream. An unfinished tag is dropped rather than spoken. */
  end(): ParsedEvent[] {
    const rest = this.buffer;
    this.buffer = "";
    if (!rest || couldBecomeTag(rest)) return [];
    const out: ParsedEvent[] = [];
    emitText(out, rest);
    return out;
  }
}

/** Convenience for tests and non-streaming callers. */
export function parseAll(text: string): ParsedEvent[] {
  const parser = new TagStreamParser();
  return mergeText([...parser.push(text), ...parser.end()]);
}

/** Merge adjacent text events so split deltas compare equal to whole input. */
export function mergeText(events: ParsedEvent[]): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (ev.type === "text" && last?.type === "text") {
      out[out.length - 1] = { type: "text", text: last.text + ev.text };
    } else {
      out.push(ev);
    }
  }
  return out;
}

function emitText(out: ParsedEvent[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** Could this unterminated "<..." still turn into one of our tags? */
function couldBecomeTag(partial: string): boolean {
  if (partial.length > MAX_TAG_LENGTH) return false;
  const match = /^<\/?\s*([a-zA-Z]*)([\s\S]*)$/.exec(partial);
  if (!match) return false;
  const name = (match[1] ?? "").toLowerCase();
  const rest = match[2] ?? "";
  if (rest === "") return KNOWN_TAGS.some((tag) => tag.startsWith(name));
  return KNOWN_TAGS.includes(name) && /^[\s/]/.test(rest);
}

/**
 * Returns the event for a complete tag, null for a known tag we ignore
 * (closing tags, reserved actions, a point without an id), or undefined when
 * the text isn't one of our tags at all.
 */
function parseTag(raw: string): ParsedEvent | null | undefined {
  const match = /^<(\/?)\s*([a-zA-Z]+)([^<>]*?)\/?\s*>$/.exec(raw);
  if (!match) return undefined;
  const closing = match[1] === "/";
  const name = (match[2] ?? "").toLowerCase();
  if (!KNOWN_TAGS.includes(name)) return undefined;
  if (closing) return null;

  const attrs = parseAttributes(match[3] ?? "");
  switch (name) {
    case "point":
      return attrs.id ? { type: "point", id: attrs.id, ...(attrs.label ? { label: attrs.label } : {}) } : null;
    case "wait":
      return { type: "wait" };
    case "done":
      return { type: "done" };
    default:
      return null;
  }
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
  for (const m of source.matchAll(pattern)) {
    const key = (m[1] ?? "").toLowerCase();
    attrs[key] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return attrs;
}

/** Remove tags from finished text, e.g. for history or copy-to-clipboard. */
export function stripTags(text: string): string {
  return mergeText(parseAll(text))
    .map((ev) => (ev.type === "text" ? ev.text : ""))
    .join("")
    .trim();
}
