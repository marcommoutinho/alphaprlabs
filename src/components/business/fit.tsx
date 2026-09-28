import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Width of one character of a figure, in em: Geist's tabular digits at 600
 * with the readings' tight tracking run about 0.56em; this leaves room for
 * commas, "$" and the minus sign.
 */
const EM_PER_CHAR = 0.62;

/** The longest of figures shown side by side (Fit's `sizeAs`). */
export const longest = (texts: string[]) => texts.reduce((a, b) => (b.length > a.length ? b : a), "");

/**
 * A money reading that always fits its box, exactly: it is drawn at the
 * design's size (`max`, and `laptopMax` from 760 px) and steps down only as
 * far as the box's width needs for this many characters ("$1,017,868.64" in
 * a 150 px tile), never abbreviated. `reserve` keeps room for what sits
 * beside it on the line (the mono "CAD"). The exact figure is also the title.
 */
export function Fit({
  text,
  max,
  laptopMax = max,
  reserve = 0,
  sizeAs,
  className,
  children,
}: {
  /** The figure as shown, for its length and the title. */
  text: string;
  max: number;
  laptopMax?: number;
  reserve?: number;
  /** Size as if showing this instead: the longest figure of a row, so figures side by side share one size. */
  sizeAs?: string;
  className?: string;
  children?: ReactNode;
}) {
  const ratio = (Math.max((sizeAs ?? text).length, text.length, 1) * EM_PER_CHAR).toFixed(2);
  const style = {
    "--fit-phone": `${max}px`,
    "--fit-laptop": `${laptopMax}px`,
    fontSize: `min(var(--fit-cap), calc((100cqi - ${reserve}px) / ${ratio}))`,
  } as CSSProperties;
  return (
    <div className="min-w-0 [container-type:inline-size]">
      <div
        title={text}
        data-fit=""
        className={cn("whitespace-nowrap [--fit-cap:var(--fit-phone)] laptop:[--fit-cap:var(--fit-laptop)]", className)}
        style={style}
      >
        {children ?? text}
      </div>
    </div>
  );
}
