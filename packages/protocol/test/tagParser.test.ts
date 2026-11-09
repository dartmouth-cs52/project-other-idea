import { describe, expect, it } from "vitest";
import { mergeText, parseAll, stripTags, TagStreamParser, type ParsedEvent } from "../src/tagParser.ts";

function feed(chunks: string[]): ParsedEvent[] {
  const parser = new TagStreamParser();
  const events: ParsedEvent[] = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  events.push(...parser.end());
  return mergeText(events);
}

function randomSplits(text: string, seed: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  let state = seed;
  while (i < text.length) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const size = 1 + (state % 9);
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
}

const FIXTURES = [
  '<point id="e3"/>Open your account menu, the "T" button at the top right.<wait/>',
  'Click <point id="e12" label="Settings"/>Settings, then <point id=\'e14\' />Developer.',
  "That's it. <done/>",
  "Use a < b and c > d comparisons freely.",
  "<point id=e7>Click Save.</point><wait>",
  "Prices go from <5 to >10 here.",
  "<POINT ID=\"e2\" /> Upper case works.<Wait />",
];

describe("TagStreamParser", () => {
  it("parses points, waits and done", () => {
    expect(parseAll(FIXTURES[0]!)).toEqual([
      { type: "point", id: "e3" },
      { type: "text", text: 'Open your account menu, the "T" button at the top right.' },
      { type: "wait" },
    ]);
    expect(parseAll(FIXTURES[2]!)).toEqual([{ type: "text", text: "That's it. " }, { type: "done" }]);
  });

  it("keeps labels and handles unquoted and single-quoted ids", () => {
    const events = parseAll(FIXTURES[1]!);
    expect(events.filter((e) => e.type === "point")).toEqual([
      { type: "point", id: "e12", label: "Settings" },
      { type: "point", id: "e14" },
    ]);
  });

  it("leaves text that only looks like markup alone", () => {
    expect(parseAll(FIXTURES[3]!)).toEqual([{ type: "text", text: FIXTURES[3] }]);
    expect(parseAll(FIXTURES[5]!)).toEqual([{ type: "text", text: FIXTURES[5] }]);
  });

  it("drops closing tags and accepts open-style tags", () => {
    expect(parseAll(FIXTURES[4]!)).toEqual([{ type: "point", id: "e7" }, { type: "text", text: "Click Save." }, { type: "wait" }]);
    expect(parseAll(FIXTURES[6]!)).toEqual([{ type: "point", id: "e2" }, { type: "text", text: " Upper case works." }, { type: "wait" }]);
  });

  it("gives the same events however the stream is split", () => {
    for (const fixture of FIXTURES) {
      const whole = parseAll(fixture);
      expect(feed(fixture.split(""))).toEqual(whole);
      for (let seed = 1; seed <= 25; seed++) expect(feed(randomSplits(fixture, seed))).toEqual(whole);
    }
  });

  it("never emits a partial tag as text while streaming", () => {
    const parser = new TagStreamParser();
    expect(parser.push('Click <poi')).toEqual([{ type: "text", text: "Click " }]);
    expect(parser.push('nt id="e1"')).toEqual([]);
    expect(parser.push("/>now")).toEqual([{ type: "point", id: "e1" }, { type: "text", text: "now" }]);
  });

  it("drops an unfinished tag at the end instead of speaking it", () => {
    expect(feed(["Almost there <point id="])).toEqual([{ type: "text", text: "Almost there " }]);
  });

  it("ignores reserved action tags and points without an id", () => {
    expect(parseAll('<click id="e1"/>Saved.<point/>')).toEqual([{ type: "text", text: "Saved." }]);
  });
});

describe("stripTags", () => {
  it("leaves only the text", () => {
    expect(stripTags('<point id="e3"/>Open the menu.<wait/>')).toBe("Open the menu.");
  });
});
