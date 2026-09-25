"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getCategoriesWithPeptides } from "@/lib/peptides";

export function PeptideSidebar() {
  const pathname = usePathname();
  const categoriesWithPeptides = getCategoriesWithPeptides();

  // Only expand the category that contains the active peptide
  const activeCategory = categoriesWithPeptides.find(({ peptides }) =>
    peptides.some((p) => pathname === `/peptides/${p.slug}`)
  )?.category;

  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(
      categoriesWithPeptides.map((c) => [
        c.category,
        c.category === activeCategory,
      ])
    )
  );

  useEffect(() => {
    if (activeCategory) {
      // Existing public-site behavior, left unchanged by the research app work.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded((prev) => ({ ...prev, [activeCategory]: true }));
    }
  }, [activeCategory]);

  const toggleCategory = (category: string) => {
    setExpanded((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <nav className="w-56 shrink-0 hidden lg:block">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <Link
            href="/peptides"
            className={cn(
              "block px-3 py-2 text-sm font-semibold rounded-md transition-colors",
              pathname === "/peptides"
                ? "text-brand bg-brand/5"
                : "text-slate-800 hover:text-brand"
            )}
          >
            All Peptides
          </Link>

          <div className="mt-2 space-y-0.5">
            {categoriesWithPeptides.map(({ category, peptides }) => (
              <div key={category}>
                <button
                  onClick={() => toggleCategory(category)}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold rounded-md transition-colors",
                    expanded[category]
                      ? "text-slate-700 bg-slate-50"
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 transition-transform",
                      expanded[category] && "rotate-90"
                    )}
                  />
                  <span className="text-left leading-tight">{category}</span>
                </button>

                {expanded[category] && (
                  <ul className="ml-5 border-l border-slate-100 pl-3 my-1">
                    {peptides.map((peptide) => {
                      const href = `/peptides/${peptide.slug}`;
                      const isActive = pathname === href;

                      return (
                        <li key={peptide.slug}>
                          <Link
                            href={href}
                            className={cn(
                              "block px-2 py-1 text-xs rounded transition-colors",
                              isActive
                                ? "text-brand font-medium bg-brand/5"
                                : "text-slate-500 hover:text-brand"
                            )}
                          >
                            {peptide.name}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
