import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const token = (name: string): string => {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token --color-${name} missing`);
  return m[1]!;
};

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("design tokens", () => {
  it.each(["foreground", "muted", "faint", "gold", "success", "danger"])("%s text is AA on every surface", (name) => {
    for (const surface of ["bg", "surface-1", "surface-2"]) {
      expect(contrast(token(name), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("muted meets about 7:1 on the page background (key information at the type floor)", () => {
    expect(contrast(token("muted"), token("bg"))).toBeGreaterThanOrEqual(7);
    expect(contrast(token("muted"), token("surface-1"))).toBeGreaterThanOrEqual(7);
  });
  it("control borders and the focus ring meet 3:1 (WCAG 1.4.11)", () => {
    for (const surface of ["bg", "surface-1"]) {
      expect(contrast(token("border-input"), token(surface))).toBeGreaterThanOrEqual(3);
      expect(contrast(token("focus"), token(surface))).toBeGreaterThanOrEqual(3);
    }
  });
  it("black text on the gold primary is AA", () => {
    expect(contrast("#000000", token("gold"))).toBeGreaterThanOrEqual(4.5);
  });
});
