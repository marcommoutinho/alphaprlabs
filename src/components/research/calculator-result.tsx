import type { CalculatorResult, LineSpacing, SyringeCapacity } from "@/lib/calculator/calculator";

/** "Can't calculate yet" with every error, in the calculator's order. */
export function CalculatorErrors({ errors }: { errors: string[] }) {
  return (
    <div role="alert" className="app-calc-errors">
      <b>Can&apos;t calculate yet</b>
      <ul>
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The three results, the syringe scale with the draw marked, the summary and
 * the flags (over capacity, between lines, unknown spacing). Exact values,
 * "≈" only when a value has more than 6 decimals; units are never rounded to
 * a line.
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
  // The bar's position only: display, not a calculation.
  const fill = `${Math.min(100, (Number(result.units) / syringe) * 100).toFixed(2)}%`;
  const tick = spacing === "unknown" ? "100%" : `${((Number(spacing) / syringe) * 100).toFixed(3)}%`;
  const scale = Array.from({ length: 11 }, (_, i) => String(Math.round((syringe * i) / 10)));

  return (
    <>
      <div className="app-calc-numbers" data-testid="calculator-result">
        <div>
          <div className="app-calc-num-label">Concentration</div>
          <div className="app-calc-num">
            <span data-testid="calc-concentration">{result.display.concentration}</span> <span className="app-calc-unit">mg/mL</span>
          </div>
        </div>
        <div>
          <div className="app-calc-num-label">Volume</div>
          <div className="app-calc-num">
            <span data-testid="calc-volume">{result.display.volume}</span> <span className="app-calc-unit">mL</span>
          </div>
        </div>
        <div>
          <div className="app-calc-num-label app-calc-num-label--accent">Draw to</div>
          <div className="app-calc-num">
            <span data-testid="calc-units" className="app-calc-units" data-flagged={flagged || undefined}>
              {result.display.units}
            </span>{" "}
            <span className="app-calc-unit">units</span>
          </div>
        </div>
      </div>
      <div>
        <div className="app-calc-syringe" aria-hidden="true">
          <div className="app-calc-fill" data-flagged={flagged || undefined} style={{ width: fill }} />
          <div
            className="app-calc-ticks"
            style={{ background: `repeating-linear-gradient(90deg, rgba(255,255,255,.3) 0 1px, transparent 1px ${tick})` }}
          />
          <div className="app-calc-major" />
          <div className="app-calc-marker" style={{ left: fill }} />
        </div>
        <div className="app-calc-scale" aria-hidden="true">
          {scale.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
        <div className="app-calc-summary">{result.summary}</div>
      </div>
      {result.flags.map((flag) => (
        <div key={flag.kind} role="alert" className="app-calc-flag">
          <b>Flagged · </b>
          {flag.message}
        </div>
      ))}
    </>
  );
}
