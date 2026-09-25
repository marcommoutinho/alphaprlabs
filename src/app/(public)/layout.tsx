import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Alpha Peptide Research Labs",
  description:
    "Alpha Peptide Research Labs — a peptide research company focused on peptides, supplementation, and health optimization. For Research Use Only.",
  keywords: ["peptides", "peptide research", "peptide health", "peptide wellness", "peptide science"],
  // The web app manifest (src/app/manifest.ts) belongs to the private app only.
  manifest: null,
};

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
