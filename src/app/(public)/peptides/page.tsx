import Image from "next/image";
import { PeptideSidebar } from "@/components/peptide-sidebar";
import { PeptideCard } from "@/components/peptide-card";
import { peptides } from "@/lib/peptides";

export const metadata = {
  title: "Peptide Library | Alpha Peptide Research Labs",
  description:
    "Explore our library of peptides and learn how they support health, recovery, and wellness — backed by published research.",
};

export default function PeptidesPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <section className="bg-navy border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-10">
            <div>
              <h1 className="text-4xl font-bold text-white sm:text-5xl">
                Peptide Library
              </h1>
              <p className="mt-4 text-lg text-slate-400 max-w-2xl">
                Your guide to understanding peptides — what they are, how they
                work, and how they can support your health. Every entry is backed
                by published research.
              </p>
            </div>
            <div className="hidden sm:block shrink-0">
              <Image
                src="/vial.jpeg"
                alt="Alpha Peptide Research vial"
                width={140}
                height={175}
                className="rounded-lg object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Content with sidebar */}
      <section className="bg-slate-50 overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex gap-8">
            <PeptideSidebar />

            <div className="flex-1 min-w-0">
              <div className="grid gap-5 sm:grid-cols-2">
                {peptides.map((peptide) => (
                  <PeptideCard key={peptide.slug} peptide={peptide} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
