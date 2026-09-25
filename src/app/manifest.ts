import type { MetadataRoute } from "next";

// Web app manifest for the installable research app (served only on the app
// host; see src/proxy.ts). Linked from the private layout only — the public
// layout opts out. "/" on the app host opens the signed-in person's home.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Alpha PR Labs",
    short_name: "Alpha PR",
    description: "Alpha PR Labs research app",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#050505",
    background_color: "#050505",
    icons: [
      { src: "/app-icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
