// The widget's two colours, and the rules for each, the same on every site.
//
// The pointer, and the ring around what it points at, are Haptic's blue on
// every site. They are not a setting: a pointer has to be seen against the
// site, and a pointer in the site's own colour can be lost on it. A green
// pointer on a green sidebar was tried, and could hardly be found.
//
// The launcher, the button people press to ask, takes the site's own colour,
// so it looks like part of the site the way a support button does. A colour
// too light to stand out on a white page is darkened until it does, with its
// hue kept. With no colour, the launcher is Ink.
//
// web/lib/colour.ts is a copy for the dashboard's preview, which can't import
// from here. test/colour.test.ts holds the two to the same answers.

/** The pointer and its ring, on every site. */
export const POINTER_BLUE = "#1E6EF4";
/** The launcher when a site has no colour of its own. */
export const INK = "#1C1917";
export const PAPER = "#FAFAF9";
/**
 * How much the launcher must stand out from a white page: 3 to 1, what the
 * Web Content Accessibility Guidelines ask of a control (1.4.11, non-text
 * contrast).
 */
export const LAUNCHER_CONTRAST = 3;

const HEX = /^#?([0-9a-f]{6})$/i;

/** A six-digit hex colour as "#RRGGBB", or null for anything else. */
export function hexColour(text: unknown): string | null {
  const found = typeof text === "string" ? HEX.exec(text.trim()) : null;
  return found ? `#${found[1]!.toUpperCase()}` : null;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** How bright a colour is, from 0 for black to 1 for white, as contrast is worked out from. */
export function luminance(hex: string): number {
  const light = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * light(r) + 0.7152 * light(g) + 0.0722 * light(b);
}

/** The contrast between two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The words and mark on a launcher of this colour: Paper or Ink, whichever is easier to read on it. */
export function inkOn(hex: string): string {
  return contrast(hex, PAPER) >= contrast(hex, INK) ? PAPER : INK;
}

/**
 * The launcher's colour as it is drawn: the site's colour, darkened in small
 * steps with its hue kept until it stands out from a white page, or Ink when
 * the site has none or what was saved is not a colour.
 */
export function launcherColour(saved: unknown): string {
  const hex = hexColour(saved);
  if (!hex) return INK;
  let rgb = channels(hex);
  for (let step = 0; step < 60 && contrast(toHex(rgb), "#FFFFFF") < LAUNCHER_CONTRAST; step++) rgb = rgb.map((channel) => channel * 0.95) as [number, number, number];
  return toHex(rgb);
}
