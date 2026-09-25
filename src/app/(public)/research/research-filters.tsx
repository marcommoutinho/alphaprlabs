"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ExternalLink, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface Study {
  title: string;
  authors: string;
  journal: string;
  year: number;
  summary: string;
  link?: string;
  peptideName: string;
  peptideSlug: string;
  category: string;
}

interface PeptideInfo {
  name: string;
  slug: string;
  category: string;
}

export function ResearchFilters({
  studies,
  categories,
  peptides,
}: {
  studies: Study[];
  categories: string[];
  peptides: PeptideInfo[];
}) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPeptide, setSelectedPeptide] = useState<string | null>(null);

  const filteredStudies = useMemo(() => {
    let result = studies;

    if (selectedCategory) {
      result = result.filter((s) => s.category === selectedCategory);
    }

    if (selectedPeptide) {
      result = result.filter((s) => s.peptideSlug === selectedPeptide);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.authors.toLowerCase().includes(q) ||
          s.journal.toLowerCase().includes(q) ||
          s.peptideName.toLowerCase().includes(q)
      );
    }

    return result;
  }, [studies, search, selectedCategory, selectedPeptide]);

  const filteredPeptides = selectedCategory
    ? peptides.filter((p) => p.category === selectedCategory)
    : peptides;

  const hasFilters = search || selectedCategory || selectedPeptide;

  return (
    <>
      {/* Search and filters */}
      <div className="mb-8 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by title, author, journal, or compound..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-white border-slate-200 h-11"
          />
        </div>

        {/* Category pills */}
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(selectedCategory === cat ? null : cat);
                setSelectedPeptide(null);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedCategory === cat
                  ? "bg-brand text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:border-brand/40 hover:text-brand"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Peptide pills (show when category selected) */}
        {selectedCategory && (
          <div className="flex flex-wrap gap-2">
            {filteredPeptides.map((p) => (
              <button
                key={p.slug}
                onClick={() =>
                  setSelectedPeptide(
                    selectedPeptide === p.slug ? null : p.slug
                  )
                }
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  selectedPeptide === p.slug
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:border-slate-400"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {/* Active filters summary */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Showing {filteredStudies.length} of {studies.length} studies
            {selectedCategory && (
              <span className="text-slate-400">
                {" "}in {selectedCategory}
              </span>
            )}
            {selectedPeptide && (
              <span className="text-slate-400">
                {" "}for{" "}
                {peptides.find((p) => p.slug === selectedPeptide)?.name}
              </span>
            )}
          </p>
          {hasFilters && (
            <button
              onClick={() => {
                setSearch("");
                setSelectedCategory(null);
                setSelectedPeptide(null);
              }}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Studies list */}
      <div className="space-y-3">
        {filteredStudies.map((study, i) => (
          <div
            key={`${study.peptideSlug}-${i}`}
            className="bg-white rounded-lg border border-slate-200 px-5 py-4 hover:border-slate-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 leading-snug">
                  {study.title}
                </p>
                <p className="text-xs text-slate-400 mt-1.5">
                  {study.authors} &middot; <em>{study.journal}</em> &middot;{" "}
                  {study.year}
                </p>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed line-clamp-2">
                  {study.summary}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Link
                    href={`/peptides/${study.peptideSlug}`}
                    className="text-xs font-medium text-brand hover:text-brand-dark transition-colors"
                  >
                    {study.peptideName}
                  </Link>
                  <Badge
                    variant="outline"
                    className="text-[10px] border-slate-200 text-slate-400"
                  >
                    {study.category}
                  </Badge>
                </div>
              </div>
              {study.link && (
                <a
                  href={study.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1 text-xs text-brand hover:text-brand-dark transition-colors font-medium mt-0.5"
                >
                  View
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredStudies.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm text-slate-400">
            No studies match your search.
          </p>
        </div>
      )}
    </>
  );
}
