// Review screenshots from the e2e specs: written only when SHOTS_DIR names a
// folder (SHOTS_DIR=/some/dir npx playwright test …), the one variable every
// spec uses. An ordinary run writes nothing.
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

/** The phone tab bar is drawn at the page's end instead of floating mid-page. */
export const STATIC_TAB_BAR = ".app-tabbar { position: static !important; }";

export type ShotOptions = { fullPage?: boolean; style?: string; animations?: "disabled" | "allow" };

/** Saves `<SHOTS_DIR>/<file>.png` of the page, or of one element; does nothing unless SHOTS_DIR is set. */
export async function shot(target: Page | Locator, file: string, { fullPage = false, ...options }: ShotOptions = {}) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const at = path.join(dir, `${file}.png`);
  if ("goto" in target) await target.screenshot({ path: at, fullPage, ...options });
  else await target.screenshot({ path: at, ...options });
}
