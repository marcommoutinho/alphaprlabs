#!/usr/bin/env node
// Regenerates the installed app's iOS launch images
// (public/app-icons/launch/, apple-touch-startup-image) with ImageMagick:
// the logo in `ink` centred on `paper`, for each iPhone screen in
// src/lib/app/launch-images.json, in light and in dark. The colours are read
// from the design tokens (src/styles/alpha/tokens.css), so the splash is
// the app's own background: no flash of another colour before the first
// paint. The private layout links them (src/app/(private)/layout.tsx).
//
//   node scripts/launch-images.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const logo = path.join(root, "docs/design/research-app/assets/logo.jpeg");
const out = path.join(root, "public/app-icons/launch");
const screens = JSON.parse(readFileSync(path.join(root, "src/lib/app/launch-images.json"), "utf8"));
/** The logo's width in points (CSS px): the mark and "ALPHA PEPTIDE RESEARCH" under it. */
const LOGO_PT = 168;

/** --paper and --ink in a token block that starts at `selector`. */
function tokens(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`No ${selector} block in tokens.css`);
  const block = css.slice(start, css.indexOf("}", start));
  const read = (name) => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block);
    if (!match) throw new Error(`No --${name} in ${selector}`);
    return match[1];
  };
  return { paper: read("paper"), ink: read("ink") };
}

const css = readFileSync(path.join(root, "src/styles/alpha/tokens.css"), "utf8");
const schemes = {
  light: tokens(css, '[data-alpha-theme="light"]'),
  dark: tokens(css, '[data-alpha-theme="dark"]'),
};

const tmp = mkdtempSync(path.join(tmpdir(), "launch-"));
try {
  mkdirSync(out, { recursive: true });
  // The logo's white artwork as opacity (its brightness), JPEG noise in the black cut away.
  const mark = path.join(tmp, "mark.png");
  execFileSync("convert", [logo, "-colorspace", "Gray", "-level", "12%,100%", "-alpha", "off", "(", "+clone", "-fill", "white", "-colorize", "100", ")", "+swap", "-compose", "CopyOpacity", "-composite", mark]);
  for (const [scheme, { paper, ink }] of Object.entries(schemes)) {
    for (const { width, height, ratio } of screens) {
      const file = path.join(out, `launch-${width * ratio}x${height * ratio}-${scheme}.png`);
      execFileSync("convert", [
        "-size", `${width * ratio}x${height * ratio}`, `xc:${paper}`,
        "(", mark, "-resize", `${LOGO_PT * ratio}x`, "-fill", ink, "-colorize", "100", ")",
        "-gravity", "center", "-compose", "over", "-composite",
        "-strip", "-depth", "8", file,
      ]);
      console.log(path.relative(root, file));
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
