// iOS zooms into a text field whose text is under 16 px when it takes focus,
// and stays zoomed after the keyboard closes: the visual viewport is then
// smaller than the layout viewport, and the fixed tab bar no longer sits on
// the screen's bottom edge. No app imports: e2e specs use this.
import type { Page } from "@playwright/test";

/**
 * Every focusable text-entry control on the page, in sheets too (an input
 * other than a checkbox, radio, range or button type; a select; a textarea;
 * anything contenteditable) whose computed text is under 16 px, described.
 */
export async function smallFields(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const NOT_TEXT = new Set(["checkbox", "radio", "range", "button", "submit", "reset", "image", "hidden", "file", "color"]);
    const found: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("input, select, textarea, [contenteditable]:not([contenteditable='false'])")) {
      if (el instanceof HTMLInputElement && NOT_TEXT.has(el.type)) continue;
      if ((el as HTMLInputElement).disabled || el.closest("[inert]") || el.getClientRects().length === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size >= 16) continue;
      const name =
        el.getAttribute("aria-label") ??
        (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null) ??
        el.closest("label")?.textContent ??
        el.getAttribute("placeholder") ??
        el.getAttribute("data-testid") ??
        "(no name)";
      const where = el.closest('[role="dialog"]')?.getAttribute("aria-label") ?? el.closest('[role="dialog"]')?.querySelector("h2")?.textContent;
      found.push(`${el.tagName.toLowerCase()}${el instanceof HTMLInputElement ? `[type=${el.type}]` : ""} “${name.trim().slice(0, 50)}”${el.getAttribute("data-testid") ? ` [data-testid=${el.getAttribute("data-testid")}]` : ""}${where ? ` in the sheet “${where.trim()}”` : ""}: ${size}px`);
    }
    return found;
  });
}
