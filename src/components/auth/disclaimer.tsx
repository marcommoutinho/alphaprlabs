import { cn } from "@/lib/utils";

// The researcher disclaimer (R15). The wording is the app's placeholder
// until Alpha PR Labs supplies the final text (design v3 README "Open
// items"); its version is ACKNOWLEDGEMENT_VERSION (src/lib/auth/paths.ts),
// stored with the time it was accepted.

export const DISCLAIMER_TAG = "Content placeholder · final wording to be supplied by Marco";
export const DISCLAIMER_TEXT =
  "[Researcher disclaimer text. States that the account holder is a researcher, that peptide information, templates and guidance in this app are supplied content and not recommendations, and that the researcher is responsible for their own plans and records.]";

/** R15's 330 px scroll box of disclaimer text (also read-only from Me). */
export function DisclaimerBox({ className }: { className?: string }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Research-use disclaimer"
      className={cn("overflow-y-auto rounded-group border border-line bg-surface p-[18px] text-[15px] leading-[1.55] text-ink", className)}
      data-testid="disclaimer-text"
    >
      <div className="font-mono text-[12px] font-medium text-low">{DISCLAIMER_TAG}</div>
      <p className="mt-3.5">{DISCLAIMER_TEXT}</p>
    </div>
  );
}
