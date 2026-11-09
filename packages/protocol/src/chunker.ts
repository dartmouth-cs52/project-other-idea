// Splits streaming answer text into pieces for text-to-speech. The first
// piece goes out early, at the first clause break, so audio starts while the
// model is still writing. Later pieces are whole sentences.

const FIRST_MIN = 20;
const FIRST_MAX = 60;
const SHORT = 20;
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|no|approx)\.$/i;

export class SpeechChunker {
  private buffer = "";
  private sentFirst = false;

  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut === -1) break;
      const piece = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (piece) {
        out.push(piece);
        this.sentFirst = true;
      }
    }
    return out;
  }

  /** Whatever is left when the answer ends. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }

  private findCut(): number {
    const text = this.buffer;
    // Sentence ends: punctuation followed by whitespace.
    for (let i = 0; i < text.length - 1; i++) {
      const char = text[i]!;
      if (!".!?".includes(char) || !/\s/.test(text[i + 1]!)) continue;
      const before = text.slice(0, i + 1);
      if (char === "." && (ABBREVIATIONS.test(before) || /\d\.$/.test(before) && /\d/.test(text[i + 2] ?? ""))) continue;
      // Very short sentences ride along with the next one.
      if (before.trim().length < SHORT && this.sentFirst) continue;
      return i + 1;
    }
    if (!this.sentFirst) {
      // First piece: break at a clause once there's enough to say.
      for (let i = FIRST_MIN; i < text.length - 1; i++) {
        if (",;:".includes(text[i]!) && /\s/.test(text[i + 1]!)) return i + 1;
      }
      if (text.length > FIRST_MAX) {
        const space = text.lastIndexOf(" ", FIRST_MAX);
        if (space > FIRST_MIN) return space;
      }
    }
    return -1;
  }
}

/** Make text friendlier to speak: shortcut symbols become words. */
export function speakable(text: string): string {
  return text
    .replace(/⌘/g, "Command ")
    .replace(/⇧/g, "Shift ")
    .replace(/⌥/g, "Option ")
    .replace(/⌃/g, "Control ")
    .replace(/\*\*|__|`|#/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
