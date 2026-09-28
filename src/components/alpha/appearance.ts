import {
  appearanceCookie,
  htmlClassFor,
  themeColorFor,
  type Appearance,
} from "@/lib/alpha/appearance";

/**
 * Applies an Appearance choice in the open page and remembers it: the cookie
 * (so the private root layout renders the same `.light` / `.dark` class on
 * <html> on the next load, before first paint), that class now, and the
 * theme-color meta tags. The class and tags come from the same pure helpers
 * the server uses, so both always agree. Browser only. The Me → Appearance
 * control (V4) calls this; the component gallery uses it to check the
 * mechanism.
 */
export function applyAppearance(appearance: Appearance): void {
  document.cookie = appearanceCookie(appearance);

  const html = document.documentElement;
  html.classList.remove("light", "dark");
  const forced = htmlClassFor(appearance);
  if (forced) html.classList.add(forced);

  for (const meta of document.head.querySelectorAll('meta[name="theme-color"]')) meta.remove();
  for (const { media, color } of themeColorFor(appearance)) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    if (media) meta.media = media;
    document.head.appendChild(meta);
  }
}
