// Haptic's UI is black and white by default. The pointer and highlight take
// whichever of the two stands out against what's directly under them, and the
// caption, Ask bar and launcher take the opposite of the page's own tone, so
// they read like a tooltip on any site.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Parses the rgb()/rgba() strings getComputedStyle returns. */
export function parseColor(value: string): (Rgb & { a: number }) | undefined {
  const match = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/);
  if (!match) return undefined;
  const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
}

/** WCAG relative luminance, 0 for black to 1 for white. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** True when white text or a white pointer has more contrast on this color than black does. */
export function isDark(color: Rgb): boolean {
  const l = luminance(color);
  return 1.05 / (l + 0.05) > (l + 0.05) / 0.05;
}

/**
 * The background color painted behind a point, found by walking up from the
 * topmost element there to the first mostly opaque background. Translucent
 * layers on the way are blended in. Images and gradients can't be read, so
 * those count as the color beneath them.
 */
export function backgroundAt(x: number, y: number, ignore: Element): Rgb {
  const hit = document.elementsFromPoint(x, y).find((el) => el !== ignore && !ignore.contains(el));
  const layers: (Rgb & { a: number })[] = [];
  for (let el: Element | null = hit ?? null; el; el = el.parentElement ?? ((el.getRootNode() as ShadowRoot).host || null)) {
    const color = parseColor(getComputedStyle(el).backgroundColor);
    if (!color || color.a === 0) continue;
    layers.push(color);
    if (color.a >= 0.95) break;
  }
  // Paint from the bottom up, starting on white like a browser's canvas.
  let result = WHITE;
  for (const layer of layers.reverse()) {
    result = {
      r: layer.r * layer.a + result.r * (1 - layer.a),
      g: layer.g * layer.a + result.g * (1 - layer.a),
      b: layer.b * layer.a + result.b * (1 - layer.a),
    };
  }
  return result;
}

/** Whether the page as a whole is dark, judged from five points across the viewport. */
export function pageIsDark(ignore: Element): boolean {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const points = [
    [0.5, 0.5],
    [0.2, 0.25],
    [0.8, 0.25],
    [0.2, 0.75],
    [0.8, 0.75],
  ] as const;
  let dark = 0;
  for (const [px, py] of points) if (isDark(backgroundAt(w * px, h * py, ignore))) dark++;
  return dark >= 3;
}
