import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local development serves the private app on app.localhost:3000 and the
  // public site on www.localhost:3000 (APP_HOST / PUBLIC_HOST); let those
  // hosts load dev-only assets such as HMR.
  allowedDevOrigins: ["app.localhost", "www.localhost"],
};

export default nextConfig;
