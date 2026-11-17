// What a site looks like from outside: its icon, and the one colour it calls
// its own. The dashboard shows the icon beside the site's name, and "Match my
// site" in Settings sets the pointer to the colour.
//
// Both are read from the site's first page and the stylesheets it links, the
// same public files any visitor's browser fetches. Nothing is kept here: the
// dashboard asks when it needs to, and the colour is saved only when the
// person presses the button.
//
// The colour is looked for where a site says it outright, in this order:
//   1. a custom property named for it, such as --brand, --primary or --accent
//   2. <meta name="theme-color">
//   3. theme_color in the web app manifest
//   4. the fill of an SVG icon
//   5. failing all of those, the colour the stylesheets use most
// A grey, a near white or a near black is never the answer, because the
// pointer has to be seen on any page. A site whose only colours are those gets
// no answer, and the dashboard says so.

const USER_AGENT = "HapticReader/1.0 (+https://joinhaptic.com)";
const TIMEOUT_MS = 8_000;
const MAX_HTML = 600_000;
const MAX_CSS = 800_000;
/** Stylesheets read, in the order the page links them. A site's own colours are nearly always in the first. */
const MAX_SHEETS = 4;

export interface Brand {
  /** The address of the site's icon, as its first page declares it. Null when it declares none. */
  icon: string | null;
  /** The site's colour as #RRGGBB, or null when none that would do for the pointer was found. */
  colour: string | null;
  /** Where the colour was found. */
  from: "stylesheet" | "theme-color" | "manifest" | "icon" | null;
}

// Reading tags -----------------------------------------------------------------

/** The attributes of every tag of one kind, such as each <link>, with names in lower case. */
export function tagsOf(html: string, name: string): Record<string, string>[] {
  const tags = html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
  return tags.map((tag) => {
    const attributes: Record<string, string> = {};
    for (const found of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attributes[found[1]!.toLowerCase()] = found[2] ?? found[3] ?? found[4] ?? "";
    }
    return attributes;
  });
}

function resolve(href: string | undefined, base: string): string | null {
  if (!href || /^data:/i.test(href.trim())) return null;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The icon a page declares. An SVG is taken first, since it is sharp at any
 * size, then the largest plain icon, then the one a phone's home screen uses.
 */
export function iconFrom(html: string, base: string): string | null {
  const links = tagsOf(html, "link").filter((link) => /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(link.rel ?? ""));
  const size = (link: Record<string, string>) => Number(/(\d+)x\d+/i.exec(link.sizes ?? "")?.[1] ?? 0);
  const rank = (link: Record<string, string>) => {
    const svg = /svg/i.test(link.type ?? "") || /\.svg(\?|#|$)/i.test(link.href ?? "");
    const touch = /apple-touch-icon/i.test(link.rel ?? "");
    return (svg && !touch ? 100_000 : 0) + (touch ? 0 : 10_000) + size(link);
  };
  for (const link of [...links].sort((a, b) => rank(b) - rank(a))) {
    const url = resolve(link.href, base);
    if (url) return url;
  }
  return null;
}

// Colours ----------------------------------------------------------------------

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((part) => Math.round(clamp(part) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** A number as CSS writes it: plain, or a percentage of `whole`. */
function amount(text: string, whole: number): number {
  return text.trim().endsWith("%") ? (parseFloat(text) / 100) * whole : parseFloat(text);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const part = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [part(0), part(8), part(4)];
}

/** OKLCH, as Tailwind 4 and shadcn write colours, to sRGB. Anything outside what a screen can show is brought to its edge. */
function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const cube = (value: number) => value ** 3;
  const long = cube(l + 0.3963377774 * a + 0.2158037573 * b);
  const medium = cube(l - 0.1055613458 * a - 0.0638541728 * b);
  const short = cube(l - 0.0894841775 * a - 1.291485548 * b);
  const linear = [4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short, -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short, -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short];
  const gamma = (value: number) => (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055);
  return [gamma(linear[0]!), gamma(linear[1]!), gamma(linear[2]!)];
}

/**
 * One CSS colour as #RRGGBB: a hex, rgb(), hsl() or oklch(). Null for anything
 * else, a see-through colour included, since half of a colour is not the
 * site's colour.
 */
export function colourToHex(input: string): string | null {
  const text = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && hex[3] !== "f") return null;
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase();
    }
    if (hex.length === 6) return `#${hex}`.toUpperCase();
    if (hex.length === 8) return hex.endsWith("ff") ? `#${hex.slice(0, 6)}`.toUpperCase() : null;
    return null;
  }
  const call = /^(rgba?|hsla?|oklch)\(([^()]*)\)$/.exec(text);
  if (!call) return null;
  const [body = "", alpha] = call[2]!.split("/");
  const parts = body.split(/[\s,]+/).filter(Boolean);
  // The old form puts the alpha fourth, after a comma.
  const opacity = alpha ?? (parts.length === 4 ? parts.pop() : undefined);
  if (opacity !== undefined && amount(opacity, 1) < 0.999) return null;
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(parseFloat(part)))) return null;
  if (call[1]!.startsWith("rgb")) return toHex(amount(parts[0]!, 255) / 255, amount(parts[1]!, 255) / 255, amount(parts[2]!, 255) / 255);
  if (call[1]!.startsWith("hsl")) return toHex(...hslToRgb(((parseFloat(parts[0]!) % 360) + 360) % 360, clamp(amount(parts[1]!, 1)), clamp(amount(parts[2]!, 1))));
  return toHex(...oklchToRgb(clamp(amount(parts[0]!, 1)), amount(parts[1]!, 0.4), parseFloat(parts[2]!)));
}

/**
 * Whether a colour would do for the pointer: a real colour, not a grey, and
 * neither so light nor so dark that it is lost against a page. The pointer's
 * white border and shadow do the rest.
 */
export function isBrandColour(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation >= 0.25 && lightness >= 0.15 && lightness <= 0.78;
}

const usable = (text: string | undefined): string | null => {
  const hex = text ? colourToHex(text) : null;
  return hex && isBrandColour(hex) ? hex : null;
};

/** The words in a custom property's name that say it is the site's colour, strongest first. */
const NAMED = ["brand", "primary", "accent", "theme"];
/** And the words that say it is something drawn on or beside that colour. */
const NOT_IT = /(^|-)(foreground|fg|ink|text|on|contrast|soft|subtle|muted|hover|active|focus|ring|border|bg|background|surface|dark|light|shadow|gradient)(-|$)/;

/**
 * The site's colour as its stylesheets name it. A custom property called
 * --brand outranks --primary, which outranks --accent, and the first one
 * written wins a tie, since that is the light theme. A property that points
 * at another, as Tailwind's theme does, is followed.
 */
export function brandColourFromCss(css: string): string | null {
  const first = new Map<string, string>();
  const order: string[] = [];
  for (const found of css.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)/g)) {
    const name = found[1]!.toLowerCase();
    if (first.has(name)) continue;
    first.set(name, found[2]!.trim());
    order.push(name);
  }
  const valueOf = (name: string, depth = 0): string | null => {
    const value = first.get(name);
    if (!value) return null;
    const pointer = /^var\(\s*--([a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)$/.exec(value);
    if (pointer) return depth < 4 ? valueOf(pointer[1]!.toLowerCase(), depth + 1) : null;
    // shadcn's older themes write a bare "222 47% 11%", meant for hsl().
    return usable(value) ?? (/^[\d.]+(deg)?[\s,]+[\d.]+%[\s,]+[\d.]+%$/.test(value) ? usable(`hsl(${value})`) : null);
  };
  let best: { colour: string; score: number } | null = null;
  for (const name of order) {
    if (NOT_IT.test(name)) continue;
    const score = NAMED.findIndex((word) => new RegExp(`(^|-)${word}(-|$)`).test(name));
    if (score < 0) continue;
    const colour = valueOf(name);
    if (colour && (!best || NAMED.length - score > best.score)) best = { colour, score: NAMED.length - score };
  }
  return best?.colour ?? null;
}

/** The colour the stylesheets write most often, if any colour that would do is written more than once. The last thing tried. */
export function commonColourFromCss(css: string): string | null {
  const counts = new Map<string, number>();
  for (const found of css.matchAll(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\([^()]*\)/g)) {
    const colour = usable(found[0]);
    if (colour) counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }
  const [most] = [...counts].sort((a, b) => b[1] - a[1]);
  return most && most[1] > 1 ? most[0] : null;
}

/** The first colour an SVG is filled with that would do. */
export function colourFromSvg(svg: string): string | null {
  for (const found of svg.matchAll(/(?:fill|stop-color)\s*[=:]\s*["']?\s*(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch)\([^()]*\))/g)) {
    const colour = usable(found[1]);
    if (colour) return colour;
  }
  return null;
}

// Fetching ---------------------------------------------------------------------

/** A public file as text, or null when it can't be had. Never more than `most` characters of it. */
async function textOf(url: string, most: number, accept: string): Promise<{ text: string; url: string } | null> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return { text: (await response.text()).slice(0, most), url: response.url || url };
  } catch {
    return null;
  }
}

/**
 * A site's icon and colour, from its first page. It never throws: a site that
 * can't be reached, or that says nothing about itself, gets nulls.
 */
export async function siteBrand(origin: string): Promise<Brand> {
  const page = await textOf(`${origin.replace(/\/+$/, "")}/`, MAX_HTML, "text/html");
  if (!page) return { icon: null, colour: null, from: null };
  const html = page.text;
  const icon = iconFrom(html, page.url);

  const sheets = tagsOf(html, "link")
    .filter((link) => /(^|\s)stylesheet(\s|$)/i.test(link.rel ?? ""))
    .map((link) => resolve(link.href, page.url))
    .filter((url): url is string => url !== null)
    .slice(0, MAX_SHEETS);
  const manifestAt = resolve(tagsOf(html, "link").find((link) => /(^|\s)manifest(\s|$)/i.test(link.rel ?? ""))?.href, page.url);
  const svgIcon = icon && /\.svg(\?|#|$)/i.test(icon) ? icon : null;

  const [fetched, manifest, svg] = await Promise.all([
    Promise.all(sheets.map((url) => textOf(url, MAX_CSS, "text/css"))),
    manifestAt ? textOf(manifestAt, 100_000, "application/manifest+json, application/json") : null,
    svgIcon ? textOf(svgIcon, 100_000, "image/svg+xml") : null,
  ]);
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((found) => found[1] ?? "");
  // The page's own <style> blocks come after its stylesheets in the cascade, but a name is a name wherever it is written.
  const css = [...fetched.map((sheet) => sheet?.text ?? ""), ...inline].join("\n");

  const named = brandColourFromCss(css);
  if (named) return { icon, colour: named, from: "stylesheet" };

  for (const meta of tagsOf(html, "meta")) {
    if ((meta.name ?? "").toLowerCase() !== "theme-color") continue;
    const colour = usable(meta.content);
    if (colour) return { icon, colour, from: "theme-color" };
  }
  if (manifest) {
    try {
      const colour = usable((JSON.parse(manifest.text) as { theme_color?: string }).theme_color);
      if (colour) return { icon, colour, from: "manifest" };
    } catch {
      // Not a manifest after all.
    }
  }
  const drawn = svg ? colourFromSvg(svg.text) : null;
  if (drawn) return { icon, colour: drawn, from: "icon" };
  const common = commonColourFromCss(css);
  return common ? { icon, colour: common, from: "stylesheet" } : { icon, colour: null, from: null };
}
