import type { MetadataRoute } from "next";

import { THEME_COLOR } from "@/lib/alpha/appearance";
import { RESEARCH_HOME } from "@/lib/auth/paths";

// Web app manifest for the installable research app (served only on the app
// host; see src/proxy.ts). Linked from the private layout only — the public
// layout opts out. The app opens straight on Today (signed out, the page
// sends the person to sign in): no redirect before the first paint. The
// splash colour is the light `paper` (the default mode; a manifest can't
// follow the phone's scheme): the per-scheme theme-color metas and the iOS
// launch images (src/app/(private)/layout.tsx) cover dark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Alpha PR Labs",
    short_name: "Alpha PR",
    description: "Alpha PR Labs research app",
    start_url: RESEARCH_HOME,
    scope: "/",
    display: "standalone",
    theme_color: THEME_COLOR.light,
    background_color: THEME_COLOR.light,
    icons: [
      { src: "/app-icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
