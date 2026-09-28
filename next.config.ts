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
