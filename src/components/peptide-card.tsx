import Link from "next/link";
import {
  Microscope,
  Flame,
  Dumbbell,
  Brain,
  HeartPulse,
  Clock,
  Shield,
  Heart,
  Pill,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Peptide, Category } from "@/lib/peptides";

const categoryIcons: Record<Category, typeof Flame> = {
  "Fat Loss & Metabolic Health": Flame,
  "Muscle Growth & Hormone Optimization": Dumbbell,
  "Cognitive & Mood Support": Brain,
  "Healing & Recovery": HeartPulse,
  "Longevity & Anti-Aging": Clock,
  "Immune & Specialized Support": Shield,
  "Sexual Health & Performance": Heart,
  "Supportive Compounds": Pill,
};

export function PeptideCard({ peptide }: { peptide: Peptide }) {
  const CategoryIcon = categoryIcons[peptide.category as Category];

  return (
    <Link href={`/peptides/${peptide.slug}`} className="min-w-0">
      <Card className="group bg-white border-slate-200 hover:border-brand/40 transition-all hover:shadow-md h-full min-w-0">
        <CardContent className="pt-5 overflow-hidden break-words">
          <div className="flex items-start gap-3.5 mb-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-slate-100 group-hover:bg-brand/10 flex items-center justify-center shrink-0 transition-colors">
              <CategoryIcon className="h-4.5 w-4.5 text-slate-400 group-hover:text-brand transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-slate-900 group-hover:text-brand transition-colors leading-tight">
                {peptide.name}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                {peptide.fullName}
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-500 leading-relaxed line-clamp-2 mb-4">
            {peptide.oneLiner}
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Microscope className="h-3 w-3" />
              {peptide.references.length}{" "}
              {peptide.references.length === 1 ? "study" : "studies"}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] border-slate-200 text-slate-400"
            >
              {peptide.researchStatus}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
