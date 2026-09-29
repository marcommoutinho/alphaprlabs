// The CSS shared with the public site (Inter, globals.css) comes first, in the
// public layout's order; the private CSS (design v3, src/styles/alpha)
// follows, and the v3 fonts come last, so the build's CSS chunking never
// merges them into the chunk the public site loads (which would preload
// Geist there).
import { BODY_CLASS, HTML_CLASS } from "../document";
import "../globals.css";
import "@/styles/alpha/app.css";
import "@/styles/alpha/tokens.css";
import "@/styles/alpha/components.css";
import { geist, geistMono } from "./fonts";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { AppearanceSync } from "@/components/alpha/appearance-sync";
import { AlphaRoot } from "@/components/alpha/root";
import { APPEARANCE_COOKIE, htmlClassFor, parseAppearance, themeColorFor } from "@/lib/alpha/appearance";
import { getSessionPerson } from "@/lib/auth/session";
import { resolveAppearance } from "@/lib/preferences/rules";

// Root layout of the private area: /app (researchers), /admin, /auth, on the
// design v3 tokens and fonts (src/styles/alpha). It is its own root layout
// (the public site has another, see src/app/document.ts) so it can render the
// Appearance choice on <html> before first paint: `.light` or `.dark` forces
// a mode; no class follows the OS. The choice is the signed-in account's once
// it was made on Me (R8: stored with the account, so it follows the person to
// every device), else this device's alpha-appearance cookie. AppearanceSync
// mirrors the account's choice into the cookie, so the signed-out screens on
// this device keep it too. Nothing here renders or loads on the public site,
// which stays static.
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
  // Design v3 §3: the status bar sits on the page's own `paper` colour.
  appleWebApp: { capable: true, title: "Alpha PR Labs", statusBarStyle: "default" },
};

/** The appearance shown (the account's choice, else this device's) and the account's own (null: never chosen). */
async function appearance() {
  const [jar, person] = await Promise.all([cookies(), getSessionPerson()]);
  const account = person?.preferences.appearance ?? null;
  return { shown: resolveAppearance(account, parseAppearance(jar.get(APPEARANCE_COOKIE)?.value)), account };
}

// viewport-fit=cover lets the shell pad itself with env(safe-area-inset-*).
// theme-color is `paper` for each mode, or the forced mode's.
export async function generateViewport(): Promise<Viewport> {
  const colors = themeColorFor((await appearance()).shown);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: colors.length === 1 ? colors[0].color : colors,
  };
}

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { shown, account } = await appearance();
  const forced = htmlClassFor(shown);
  return (
    <html lang="en" className={forced ? `${HTML_CLASS} ${forced}` : HTML_CLASS}>
      <body className={BODY_CLASS}>
        <AlphaRoot className={`${geist.variable} ${geistMono.variable}`}>
          {children}
          <AppearanceSync account={account} />
        </AlphaRoot>
      </body>
    </html>
  );
}
