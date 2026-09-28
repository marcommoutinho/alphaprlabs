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
 *
 * The theme-color tags the layout rendered belong to React (Next's
 * viewport metadata): removing them breaks React's next commit of <head>
 * (a refresh after the save, a navigation), which then stops the page
 * responding. So they are only renamed out of the way ("theme-color-server",
 * an attribute React leaves alone), and this function adds and later
 * removes only tags of its own.
 */
const OWN_TAG = "data-alpha-theme-color";

export function applyAppearance(appearance: Appearance): void {
  document.cookie = appearanceCookie(appearance);

  const html = document.documentElement;
  html.classList.remove("light", "dark");
  const forced = htmlClassFor(appearance);
  if (forced) html.classList.add(forced);

  for (const meta of document.head.querySelectorAll(`meta[${OWN_TAG}]`)) meta.remove();
  for (const meta of document.head.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("name", "theme-color-server");
  for (const { media, color } of themeColorFor(appearance)) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    if (media) meta.media = media;
    meta.setAttribute(OWN_TAG, "");
    document.head.appendChild(meta);
  }
}
