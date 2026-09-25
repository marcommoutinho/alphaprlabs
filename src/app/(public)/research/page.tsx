import Link from "next/link";
import { ExternalLink, BookOpen, Microscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { peptides, categories, categoryColors, type Category } from "@/lib/peptides";
import { ResearchFilters } from "./research-filters";

export const metadata = {
  title: "Research References | Alpha Peptide Research Labs",
  description:
    "Browse 200+ peer-reviewed studies referenced across our peptide research library. Every study linked to its original source.",
};

// Build a flat list of all studies with their peptide context
function getAllStudies() {
  const studies: {
    title: string;
    authors: string;
    journal: string;
    year: number;
    summary: string;
    link?: string;
    peptideName: string;
    peptideSlug: string;
    category: string;
  }[] = [];

  for (const p of peptides) {
    for (const ref of p.references) {
      studies.push({
        ...ref,
        peptideName: p.name,
        peptideSlug: p.slug,
        category: p.category,
      });
    }
  }

  // Sort by year descending (newest first)
  studies.sort((a, b) => b.year - a.year);
  return studies;
}

export default function ResearchPage() {
  const studies = getAllStudies();
  const totalWithLinks = studies.filter((s) => s.link).length;

  return (
    <div className="min-h-screen">
      {/* Header — dark */}
      <section className="bg-navy border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-white sm:text-5xl">
            Research References
          </h1>
          <p className="mt-4 text-lg text-slate-400 max-w-2xl">
            Every study we reference, linked to its original source. Browse
            {" "}{studies.length} peer-reviewed publications across{" "}
            {peptides.length} compounds.
          </p>
          <div className="mt-6 flex gap-6 text-sm text-slate-500">
            <span className="flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 text-slate-400" />
              {studies.length} studies
            </span>
            <span className="flex items-center gap-1.5">
              <ExternalLink className="h-4 w-4 text-slate-400" />
              {totalWithLinks} linked to source
            </span>
            <span className="flex items-center gap-1.5">
              <Microscope className="h-4 w-4 text-slate-400" />
              {peptides.length} compounds
            </span>
          </div>
        </div>
      </section>

      {/* Studies */}
      <section className="py-12 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ResearchFilters
            studies={studies}
            categories={[...categories]}
            peptides={peptides.map((p) => ({
              name: p.name,
              slug: p.slug,
              category: p.category,
            }))}
          />
        </div>
      </section>

      {/* Disclaimer */}
      <section className="py-8 bg-white border-t border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-5 py-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              For Research Use Only
            </p>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              All research presented on this site is for research and educational
              purposes only and does not constitute medical advice. Always
              consult your medical provider before making any health decisions.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
