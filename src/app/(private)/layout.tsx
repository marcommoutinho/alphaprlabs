import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { AlphaRoot } from "@/components/alpha/root";
import { AppRoot } from "@/components/app-shell/app-root";
import { APPEARANCE_COOKIE, parseAppearance, themeColorFor } from "@/lib/alpha/appearance";
import "@/styles/alpha/tokens.css";
import "@/styles/alpha/components.css";
import "@/styles/app/tokens.css";
import "@/styles/app/shell.css";
import "@/styles/app/primitives.css";

// Private area: /app (researchers), /admin, /auth, on the design v3 tokens
// and fonts (src/styles/alpha). The public site keeps its own look: nothing
// here renders or loads there.
//
// Installable app (C2): only the private area links the web app manifest
// (src/app/manifest.ts) and the app icons; the public site keeps its own.

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Alpha PR Labs",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: { url: "/app-icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
  // Design v3 §3: the status bar sits on the page's own `paper` colour.
  appleWebApp: { capable: true, title: "Alpha PR Labs", statusBarStyle: "default" },
};

async function appearance() {
  return parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);
}

// viewport-fit=cover lets the shell pad itself with env(safe-area-inset-*).
// theme-color is `paper` for each mode, or the forced mode's.
export async function generateViewport(): Promise<Viewport> {
  const colors = themeColorFor(await appearance());
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: colors.length === 1 ? colors[0].color : colors,
  };
}

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AlphaRoot appearance={await appearance()} className={`${geist.variable} ${geistMono.variable}`}>
      <AppRoot>{children}</AppRoot>
    </AlphaRoot>
  );
}
