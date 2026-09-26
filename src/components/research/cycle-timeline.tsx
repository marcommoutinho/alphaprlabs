import type { CSSProperties } from "react";
import type { Timeline } from "@/lib/cycles/views";

const span = (from: number, to: number): CSSProperties => ({ gridColumn: `${from} / ${to + 1}` });

/**
 * R4's per-peptide timeline (the prototype's lanes): one day per column, phase
 * bars (active solid, a planned increase brighter and taller, breaks
 * hatched), one marker per dose in its state, and the Today line. Scrolls
 * sideways on phone. Markers are read-only until confirming a dose from
 * here exists (S12).
 */
export function CycleTimeline({ timeline }: { timeline: Timeline }) {
  const columns = { "--cv-days": timeline.total } as CSSProperties;
  return (
    <>
      <div className="app-cv-timeline" data-testid="cycle-timeline">
        <div className="app-cv-timeline-inner">
          <div className="app-cv-months" style={columns}>
            {timeline.months.map((month) => (
              <span key={month.from} style={span(month.from, month.to)}>
                {month.label}
              </span>
            ))}
          </div>
          <div className="app-cv-lanes">
            {timeline.lanes.map((lane) => (
              <div key={lane.planId} className="app-cv-lane" style={columns} data-testid="cycle-lane">
                <div className="app-cv-lane-name">
                  <b>{lane.name}</b> <span>{lane.sub}</span>
                </div>
                {lane.bars.map((bar, index) => (
                  <div
                    key={`bar-${index}`}
                    className="app-cv-bar"
                    data-kind={bar.kind}
                    data-raised={bar.raised || undefined}
                    title={bar.title}
                    style={span(bar.from, bar.to)}
                  />
                ))}
                {lane.dots.map((dot) => (
                  <span
                    key={dot.key}
                    role="img"
                    className="app-cv-dot"
                    data-state={dot.state}
                    title={dot.label}
                    aria-label={dot.label}
                    style={span(dot.day, dot.day)}
                  />
                ))}
                {lane.bars.map((bar, index) => (
                  <div key={`cap-${index}`} className="app-cv-cap" data-raised={bar.raised || undefined} style={span(bar.from, bar.to)}>
                    {bar.caption}
                  </div>
                ))}
              </div>
            ))}
            {timeline.todayPercent !== null ? (
              <>
                <div className="app-cv-today" style={{ left: `${timeline.todayPercent}%` }} />
                <div className="app-cv-today-label" style={{ left: `${timeline.todayPercent}%` }}>
                  Today
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="app-cv-legend">
        <span>
          <i data-state="taken" />
          Actual
        </span>
        <span>
          <i data-state="due" />
          Due today
        </span>
        <span>
          <i data-state="planned" />
          Planned
        </span>
        <span>
          <i data-state="open" />
          Unconfirmed
        </span>
      </div>
    </>
  );
}
