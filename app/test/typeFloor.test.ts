import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = new URL("..", import.meta.url).pathname;
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

const SKIP = new Set(["node_modules", ".next", "dist", "coverage"]);
const SOURCE = /\.(tsx|ts|jsx|js)$/;
/// Explicit sizes below the 13px floor. `text-xs` is remapped to 13px in globals.css.
const FORBIDDEN = /text-\[(10(\.5)?|11|12)px\]|fontSize=["'](10(\.5)?|11|12)["']/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (SOURCE.test(name)) out.push(path);
  }
}

describe("type floor", () => {
  it("maps text-xs to 13px so existing classes stay on the scale", () => {
    expect(css).toMatch(/--text-xs:\s*13px/);
    expect(css).toMatch(/--text-sm:\s*15px/);
    expect(css).toMatch(/--text-base:\s*17px/);
    expect(css).toMatch(/--text-lg:\s*20px/);
    expect(css).toMatch(/--text-xl:\s*24px/);
    expect(css).toMatch(/--text-2xl:\s*32px/);
  });

  it("has no informative text sized below 13px", () => {
    const files: string[] = [];
    walk(join(appRoot, "components"), files);
    walk(join(appRoot, "src"), files);
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) hits.push(`${file.slice(appRoot.length)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
