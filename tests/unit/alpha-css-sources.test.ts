// Guard for the SOURCE RULE at the top of src/app/globals.css and
// src/styles/alpha/app.css: the private app's Tailwind stylesheet (app.css)
// scans the whole private tree, globals.css excludes exactly that tree, and
// the design v3 utilities (bg-paper, text-ink, laptop: …), which exist only in
// app.css, are never used outside it. Otherwise a v3 class would silently
// have no CSS, or private utilities would leak into the public bundle.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const APP_CSS = join(SRC, "styles/alpha/app.css");
const GLOBALS_CSS = join(SRC, "app/globals.css");
const THEME_CSS = join(SRC, "styles/alpha/theme.css");
const CODE = /\.(tsx?|jsx?|mjs)$/;

const rel = (path: string) => relative(ROOT, path);

function sourcePaths(cssFile: string, negated: boolean): string[] {
  const css = readFileSync(cssFile, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = negated ? /@source\s+not\s+"([^"]+)"/g : /@source\s+(?!not\b)"([^"]+)"/g;
  return [...css.matchAll(pattern)].map((match) => resolve(dirname(cssFile), match[1])).sort();
}

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { recursive: true, encoding: "utf8" })
    .map((name) => join(path, name))
    .filter((file) => statSync(file).isFile());
}

const isUnder = (file: string, path: string) => file === path || file.startsWith(`${path}/`);

// Files the public site's module graph reaches (static imports of src files).
function publicModules(): Set<string> {
  const entries = [
    ...filesUnder(join(SRC, "app/(public)")),
    join(SRC, "app/global-not-found.tsx"),
    join(SRC, "app/document.ts"),
  ];
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !CODE.test(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
      const spec = match[1];
      const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
      if (!base) continue;
      const target = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]
        .map((ext) => base + ext)
        .find((path) => existsSync(path) && statSync(path).isFile());
      if (target) stack.push(target);
    }
  }
  return seen;
}

// The v3 utilities: every binding in theme.css, and the laptop / phone variants.
function v3UtilityPattern(): RegExp {
  const theme = readFileSync(THEME_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const names = (prefix: string) => [...theme.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+):`, "g"))].map((m) => m[1]);
  const colors = names("color").sort((a, b) => b.length - a.length).join("|");
  // Every Tailwind family that takes a colour, the inset / drop / text shadow
  // and inset ring ones included (the lookbehind below would otherwise read
  // "inset-ring-line" as not "ring-line").
  const families = [
    "bg",
    "text",
    "border(?:-[trblxyse])?",
    "ring(?:-offset)?",
    "inset-ring",
    "outline",
    "fill",
    "stroke",
    "divide",
    "from",
    "via",
    "to",
    "decoration",
    "caret",
    "accent",
    "shadow",
    "inset-shadow",
    "drop-shadow",
    "text-shadow",
    "placeholder",
  ].join("|");
  const colorUtility = `(?:${families})-(?:${colors})`;
  const radius = `rounded(?:-[a-z]{1,2})?-(?:${names("radius").join("|")})`;
  const shadow = `shadow-(?:${names("shadow").join("|")})`;
  const ease = `ease-(?:${names("ease").join("|")})`;
  const animate = `animate-(?:${names("animate").join("|")})`;
  const variants = [...theme.matchAll(/@custom-variant\s+([a-z-]+)/g)].map((m) => m[1]).join("|");
  return new RegExp(
    `(?<![\\w-])(?:(?:${colorUtility}|${radius}|${shadow}|${ease}|${animate})(?![\\w-])|(?:${variants}):[\\w\\[!-])`,
    "g",
  );
}

describe("Tailwind sources: the private tree has its own stylesheet", () => {
  const privateTree = sourcePaths(APP_CSS, false);

  it("app.css scans exactly what globals.css excludes, and the whole of src/app/(private)", () => {
    expect(privateTree.length).toBeGreaterThan(0);
    expect(privateTree.map(rel)).toEqual(sourcePaths(GLOBALS_CSS, true).map(rel));
    expect(privateTree.map(rel)).toContain("src/app/(private)");
    for (const path of privateTree) expect(existsSync(path), `${rel(path)} exists`).toBe(true);
  });

  it("the public site imports nothing from the private tree, and every other component folder is in it", () => {
    const reached = publicModules();
    expect(reached.size).toBeGreaterThan(5);
    const leaks = [...reached].filter((file) => privateTree.some((path) => isUnder(file, path))).map(rel);
    expect(leaks).toEqual([]);
    const componentDirs = readdirSync(join(SRC, "components"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(SRC, "components", entry.name));
    const unclassified = componentDirs
      .filter((dir) => !privateTree.includes(dir))
      .filter((dir) => ![...reached].some((file) => isUnder(file, dir)))
      .map(rel);
    // A folder the public site doesn't import belongs to the private tree.
    expect(unclassified).toEqual([]);
  });

  it("no file outside the private tree uses a design v3 utility", () => {
    const pattern = v3UtilityPattern();
    // Sanity: the pattern knows the v3 utilities and ignores ordinary ones.
    for (const hit of [
      "bg-paper",
      "text-ink-2",
      "border-line",
      "rounded-btn",
      "laptop:px-10",
      "phone:hidden",
      "text-on-ink-done",
      "inset-ring-line",
      "inset-shadow-line",
      "drop-shadow-ink",
      "text-shadow-signal",
      "ring-offset-paper",
      "decoration-missed",
      "border-x-line",
      "from-signal",
    ]) {
      expect(`class="${hit}"`.match(pattern), hit).not.toBeNull();
    }
    for (const miss of [
      "bg-white",
      "bg-background",
      "text-slate-900",
      "rounded-lg",
      "Phone: 555",
      "border-input",
      "text-link",
      "inset-ring-2",
      "drop-shadow-lg",
      "text-shadow-sm",
      "inset-shadow-xs",
    ]) {
      expect(`class="${miss}"`.match(pattern), miss).toBeNull();
    }
    const offenders = filesUnder(SRC)
      .filter((file) => CODE.test(file))
      .filter((file) => !privateTree.some((path) => isUnder(file, path)))
      .flatMap((file) => [...readFileSync(file, "utf8").matchAll(pattern)].map((match) => `${rel(file)}: ${match[0]}`));
    expect(offenders).toEqual([]);
  });
});
