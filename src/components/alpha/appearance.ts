import {
  appearanceCookie,
  htmlClassFor,
  themeColorFor,
  type Appearance,
} from "@/lib/alpha/appearance";

/**
 * Applies an Appearance choice in the open page and remembers it: the cookie
 * (so the server renders it on the next load, before first paint), the
 * `.light` / `.dark` class on <html>, the root's data-appearance and the
 * theme-color meta tags. Browser only. The Me → Appearance control (V4) calls
 * this; the component gallery uses it to check the mechanism.
 */
export function applyAppearance(appearance: Appearance): void {
  document.cookie = appearanceCookie(appearance);

  const html = document.documentElement;
  html.classList.remove("light", "dark");
  const forced = htmlClassFor(appearance);
  if (forced) html.classList.add(forced);

  document.querySelector<HTMLElement>("body > .alpha")?.setAttribute("data-appearance", appearance);

  for (const meta of document.head.querySelectorAll('meta[name="theme-color"]')) meta.remove();
  for (const { media, color } of themeColorFor(appearance)) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    if (media) meta.media = media;
    document.head.appendChild(meta);
  }
}
