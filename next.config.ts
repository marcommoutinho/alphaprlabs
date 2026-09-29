import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local development serves the private app on app.localhost:3000 and the
  // public site on www.localhost:3000 (APP_HOST / PUBLIC_HOST); let those
  // hosts load dev-only assets such as HMR.
  allowedDevOrigins: ["app.localhost", "www.localhost"],
  // The public site and the private app are separate root layouts (see
  // src/app/document.ts), so unmatched URLs need app/global-not-found.tsx.
  experimental: {
    globalNotFound: true,
    // The client keeps a visited private page for 30 s (Next.js 16's
    // default is 0), so going back to a tab looked at a moment ago shows it
    // at once, without a server round trip. It never shows anything older
    // than the person's own last change: every server action that saves
    // calls refresh() or revalidatePath() and router.refresh() follows the
    // record sheets' saves, and each drops these pages on the client
    // (invalidateBfCache in next/dist/client/components/router-reducer);
    // sign-in and sign-out set cookies or load the page in full. Other
    // people's changes (an admin's, another device's) can take up to 30 s to
    // show on a revisit, as a page left open would; a reload shows them.
    staleTimes: { dynamic: 30 },
  },
  async headers() {
    return [
      {
        // The research app's service worker (Next.js PWA guide): always
        // revalidated so updates apply, correct type, and a strict CSP.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
