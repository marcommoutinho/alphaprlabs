import Link from "next/link";
import Image from "next/image";
import { Separator } from "@/components/ui/separator";

export function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-navy text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 py-12 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Image
                src="/logo.jpeg"
                alt="Alpha Peptide Research Labs"
                width={32}
                height={32}
                className="rounded-md"
              />
              <span className="text-sm font-bold tracking-wider uppercase">
                Alpha Peptide Research Labs
              </span>
            </div>
            <p className="text-sm text-white/50 max-w-md leading-relaxed">
              A peptide research company focused on peptides, supplementation,
              and health optimization. All research is grounded in published,
              peer-reviewed science.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-wider text-white/30 uppercase mb-4">
              Navigate
            </h3>
            <ul className="space-y-2">
              {[
                { href: "/peptides", label: "Peptide Library" },
                { href: "/research", label: "Research" },
                { href: "/about", label: "About" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/50 hover:text-brand-light transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold tracking-wider text-white/30 uppercase mb-4">
              Categories
            </h3>
            <ul className="space-y-2">
              {[
                { href: "/peptides", label: "Fat Loss & Metabolic" },
                { href: "/peptides", label: "Muscle Growth" },
                { href: "/peptides", label: "Cognitive & Mood" },
                { href: "/peptides", label: "Healing & Recovery" },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/50 hover:text-brand-light transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Separator className="bg-white/10" />

        <div className="flex flex-col items-center justify-between gap-4 py-6 md:flex-row">
          <p className="text-xs text-white/30">
            &copy; {new Date().getFullYear()} Alpha Peptide Research Labs. All
            rights reserved.
          </p>
          <p className="text-xs text-white/40 max-w-lg text-center md:text-right">
            For Research Use Only. This content is not medical advice. Always
            consult your medical provider before making health decisions.
          </p>
        </div>
      </div>
    </footer>
  );
}
