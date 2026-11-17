import assert from "node:assert/strict";
import { test } from "node:test";
import { contrast, hexColour, inkOn, INK, launcherColour, LAUNCHER_CONTRAST, PAPER, POINTER_BLUE } from "../src/shared/colour.ts";
import * as dashboard from "../web/lib/colour.ts";

// The widget's colours: the pointer is Haptic's blue everywhere, and the
// launcher takes the site's colour, darkened when it is too light to see.

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

test("a launcher colour dark enough already is drawn as it is", () => {
  assert.equal(launcherColour("#17633A"), "#17633A", "Northpine's green");
  assert.equal(launcherColour("#1e6ef4"), "#1E6EF4");
  assert.equal(launcherColour(INK), INK);
});

test("a launcher colour too light to see on a white page is darkened until it is, with its hue kept", () => {
  for (const light of ["#FACC15", "#5EEAD4", "#93C5FD", "#F9A8D4", "#FDE68A"]) {
    assert.ok(contrast(light, "#FFFFFF") < LAUNCHER_CONTRAST, `${light} is a light colour to begin with`);
    const drawn = launcherColour(light);
    assert.ok(contrast(drawn, "#FFFFFF") >= LAUNCHER_CONTRAST, `${light} drawn as ${drawn}, ${contrast(drawn, "#FFFFFF").toFixed(2)} to 1`);
    assert.ok(contrast(drawn, "#FFFFFF") < LAUNCHER_CONTRAST + 0.5, `${light} is darkened only as far as it has to be, to ${drawn}`);
    assert.ok(Math.abs(hue(drawn) - hue(light)) < 3, `${light} keeps its hue as ${drawn}`);
  }
});

test("a launcher with no colour, or a saved value that is not one, is Ink", () => {
  for (const nothing of [undefined, null, "", "green", "#FFF", "#17633A80", "url(x)", 42]) assert.equal(launcherColour(nothing), INK, String(nothing));
});

test("the words on a launcher are Paper or Ink, whichever reads better", () => {
  assert.equal(inkOn(INK), PAPER);
  assert.equal(inkOn("#17633A"), PAPER);
  assert.equal(inkOn("#FACC15"), INK, "on a yellow, Ink");
  assert.equal(hexColour(" #1e6ef4 "), POINTER_BLUE);
});

test("the dashboard's copy gives the same answers as the widget's", () => {
  for (const name of ["POINTER_BLUE", "INK", "PAPER", "LAUNCHER_CONTRAST"] as const) assert.equal(dashboard[name], { POINTER_BLUE, INK, PAPER, LAUNCHER_CONTRAST }[name], name);
  for (const colour of ["#17633A", "#FACC15", "#5EEAD4", "#93C5FD", "#FFFFFF", "#000000", INK, POINTER_BLUE, "#3366CC", "nope", ""]) {
    assert.equal(dashboard.launcherColour(colour), launcherColour(colour), `launcherColour(${colour})`);
    if (hexColour(colour)) assert.equal(dashboard.inkOn(hexColour(colour)!), inkOn(hexColour(colour)!), `inkOn(${colour})`);
  }
});
