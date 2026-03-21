import Image from "next/image";
import { FlaskConical, Target, Eye, BookOpen } from "lucide-react";

export const metadata = {
  title: "About | Alpha Peptide Research Labs",
  description:
    "Alpha Peptide Research Labs is a peptide research company focused on peptides, supplementation, and health optimization. Learn about our mission.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      {/* Header — dark with image */}
      <section className="relative bg-navy border-b border-slate-800 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/about-hero.jpeg"
            alt="Alpha Peptide Research laboratory"
            fill
            className="object-cover object-[center_70%] opacity-60"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-r from-navy/70 via-navy/40 to-transparent" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-white sm:text-5xl">
            About Us
          </h1>
          <p className="mt-4 text-lg text-slate-400 max-w-2xl">
            A peptide research company advancing the science of health and
            wellness.
          </p>
        </div>
      </section>

      {/* Mission — white */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold text-slate-900 mb-6">Our Mission</h2>
            <p className="text-slate-600 leading-relaxed text-lg mb-6">
              Alpha Peptide Research Labs is a peptide research company dedicated
              to advancing the understanding of peptides, supplementation, and
              their role in health and wellness. Peptides are among the most
              promising areas of modern health research — but the science is
              often inaccessible.
            </p>
            <p className="text-slate-600 leading-relaxed text-lg">
              We conduct and publish research that bridges the gap between
              academic literature and practical understanding. Our work is
              grounded in peer-reviewed studies, presented clearly so that anyone
              — from researchers to curious individuals — can understand what the
              evidence actually shows.
            </p>
          </div>
        </div>
      </section>

      {/* Values — simple list */}
      <section className="py-24 border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold text-slate-900 mb-12">
              What We Stand For
            </h2>

            <div className="space-y-10">
              {[
                {
                  icon: Target,
                  title: "Accuracy First",
                  description:
                    "Everything we publish is grounded in peer-reviewed research. We never make claims that the science doesn't support.",
                },
                {
                  icon: Eye,
                  title: "Clarity & Accessibility",
                  description:
                    "Research should be understandable. We present complex science in clear, straightforward language without sacrificing accuracy.",
                },
                {
                  icon: BookOpen,
                  title: "Comprehensive Research",
                  description:
                    "For each compound, we cover mechanisms of action, what the research shows, potential benefits, and safety considerations.",
                },
                {
                  icon: FlaskConical,
                  title: "Science, Not Hype",
                  description:
                    "The wellness space is full of noise. We cut through it by sticking to what published research actually demonstrates.",
                },
              ].map((value) => (
                <div key={value.title} className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <value.icon className="h-5 w-5 text-brand" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-1">
                      {value.title}
                    </h3>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      {value.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Disclaimer — dark */}
      <section className="py-24 bg-navy">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-white/[0.05] border border-white/10 p-12 text-center">
            <p className="text-xs font-semibold tracking-[0.3em] text-brand-light uppercase mb-4">
              Important Notice
            </p>
            <h2 className="text-2xl font-bold text-white mb-4">
              For Research Use Only
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto leading-relaxed">
              All information on this site is intended for research and
              educational purposes only and does not constitute medical advice.
              Always consult your medical provider before making any health
              decisions. The research presented is based on published,
              peer-reviewed studies and does not constitute an endorsement of any
              compound for human use.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
