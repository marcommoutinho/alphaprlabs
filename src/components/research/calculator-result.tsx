import { Info, TriangleAlert } from "lucide-react";
import { SyringeRuler } from "@/components/alpha/gauges";
import { NowBlock, NowHeader, NowReading } from "@/components/alpha/now-block";
import { type CalculatorResult, type LineSpacing, SYRINGE_LABEL, type SyringeCapacity } from "@/lib/calculator/calculator";
import { cn } from "@/lib/utils";

/** "Can't calculate yet" with every error, in the calculator's order (§7.16's dashed block: nothing to show yet). */
export function CalculatorErrors({ errors }: { errors: string[] }) {
  return (
    <div role="alert" className="rounded-now border-[1.5px] border-dashed border-ink-3 px-5 py-5">
      <div className="text-[17px] leading-[22px] font-semibold">Can&apos;t calculate yet</div>
      <ul className="mt-2 flex flex-col gap-1 text-[15px] leading-5 text-ink-2">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The result, as the screen's Now block: the draw in units (never rounded to
 * a line; "≈" only past 6 decimals), the volume and concentration, the draw
 * on the syringe's real lines, and the summary. The flags (over capacity,
 * between lines, unknown lines) follow it as notes.
 */
export function CalculatorResultView({
  result,
  syringe,
  spacing,
}: {
  result: Extract<CalculatorResult, { ok: true }>;
  syringe: SyringeCapacity;
  spacing: LineSpacing;
}) {
  const flagged = result.flags.length > 0;
  return (
    <>
      <NowBlock data-testid="calculator-result" aria-label="Result">
        <NowHeader
          time={`${SYRINGE_LABEL[syringe]} syringe`}
          context={
            <>
              <span data-testid="calc-concentration">{result.display.concentration}</span> mg/mL
            </>
          }
        />
        <div className="mt-3 text-[14px] text-on-ink-2">Draw to</div>
        <NowReading
          className="mt-2"
          size="l"
          value={
            <span data-testid="calc-units" data-flagged={flagged || undefined}>
              {result.display.units}
            </span>
          }
          unit="units"
          secondary={
            <>
              <span data-testid="calc-volume">{result.display.volume}</span> mL
            </>
          }
          caption="Volume"
        />
        <SyringeRuler
          className="mt-[18px]"
          units={result.units}
          unitsText={result.display.units}
          capacity={syringe}
          lineSpacing={spacing}
          onInk
          notes={false}
        />
        <p className="mt-1 font-mono text-[12px] leading-4 text-on-ink-2">{result.summary}</p>
      </NowBlock>
      {result.flags.map((flag) => {
        const over = flag.kind === "over-capacity";
        const Icon = over ? TriangleAlert : Info;
        return (
          <div
            key={flag.kind}
            role="alert"
            data-flag={flag.kind}
            className={cn(
              "flex items-start gap-2 rounded-[14px] px-3.5 py-2.5 text-[14px] leading-5",
              over ? "bg-missed-tint text-missed" : "border border-line bg-surface text-ink-2",
            )}
          >
            <Icon className="mt-0.5 size-[15px] shrink-0" aria-hidden />
            <span>
              <b className="font-semibold">Flagged · </b>
              {flag.message}
            </span>
          </div>
        );
      })}
    </>
  );
}
