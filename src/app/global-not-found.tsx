import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { PublicNotFoundContent } from "@/components/not-found-content";
import { BODY_CLASS, HTML_CLASS } from "./document";
import "./globals.css";

// Any URL that matches no route (either host). With two root layouts there is
// no single layout to wrap a 404, so this is a whole document: the same public
// 404 as before the split (header, Next.js's 404 content, footer).
export const metadata: Metadata = {
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function GlobalNotFound() {
  return (
    <html lang="en" className={HTML_CLASS}>
      <body className={BODY_CLASS}>
        <Header />
        <main className="flex-1">
          <PublicNotFoundContent />
        </main>
        <Footer />
      </body>
    </html>
  );
}
