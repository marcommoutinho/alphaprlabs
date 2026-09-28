import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type GlyphState = "done" | "due" | "upcoming" | "overdue" | "skipped" | "low";

/**
 * State glyphs (§4): state is a shape and a word, never colour alone. The
 * glyph is decorative; put the word ("Taken 7:34 AM", "Not logged …") beside
 * it. 24 px, also used at 18–22 px.
 */
export function StateGlyph({ state, size = 24, className }: { state: GlyphState; size?: number; className?: string }) {
  const box = { width: size, height: size };
  const scale = size / 24;
  const common = cn("relative inline-flex shrink-0 items-center justify-center", className);

  switch (state) {
    case "done":
      return (
        <span aria-hidden data-state={state} className={cn(common, "rounded-full bg-done text-white")} style={box}>
          <Check style={{ width: 14 * scale, height: 14 * scale }} strokeWidth={3} />
        </span>
      );
    case "due":
      return (
        <span
          aria-hidden
          data-state={state}
          className={cn(common, "rounded-full border-2 border-signal-ink bg-paper")}
          style={box}
        >
          <span className="rounded-full bg-signal-ink" style={{ width: 10 * scale, height: 10 * scale }} />
        </span>
      );
    case "upcoming":
      return (
        <span
          aria-hidden
          data-state={state}
          className={cn(common, "rounded-full border-[1.5px] border-ink-3 bg-paper")}
          style={box}
        />
      );
    case "skipped":
      return (
        <span
          aria-hidden
          data-state={state}
          className={cn(common, "rounded-full border-[1.5px] border-dashed border-ink-3 bg-paper")}
          style={box}
        />
      );
    case "overdue":
      // A 24 px square, radius 7, turned 45° (a diamond), so it reads apart
      // from the circles. Its corners reach past the 24 px box, as designed.
      return (
        <span aria-hidden data-state={state} className={common} style={box}>
          <span
            className="flex rotate-45 items-center justify-center bg-missed text-white"
            style={{ width: size, height: size, borderRadius: 7 * scale }}
          >
            <span className="-rotate-45 font-bold leading-none" style={{ fontSize: 15 * scale }}>
              !
            </span>
          </span>
        </span>
      );
    case "low":
      // Three stacked bars: two empty, the bottom one filled.
      return (
        <span
          aria-hidden
          data-state={state}
          className={cn(common, "flex-col justify-end")}
          style={{ ...box, gap: 2 * scale, padding: `${2 * scale}px ${5 * scale}px` }}
        >
          <i className="block w-full rounded-[1px] bg-low-empty" style={{ height: 4 * scale }} />
          <i className="block w-full rounded-[1px] bg-low-empty" style={{ height: 4 * scale }} />
          <i className="block w-full rounded-[1px] bg-low-fill" style={{ height: 4 * scale }} />
        </span>
      );
  }
}
