import type { Metadata, Viewport } from "next";
import { AppRoot } from "@/components/app-shell/app-root";
import "@/styles/app/tokens.css";
import "@/styles/app/shell.css";
import "@/styles/app/primitives.css";

// Private area: /app (researchers), /admin, /auth. Everything below renders
// inside .app-root, which scopes the app's tokens and styles.
//
// Installable app (C2): only the private area links the web app manifest
// (src/app/manifest.ts) and the app icons; the public site keeps its own.
export const metadata: Metadata = {
  title: "Alpha PR Labs",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: { url: "/app-icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
  appleWebApp: { capable: true, title: "Alpha PR Labs", statusBarStyle: "black-translucent" },
};

// viewport-fit=cover lets the shell pad itself with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050505",
};

export default function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppRoot>{children}</AppRoot>;
}
