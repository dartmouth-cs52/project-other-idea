import { afterEach, describe, expect, it } from "vitest";
import { backgroundAt, isDark, pageIsDark, parseColor } from "../../src/ui/tone.ts";

const ignore = document.createElement("div");

afterEach(() => {
  document.body.innerHTML = "";
  document.body.style.background = "";
});

describe("tone", () => {
  it("parses computed colors and picks the higher-contrast ink", () => {
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(isDark({ r: 0, g: 0, b: 0 })).toBe(true);
    expect(isDark({ r: 255, g: 255, b: 255 })).toBe(false);
    expect(isDark({ r: 47, g: 91, b: 234 })).toBe(true);
    expect(isDark({ r: 255, g: 230, b: 0 })).toBe(false);
  });

  it("finds the color painted behind a point, through transparent children", () => {
    document.body.innerHTML = `
      <div style="position:fixed;left:0;top:0;width:200px;height:200px;background:#111">
        <span style="display:block;width:100px;height:100px">text</span>
      </div>`;
    expect(isDark(backgroundAt(50, 50, ignore))).toBe(true);
    expect(isDark(backgroundAt(400, 400, ignore))).toBe(false);
  });

  it("blends translucent overlays over what's beneath them", () => {
    document.body.style.background = "#fff";
    document.body.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.8)"></div>`;
    expect(isDark(backgroundAt(10, 10, ignore))).toBe(true);
    document.body.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.1)"></div>`;
    expect(isDark(backgroundAt(10, 10, ignore))).toBe(false);
  });

  it("judges the whole page", () => {
    document.body.style.background = "#0d1117";
    document.body.innerHTML = `<main style="min-height:100vh"></main>`;
    expect(pageIsDark(ignore)).toBe(true);
    document.body.style.background = "#f6f6f6";
    expect(pageIsDark(ignore)).toBe(false);
  });
});
