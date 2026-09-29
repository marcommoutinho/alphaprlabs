import { Eye, Lock } from "lucide-react";
import { NowBlock } from "@/components/alpha/now-block";
import { StateGlyph } from "@/components/alpha/state-glyph";
import { BackBar } from "@/components/admin/states";
import Link from "@/components/alpha/link";
import { deniedHistory, PEOPLE_PATH, type RecentRow, type ResearcherHistory } from "@/lib/people/view";
import { cn } from "@/lib/utils";

const FRAME = "mx-auto flex w-full max-w-[1200px] flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-9 laptop:pt-7 laptop:pb-16";

function Back() {
  return (
    <>
      <BackBar href={PEOPLE_PATH} label="People" />
      <Link href={PEOPLE_PATH} className="hidden text-[14px] text-signal-ink laptop:block">
        ‹ People
      </Link>
    </>
  );
}

/**
 * A12 Researcher history, read-only: the pinned band says whose permission
 * this is; the researcher's own numbers (adherence this cycle, feeling,
 * weight in the viewing admin's unit, effect days) and their recent doses
 * and check-ins, with every action removed.
 */
export function ResearcherHistoryScreen({ history }: { history: ResearcherHistory }) {
  const { now } = history;
  return (
    <main className={FRAME} data-testid="researcher-history">
      <Back />
      <div className="sticky top-[env(safe-area-inset-top)] z-10 bg-paper px-3 pb-1 laptop:top-0 laptop:mt-3 laptop:max-w-[760px] laptop:px-0 laptop:pt-2">
        <div className="flex items-center gap-2.5 rounded-[14px] bg-done-tint px-3.5 py-2.5 text-[14px] font-semibold text-done" role="note" data-testid="history-banner">
          <Eye className="size-4 shrink-0" aria-hidden />
          {history.banner}
        </div>
      </div>
      <div className="laptop:max-w-[760px]">
        <header className="px-5 pt-4 laptop:px-0">
          <h1 className="text-[32px] leading-[1.15] font-semibold tracking-[-0.03em] break-words">{history.name}</h1>
          <div className="mt-0.5 font-mono text-[13px] text-ink-2" data-testid="history-sub">
            {history.sub}
          </div>
        </header>

        <NowBlock className="mx-3 mt-4 laptop:mx-0" aria-label={now.label} data-testid="history-now">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-on-ink-2">{now.label}</span>
            {now.count ? <span className="font-mono text-[12px] font-medium text-on-ink-2">{now.count}</span> : null}
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-[64px] leading-[.85] font-semibold tracking-[-0.05em]" data-testid="history-adherence">
              {now.percent}
            </span>
            {now.percent !== "—" ? <span className="font-mono text-[18px] text-on-ink-2">%</span> : null}
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[color-mix(in_oklab,currentColor_12%,transparent)] pt-3.5">
            <Reading term="Feeling" value={now.feeling ?? "—"} unit={now.feeling ? "/ 5" : ""} />
            <Reading term="Weight" value={now.weight?.value ?? "—"} unit={now.weight?.unit ?? ""} testId="history-weight" />
            <Reading term="Effects" value={String(now.effectDays)} unit={now.effectDays === 1 ? "day" : "days"} />
          </dl>
        </NowBlock>

        <h2 className="mx-5 mt-6 mb-1 text-[20px] font-semibold tracking-[-0.015em] laptop:mx-0">Recent</h2>
        {history.recent.length === 0 ? (
          <p className="mx-5 mt-2 text-[15px] text-ink-2 laptop:mx-0">No doses or check-ins recorded yet.</p>
        ) : (
          <ul className="mx-5 flex flex-col laptop:mx-0" data-testid="history-recent">
            {history.recent.map((row) => (
              <RecentItem key={row.key} row={row} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function Reading({ term, value, unit, testId }: { term: string; value: string; unit: string; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-on-ink-2">{term}</dt>
      <dd className="mt-0.5 truncate text-[20px] font-semibold" data-testid={testId}>
        {value} {unit ? <span className="font-mono text-[12px] font-normal text-on-ink-2">{unit}</span> : null}
      </dd>
    </div>
  );
}

function RecentItem({ row }: { row: RecentRow }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-3 border-b border-line py-3 last:border-b-0" data-testid="recent-row" data-kind={row.kind}>
      {row.kind === "check-in" ? (
        <span aria-hidden className="flex size-6 items-center justify-center rounded-[6px] bg-sunken text-[13px] font-semibold">
          {row.feeling}
        </span>
      ) : (
        <StateGlyph state={row.kind === "done" ? "done" : row.kind === "skipped" ? "skipped" : "overdue"} size={24} />
      )}
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold break-words">
          {row.title}
          {row.flag ? <span className={cn(row.kind === "missed" ? "text-missed" : "text-ink-3")}> {row.flag}</span> : null}
        </span>
        <span className="mt-0.5 block font-mono text-[12px] break-words text-ink-3">{row.sub}</span>
      </span>
    </li>
  );
}

/** A12 without a share now: the name, the email and that only they can share. Nothing else about them. */
export function HistoryDenied({ name, email }: { name: string; email: string }) {
  return (
    <main className={FRAME} data-testid="history-denied">
      <Back />
      <div className="laptop:max-w-[560px]">
        <header className="px-5 pt-3 laptop:px-0">
          <h1 className="text-[32px] leading-[1.15] font-semibold tracking-[-0.03em] break-words">{name}</h1>
          <div className="mt-0.5 font-mono text-[13px] text-ink-2">{email}</div>
        </header>
        <section className="mx-3 mt-5 rounded-now border border-line bg-surface px-5 py-5 laptop:mx-0">
          <span aria-hidden className="flex size-11 items-center justify-center rounded-[14px] bg-sunken text-ink-2">
            <Lock className="size-5" />
          </span>
          <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.015em]">History is private</h2>
          <p className="mt-1.5 text-[15px] leading-[1.45] text-ink-2" data-testid="denied-text">
            {deniedHistory(name)}
          </p>
        </section>
      </div>
    </main>
  );
}
