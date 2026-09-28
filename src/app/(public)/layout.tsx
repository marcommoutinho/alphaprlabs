import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { BODY_CLASS, HTML_CLASS } from "../document";
import "../globals.css";

// Root layout of the public site (static). The private app has its own root
// layout, (private)/layout.tsx; see src/app/document.ts.
export const metadata: Metadata = {
  title: "Alpha Peptide Research Labs",
  description:
    "Alpha Peptide Research Labs — a peptide research company focused on peptides, supplementation, and health optimization. For Research Use Only.",
  keywords: ["peptides", "peptide research", "peptide health", "peptide wellness", "peptide science"],
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  // The web app manifest (src/app/manifest.ts) belongs to the private app only.
  manifest: null,
};

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={HTML_CLASS}>
      <body className={BODY_CLASS}>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
