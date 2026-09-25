import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ExternalLink,
  Microscope,
  Atom,
  Heart,
  AlertTriangle,
  BookOpen,
  CheckCircle,
  FlaskConical,
  Globe,
  TestTubes,
  Beaker,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PeptideSidebar } from "@/components/peptide-sidebar";
import { peptides, getPeptideBySlug, type ResearchStatus } from "@/lib/peptides";

export function generateStaticParams() {
  return peptides.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const peptide = getPeptideBySlug(slug);
  if (!peptide) return {};
  return {
    title: `${peptide.name} — ${peptide.fullName} | Alpha Peptide Research Labs`,
    description: peptide.oneLiner,
  };
}

function ResearchStatusBadge({ status }: { status: ResearchStatus }) {
  const config: Record<
    ResearchStatus,
    { icon: typeof CheckCircle; className: string }
  > = {
    "FDA Approved": {
      icon: CheckCircle,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    "Approved Internationally": {
      icon: Globe,
      className: "bg-blue-50 text-blue-700 border-blue-200",
    },
    "Phase 3 Trials": {
      icon: FlaskConical,
      className: "bg-violet-50 text-violet-700 border-violet-200",
    },
    "Phase 2 Trials": {
      icon: TestTubes,
      className: "bg-amber-50 text-amber-700 border-amber-200",
    },
    "Phase 1 Trials": {
      icon: Beaker,
      className: "bg-orange-50 text-orange-700 border-orange-200",
    },
    Preclinical: {
      icon: Microscope,
      className: "bg-slate-50 text-slate-600 border-slate-200",
    },
  };
  const { icon: Icon, className } = config[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

export default async function PeptideDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const peptide = getPeptideBySlug(slug);
  if (!peptide) notFound();

  const relatedPeptides = peptide.relatedPeptides
    ?.map((s) => getPeptideBySlug(s))
    .filter(Boolean);

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "how-it-works", label: "How It Works" },
    { id: "benefits", label: "Benefits" },
    { id: "research", label: "Research" },
    { id: "safety", label: "Safety" },
    { id: "references", label: "References" },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-12 overflow-hidden">
          <PeptideSidebar />

          <article className="flex-1 min-w-0 max-w-3xl">
            {/* Header */}
            <header className="mb-10">
              <div className="flex items-start gap-8">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-4">
                    <Badge
                      variant="outline"
                      className="border-slate-200 text-slate-500 text-xs"
                    >
                      {peptide.category}
                    </Badge>
                    <ResearchStatusBadge status={peptide.researchStatus} />
                  </div>
                  <h1 className="text-4xl font-bold text-slate-900 sm:text-5xl tracking-tight">
                    {peptide.name}
                  </h1>
                  <p className="mt-2 text-lg text-slate-400">{peptide.fullName}</p>
                  <div className="section-content">
                    <p className="mt-6 text-xl text-slate-700 leading-relaxed font-medium">
                      {peptide.oneLiner}
                    </p>

                    {/* Research Stats */}
                    <div className="mt-6 flex flex-wrap gap-6 text-sm text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <Microscope className="h-4 w-4 text-slate-400" />
                        {peptide.references.length} studies referenced
                      </span>
                      <span className="flex items-center gap-1.5">
                        <BookOpen className="h-4 w-4 text-slate-400" />
                        {peptide.keyUse}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="hidden sm:block shrink-0">
                  <Image
                    src="/vial.jpeg"
                    alt="Alpha Peptide Research vial"
                    width={160}
                    height={200}
                    className="rounded-lg object-cover"
                  />
                </div>
              </div>
            </header>

            {/* Section Nav */}
            <nav className="sticky top-16 z-10 mb-10 bg-white/95 backdrop-blur-sm py-2">
              <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1 ring-1 ring-slate-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                {sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="px-4 py-2 text-[13px] font-semibold text-slate-500 hover:text-slate-900 hover:bg-white hover:shadow-sm rounded-lg transition-all whitespace-nowrap"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </nav>

            {/* Overview */}
            <section id="overview" className="mb-16 scroll-mt-28">
              <div className="prose-section section-content">
                {peptide.description.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </section>

            {/* How It Works */}
            <section id="how-it-works" className="mb-16 scroll-mt-28">
              <h2 className="section-heading">
                <Atom className="h-5 w-5 text-brand" />
                How It Works
              </h2>
              <div className="prose-section section-content">
                {peptide.howItWorks.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </section>

            {/* Benefits */}
            <section id="benefits" className="mb-16 scroll-mt-28">
              <h2 className="section-heading">
                <Heart className="h-5 w-5 text-brand" />
                Potential Benefits
              </h2>
              <div className="space-y-8 section-content">
                {peptide.benefits.map((benefit, i) => (
                  <div key={i}>
                    <h3 className="text-base font-semibold text-slate-900 mb-1.5">
                      {benefit.title}
                    </h3>
                    <p className="text-[15px] text-slate-600 leading-relaxed">
                      {benefit.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* What Research Shows */}
            <section id="research" className="mb-16 scroll-mt-28">
              <h2 className="section-heading">
                <Microscope className="h-5 w-5 text-brand" />
                What the Research Shows
              </h2>
              <div className="section-content">
                <div className="mb-6">
                  <ResearchStatusBadge status={peptide.researchStatus} />
                </div>
                <div className="prose-section">
                  {peptide.whatResearchShows.map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </section>

            {/* Safety */}
            <section id="safety" className="mb-16 scroll-mt-28">
              <h2 className="section-heading">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                What to Know
              </h2>

              <div className="section-content">
              <div className="mb-6 flex items-center gap-5 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                  Common
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  Important
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  Serious
                </span>
              </div>

              <div className="space-y-4">
                {peptide.safetyInfo.map((item, i) => {
                  const dotColor = {
                    common: "bg-slate-300",
                    important: "bg-amber-400",
                    serious: "bg-red-400",
                  }[item.severity];
                  const bgColor = {
                    common: "",
                    important: "",
                    serious: "bg-red-50 border border-red-100 rounded-lg px-4 py-3",
                  }[item.severity];

                  return (
                    <div key={i} className={`flex items-start gap-3 ${bgColor}`}>
                      <span
                        className={`mt-[7px] h-2.5 w-2.5 rounded-full shrink-0 ${dotColor}`}
                      />
                      <p className="text-[15px] text-slate-600 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  );
                })}
              </div>
              </div>
            </section>

            {/* References */}
            <section id="references" className="mb-16 scroll-mt-28">
              <h2 className="section-heading">
                <BookOpen className="h-5 w-5 text-brand" />
                Research References
              </h2>
              <ol className="space-y-6 list-none section-content">
                {peptide.references.map((ref, i) => (
                  <li key={i} className="border-l-2 border-slate-100 pl-5">
                    <p className="text-[15px] font-medium text-slate-800 leading-snug">
                      {ref.title}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {ref.authors} &middot; <em>{ref.journal}</em> &middot;{" "}
                      {ref.year}
                    </p>
                    <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                      {ref.summary}
                    </p>
                    {ref.link && (
                      <a
                        href={ref.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center mt-2 text-xs text-brand hover:text-brand-dark transition-colors font-medium"
                      >
                        View Study{" "}
                        <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </section>

            {/* Related Peptides */}
            {relatedPeptides && relatedPeptides.length > 0 && (
              <section className="pt-10 border-t border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900 mb-5">
                  Related Peptides
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {relatedPeptides.map(
                    (rp) =>
                      rp && (
                        <Link
                          key={rp.slug}
                          href={`/peptides/${rp.slug}`}
                          className="group flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3 hover:border-brand/30 hover:bg-slate-50/50 transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-800 group-hover:text-brand">
                              {rp.name}
                            </p>
                            <p className="text-xs text-slate-400">
                              {rp.category}
                            </p>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-brand transition-colors" />
                        </Link>
                      )
                  )}
                </div>
              </section>
            )}

            {/* Disclaimer */}
            <footer className="mt-16 pt-8 border-t border-slate-100">
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-5 py-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  For Research Use Only
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  This content is for research and educational purposes only and
                  does not constitute medical advice. Always consult your medical
                  provider before making any health decisions. The information
                  presented is based on published, peer-reviewed research and
                  does not constitute an endorsement of any compound for human
                  use.
                </p>
              </div>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
