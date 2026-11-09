import { describe, expect, it } from "vitest";
import { SpeechChunker, speakable } from "../src/chunker.ts";

function chunk(text: string, size = 3): string[] {
  const chunker = new SpeechChunker();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...chunker.push(text.slice(i, i + size)));
  return [...out, ...chunker.flush()];
}

describe("SpeechChunker", () => {
  it("sends the first clause early, then whole sentences", () => {
    expect(chunk("Open your account menu, the T at the top right. Then choose Profile from the list.")).toEqual([
      "Open your account menu,",
      "the T at the top right.",
      "Then choose Profile from the list.",
    ]);
  });

  it("doesn't split on abbreviations or decimals", () => {
    expect(chunk("Pick a plan, e.g. Starter at 3.99 a month. That covers most teams.")).toEqual([
      "Pick a plan, e.g. Starter at 3.99 a month.",
      "That covers most teams.",
    ]);
  });

  it("merges a very short sentence into the next", () => {
    expect(chunk("Click Settings in the sidebar. Done. Now open Developer.")).toEqual([
      "Click Settings in the sidebar.",
      "Done. Now open Developer.",
    ]);
  });

  it("breaks a long first sentence without punctuation at a word", () => {
    const pieces = chunk("Open the organization settings page from the main navigation menu on the left side of the screen");
    expect(pieces[0]!.length).toBeLessThanOrEqual(60);
    expect(pieces.join(" ")).toBe("Open the organization settings page from the main navigation menu on the left side of the screen");
  });
});

describe("speakable", () => {
  it("spells out shortcut symbols and drops markdown", () => {
    expect(speakable("Press **⌘⇧S** to save")).toBe("Press Command Shift S to save");
  });
});
