import Link from "@/components/alpha/link";
import { SECTION_EMPTY } from "@/lib/library/screen";

/**
 * R12's company content: research summary, cycling off and supporting
 * supplements. Shared by the researcher's peptide page and the admin's
 * "Preview as researcher" (D6), so the preview is exactly what researchers
 * read. `preview` leaves out the link into the researcher's own supplements.
 */
export function PeptideSections({
  peptide,
  preview = false,
}: {
  peptide: { information: string; cyclingOff: string; supplement: string };
  preview?: boolean;
}) {
  return (
    <div className="mx-5 mt-7 flex flex-col gap-6 laptop:mx-0">
      <Section title="Research summary" text={peptide.information} empty={SECTION_EMPTY.summary} testId="peptide-summary" />
      <Section title="Cycling off" text={peptide.cyclingOff} empty={SECTION_EMPTY.cyclingOff} testId="peptide-cycling-off" />
      <Section title="Supporting supplements" text={peptide.supplement} empty={SECTION_EMPTY.supplement} testId="peptide-supplements">
        {peptide.supplement ? (
          <p className="mt-2 text-[13px] leading-[19px] text-ink-3">
            Reading this doesn&apos;t start anything.{" "}
            {preview ? (
              <span className="font-semibold text-signal-ink">Create a supplement routine</span>
            ) : (
              <Link href="/app/supplements" className="font-semibold text-signal-ink">
                Create a supplement routine
              </Link>
            )}{" "}
            if you want reminders.
          </p>
        ) : null}
      </Section>
    </div>
  );
}

function Section({ title, text, empty, testId, children }: { title: string; text: string; empty: string; testId: string; children?: React.ReactNode }) {
  return (
    <section data-testid={testId}>
      <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
      {text ? (
        <p className="mt-2.5 text-base leading-[24px] break-words whitespace-pre-line text-ink">{text}</p>
      ) : (
        <p className="mt-2.5 text-[15px] leading-[22px] text-ink-3">{empty}</p>
      )}
      {children}
    </section>
  );
}
