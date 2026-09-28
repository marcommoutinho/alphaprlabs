import { Geist, Geist_Mono } from "next/font/google";

// Design v3 fonts, for the private app only. Kept in their own module and
// imported by (private)/layout.tsx after the shared document CSS (Inter and
// globals.css), so the build's CSS chunking puts them in a private-only chunk:
// the public site keeps loading and preloading Inter alone.
export const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
export const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
