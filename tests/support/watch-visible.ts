import type { Page } from "@playwright/test";

/**
 * In the page: once armed, records the text of any element matching
 * `selector` that is ever visible (checkVisibility), looked at on every DOM
 * change and every frame, and on pageshow. What it records and whether it
 * is armed live in sessionStorage, so they span documents.
 */
function install(selector: string) {
  const look = () => {
    if (sessionStorage.getItem("__watchArmed") !== "1" || sessionStorage.getItem("__watchSeen")) return;
    for (const element of document.querySelectorAll(selector))
      if (element.checkVisibility()) {
        sessionStorage.setItem("__watchSeen", (element.textContent ?? "").slice(0, 120) || element.outerHTML.slice(0, 120));
        return;
      }
  };
  const frame = () => {
    look();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  window.addEventListener("pageshow", look);
}

/**
 * Watches for `selector` becoming visible: in this document, and with
 * `acrossDocuments` in every document the page loads from now on (add it
 * before the first load). Nothing is recorded before arm().
 */
export async function watchVisible(page: Page, selector: string, { acrossDocuments = false } = {}) {
  if (acrossDocuments) await page.addInitScript(install, selector);
  else await page.evaluate(install, selector);
  return {
    arm: () => page.evaluate(() => sessionStorage.setItem("__watchArmed", "1")),
    /** The text of the first match seen visible once armed, or null. */
    seen: () => page.evaluate(() => sessionStorage.getItem("__watchSeen")),
  };
}
