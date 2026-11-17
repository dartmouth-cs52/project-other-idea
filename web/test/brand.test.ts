import assert from "node:assert/strict";
import { test } from "node:test";
import { brandColourFromCss, colourFromSvg, colourToHex, commonColourFromCss, iconFrom, isBrandColour, tagsOf } from "../worker/brand";

// A site's icon and colour, read from what its first page says. These check the
// parts that decide. The fetching around them is a few lines.

test("a colour written any of the usual ways comes out as one hex", () => {
  assert.equal(colourToHex("#17633a"), "#17633A");
  assert.equal(colourToHex("#1af"), "#11AAFF");
  assert.equal(colourToHex("#17633AFF"), "#17633A");
  assert.equal(colourToHex("rgb(23, 99, 58)"), "#17633A");
  assert.equal(colourToHex("rgb(23 99 58 / 100%)"), "#17633A");
  assert.equal(colourToHex("hsl(148, 62%, 24%)"), "#17633B");
  assert.equal(colourToHex("oklch(0.6231 0.188 259.81)"), "#3B82F6", "Tailwind's blue-500");
  assert.equal(colourToHex("#17633a80"), null, "half of a colour is not the site's colour");
  assert.equal(colourToHex("rgba(23, 99, 58, 0.5)"), null);
  assert.equal(colourToHex("var(--brand)"), null);
  assert.equal(colourToHex("transparent"), null);
});

test("a grey, a near white and a near black won't do for the pointer", () => {
  assert.ok(isBrandColour("#17633A"));
  assert.ok(isBrandColour("#1E6EF4"));
  assert.equal(isBrandColour("#FFFFFF"), false);
  assert.equal(isBrandColour("#1C1917"), false, "Haptic's own Ink");
  assert.equal(isBrandColour("#78716C"), false, "a grey");
  assert.equal(isBrandColour("#E5F2EA"), false, "a tint too light to see");
});

test("the colour a stylesheet names as the site's own is found, and what is drawn on it is not", () => {
  const northpine = `:root{--np-bg:#f6f7f6;--np-ink:#18201c;--np-brand:#17633a;--np-brand-ink:#ffffff;--np-brand-soft:#e5f2ea;--np-danger:#b42318}.dark{--np-brand:#4ade80}`;
  assert.equal(brandColourFromCss(northpine), "#17633A", "the first one written, which is the light theme");
  assert.equal(brandColourFromCss(`:root{--accent:#f97316;--primary:#2563eb}`), "#2563EB", "primary outranks accent whichever comes first");
  assert.equal(brandColourFromCss(`:root{--color-brand:var(--np-brand);--np-brand:#17633a}`), "#17633A", "a name that points at another is followed");
  assert.equal(brandColourFromCss(`:root{--primary:222.2 47.4% 41.2%}`), "#37559B", "shadcn's bare numbers, meant for hsl()");
  assert.equal(brandColourFromCss(`:root{--primary:oklch(0.205 0 0);--primary-foreground:oklch(0.985 0 0)}`), null, "a site whose primary is black has no colour to give");
  assert.equal(brandColourFromCss(`a{color:#2563eb}`), null, "nothing is named");
});

test("with nothing named, the colour written most often is taken, and only if it is written more than once", () => {
  assert.equal(commonColourFromCss(`a{color:#2563eb}.b{background:#2563eb}.c{color:#f97316}p{color:#111}h1{color:#111}`), "#2563EB");
  assert.equal(commonColourFromCss(`a{color:#2563eb}`), null);
});

test("the icon a page declares is found, an SVG before a plain one", () => {
  const demo = `<head><link rel="icon" href="/favicon.svg" type="image/svg+xml" /><title>Northpine</title></head>`;
  assert.equal(iconFrom(demo, "https://demo.joinhaptic.com/"), "https://demo.joinhaptic.com/favicon.svg");
  const several = `<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" sizes="16x16" href="/16.png"><link rel="icon" sizes="32x32" href=/32.png><link rel='shortcut icon' href='https://cdn.example.com/f.ico'>`;
  assert.equal(iconFrom(several, "https://app.example.com/"), "https://app.example.com/32.png", "the largest plain icon");
  assert.equal(iconFrom(`<link rel="apple-touch-icon" href="/touch.png">`, "https://a.example/"), "https://a.example/touch.png");
  assert.equal(iconFrom(`<link rel="stylesheet" href="/a.css">`, "https://a.example/"), null);
  assert.equal(iconFrom(`<link rel="icon" href="data:image/png;base64,AAAA">`, "https://a.example/"), null, "an icon written into the page has no address to give");
  assert.deepEqual(tagsOf(`<META Name=theme-color content='#17633a'>`, "meta"), [{ name: "theme-color", content: "#17633a" }]);
});

test("an SVG icon's own colour is read from its fill", () => {
  assert.equal(colourFromSvg(`<svg><rect width="32" height="32" rx="7" fill="#14532d"/><path d="M0 0" fill="#fff"/></svg>`), "#14532D");
  assert.equal(colourFromSvg(`<svg><path fill="#fff"/><path fill="currentColor"/></svg>`), null);
});
