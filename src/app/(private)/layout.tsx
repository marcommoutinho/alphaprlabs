import type { Metadata, Viewport } from "next";
import { AppRoot } from "@/components/app-shell/app-root";
import "@/styles/app/tokens.css";
import "@/styles/app/shell.css";
import "@/styles/app/primitives.css";

// Private area: /app (researchers), /admin, /auth. Everything below renders
// inside .app-root, which scopes the app's tokens and styles.
export const metadata: Metadata = {
  title: "Alpha PR Labs",
  robots: { index: false, follow: false },
};

// viewport-fit=cover lets the shell pad itself with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppRoot>{children}</AppRoot>;
}
