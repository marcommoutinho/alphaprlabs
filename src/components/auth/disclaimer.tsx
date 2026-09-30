import { TERMS_HEADING, TERMS_SECTIONS } from "@/lib/auth/terms";
import { cn } from "@/lib/utils";

// The research terms (R15; Marco, 2026-09-30). Their version is
// ACKNOWLEDGEMENT_VERSION (src/lib/auth/paths.ts), stored with the time they
// were accepted; the wording is in src/lib/auth/terms.ts.

/** R15's 330 px scroll box of the terms (also read-only from Me). */
export function DisclaimerBox({ className }: { className?: string }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={TERMS_HEADING}
      className={cn("overflow-y-auto rounded-group border border-line bg-surface p-[18px] text-[15px] leading-[1.55] text-ink", className)}
      data-testid="disclaimer-text"
    >
      {TERMS_SECTIONS.map((section) => (
        <p key={section.title} className="mt-3.5 first:mt-0" data-testid="terms-section">
          <strong className="font-semibold">{section.title}</strong> {section.body}
        </p>
      ))}
    </div>
  );
}
