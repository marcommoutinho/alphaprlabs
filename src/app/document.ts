import { Inter } from "next/font/google";

// The document shell shared by the two root layouts, (public)/layout.tsx and
// (private)/layout.tsx, and by global-not-found.tsx. They are separate root
// layouts so the private area can render its Appearance class on <html> from
// a cookie while the public site stays static; this keeps their <html> and
// <body> the same otherwise. One font definition, loaded once (Next.js font
// definitions file).

export const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const HTML_CLASS = `${inter.variable} h-full antialiased overflow-x-hidden`;
export const BODY_CLASS = "min-h-full flex flex-col font-sans overflow-x-hidden";
