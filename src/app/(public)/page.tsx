import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { HeroVideo } from "@/components/hero-video";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PeptideCard } from "@/components/peptide-card";
import { peptides, getPeptideBySlug } from "@/lib/peptides";

export default function Home() {
  const featuredSlugs = ["retatrutide", "tesamorelin", "bpc-157"];
  const featuredPeptides = featuredSlugs
    .map((s) => getPeptideBySlug(s))
    .filter((p): p is NonNullable<typeof p> => p != null);

  return (
    <div className="flex flex-col overflow-x-hidden">
      {/* Hero Section — dark with video */}
      <section className="relative overflow-hidden bg-navy">
        <HeroVideo />
        <div className="absolute inset-0 bg-navy/70" />
        <div className="absolute inset-0 bg-gradient-to-b from-navy/40 via-transparent to-navy" />

        <div className="relative mx-auto max-w-7xl px-4 py-32 sm:px-6 sm:py-40 lg:px-8">
          <div className="max-w-3xl">
            <Badge
              variant="outline"
              className="mb-6 border-brand/30 text-brand-light px-3 py-1"
            >
              For Research Use Only
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-7xl leading-[1.1]">
              Peptide Research for{" "}
              <span className="text-brand-light">Better Health.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-400 max-w-xl leading-relaxed">
              Alpha Peptide Research Labs investigates peptides,
              supplementation, and their role in health and wellness — grounded
              in published science, explained clearly.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <LinkButton
                href="/peptides"
                size="lg"
                className="bg-brand text-white hover:bg-brand-dark font-semibold px-8"
              >
                Explore Our Research
                <ArrowRight className="ml-2 h-4 w-4" />
              </LinkButton>
              <LinkButton
                href="/about"
                size="lg"
                className="border border-white/25 bg-transparent text-white hover:bg-white/10 px-8"
              >
                About Our Lab
              </LinkButton>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section — light */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            {[
              { value: `${peptides.length}+`, label: "Compounds Researched" },
              { value: `${peptides.reduce((sum, p) => sum + p.references.length, 0)}+`, label: "Studies Referenced" },
              { value: "Research Only", label: "For Research Use Only" },
            ].map((stat) => (
              <div key={stat.label} className="px-6 py-8 text-center">
                <p className="text-3xl font-bold text-navy">{stat.value}</p>
                <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What We Do — light gray */}
      <section className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">
              What We Research
            </h2>
            <p className="mt-4 text-slate-500 max-w-2xl mx-auto">
              Our lab focuses on peptides, supplementation, and health
              optimization — translating published science into clear, useful
              knowledge.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                image: "/vials.jpeg",
                title: "Peptide Research",
                description:
                  "In-depth research on how peptides support recovery, immune function, metabolism, cognitive health, and more — backed by published studies.",
              },
              {
                image: "/health-wellness.jpeg",
                title: "Health & Wellness",
                description:
                  "We investigate how peptides and supplementation contribute to overall health, longevity, and quality of life.",
              },
              {
                image: "/science-first.jpeg",
                title: "Science-First Approach",
                description:
                  "Every compound we research is supported by peer-reviewed literature. No hype — just what the evidence shows.",
              },
            ].map((feature) => (
              <Card
                key={feature.title}
                className="bg-white border-slate-200 hover:border-brand/30 transition-colors shadow-sm overflow-hidden"
              >
                <div className="relative h-48 w-full">
                  <Image
                    src={feature.image}
                    alt={feature.title}
                    fill
                    className="object-cover"
                  />
                </div>
                <CardContent className="pt-5">
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Peptides — white */}
      <section className="bg-white py-24 border-t border-slate-200 overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-12">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                Featured Research
              </h2>
              <p className="mt-4 text-slate-500">
                Some of the most well-studied peptides in our library — explore
                the mechanisms, benefits, and published evidence.
              </p>
            </div>
            <LinkButton
              href="/peptides"
              variant="ghost"
              className="hidden sm:flex text-slate-600 hover:text-brand"
            >
              View all <ArrowRight className="ml-2 h-4 w-4" />
            </LinkButton>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredPeptides.map((peptide) => (
              <PeptideCard key={peptide.slug} peptide={peptide} />
            ))}
          </div>

          <div className="mt-8 text-center sm:hidden">
            <LinkButton
              href="/peptides"
              variant="outline"
              className="border-slate-300 text-slate-700"
            >
              View All Peptides <ArrowRight className="ml-2 h-4 w-4" />
            </LinkButton>
          </div>
        </div>
      </section>

      {/* CTA Section — dark */}
      <section className="bg-navy py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-2xl bg-white/[0.05] border border-white/10 p-6 sm:p-12 md:p-16">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:2rem_2rem]" />
            <div className="relative flex flex-col md:flex-row items-center gap-10 md:gap-16">
              <div className="flex-1 text-center md:text-left">
                <h2 className="text-3xl font-bold text-white sm:text-4xl">
                  Explore Our Peptide Library
                </h2>
                <p className="mt-4 text-slate-400 max-w-xl">
                  Browse {peptides.length}+ peptides with detailed research on
                  mechanisms, benefits, safety profiles, and supporting studies.
                  Always consult your medical provider before making health
                  decisions.
                </p>
                <div className="mt-8 md:hidden flex justify-center">
                  <Image
                    src="/vial.jpeg"
                    alt="Alpha Peptide Research vial"
                    width={160}
                    height={200}
                    className="rounded-lg object-cover"
                  />
                </div>
                <div className="mt-8">
                  <LinkButton
                    href="/peptides"
                    size="lg"
                    className="bg-brand text-white hover:bg-brand-dark font-semibold px-8"
                  >
                    View Full Library
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </LinkButton>
                </div>
              </div>
              <div className="hidden md:block shrink-0">
                <Image
                  src="/vial.jpeg"
                  alt="Alpha Peptide Research vial"
                  width={200}
                  height={250}
                  className="rounded-lg object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
