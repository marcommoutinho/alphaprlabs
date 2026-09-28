import Link from "@/components/alpha/link";
import { ChevronLeft, ChevronRight, FlaskConical } from "lucide-react";
import { buttonVariants } from "@/components/alpha/button-variants";
import { Group, GroupLabel, Row } from "@/components/alpha/list";
import { NowBlock } from "@/components/alpha/now-block";
import { Tag } from "@/components/alpha/tag";
import { massLabel } from "@/lib/alpha/format";
import { daysLabel } from "@/lib/cycles/geometry";
import type { CycleScreen, PlanView } from "@/lib/cycles/screens";
import { cn } from "@/lib/utils";
import { CYCLES_MAIN } from "./cycles-list";
import { HistoryList, HistoryTable } from "./history";
import { CardLane, DayRuler, Timeline } from "./lanes";

/** How many history rows the cycle shows before "See all" (R3: 4; D2's table a few more). */
const PHONE_HISTORY = 4;
const LAPTOP_HISTORY = 8;

/**
 * R3 Cycle detail (phone) and D2 (laptop), design v3: the day of the cycle
 * as the Now block's reading with its ruler, adherence / missed / skipped,
 * each peptide's lane, phases and mix, and the history, where a missed dose
 * links to its log-late sheet. The laptop puts every lane on one timeline.
 */
export function CycleDetail({ screen }: { screen: CycleScreen }) {
  const edit = `/app/cycles/${screen.id}/edit`;
  const all = `/app/cycles/${screen.id}/history`;
  const { tiles } = screen;
  return (
    <main className={CYCLES_MAIN}>
      <nav aria-label="Cycle" className="flex h-11 items-center justify-between pr-3 pl-1.5 text-[17px] text-signal-ink laptop:hidden">
        <Link href="/app/cycles" className="flex h-11 items-center gap-0.5">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Cycles
        </Link>
        <Link href={edit} className="flex h-11 items-center px-2 font-medium" aria-label="Edit future plan">
          Edit
        </Link>
      </nav>

      <header className="flex items-end gap-4 px-5 pt-1.5 laptop:px-0 laptop:pt-0">
        <div className="flex min-w-0 flex-col">
          <Link href="/app/cycles" className="hidden text-[14px] text-signal-ink laptop:block">
            ‹ Cycles
          </Link>
          <h1 className="mt-1 text-[32px] leading-[1.15] font-semibold tracking-[-0.03em]">{screen.name}</h1>
          <div className="order-first font-mono text-[13px] font-medium text-ink-3 laptop:order-none laptop:mt-0.5" data-testid="cycle-status" data-status={screen.status}>
            {screen.header}
            {screen.from ? <span className="hidden laptop:inline"> · {screen.from}</span> : null}
          </div>
          <p className="mt-1 text-[14px] text-ink-2 laptop:hidden" data-testid="cycle-subtitle">
            {screen.subtitle}
          </p>
        </div>
        <Link href={edit} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto hidden text-[14px] laptop:inline-flex")}>
          Edit future plan
        </Link>
      </header>

      <div className="mt-[18px] px-3 laptop:mt-4 laptop:grid laptop:grid-cols-12 laptop:gap-4 laptop:px-0">
        <NowBlock aria-label="Cycle day" className="laptop:col-span-9 laptop:px-6" data-testid="cycle-now">
          <div className="flex items-end justify-between gap-4">
            <div className="laptop:flex laptop:items-baseline laptop:gap-2">
              <div className="text-[13px] text-on-ink-2 laptop:mt-1 laptop:self-start">{screen.now.label}</div>
              <div className="mt-1 flex items-baseline gap-2 laptop:mt-0">
                <span className="text-[80px] leading-[0.8] font-semibold tracking-[-0.055em] laptop:text-[72px]" data-slot="reading">
                  {screen.now.value}
                </span>
                <span className="font-mono text-[18px] text-on-ink-2">{screen.now.unit}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-base font-semibold">{screen.now.right}</div>
              <div className="mt-0.5 text-[13px] text-on-ink-2">{screen.now.rightSub}</div>
            </div>
          </div>
          <DayRuler onInk total={screen.ticks.total} day={screen.ticks.day} labels={screen.ticks.labels} className="mt-5 laptop:hidden" />
          <DayRuler onInk total={screen.ticks.total} day={screen.ticks.day} height={28} tick={3} className="mt-[18px] hidden laptop:block" />
        </NowBlock>

        <div className="mt-3 grid grid-cols-[1.3fr_1fr_1fr] gap-2 laptop:hidden">
          <Tile label="Adherence" value={tiles.adherence.value} unit={tiles.adherence.unit} context={tiles.adherence.context} testId="tile-adherence" />
          <Tile label="Missed" value={String(tiles.missed.count)} context={tiles.missed.context} missed={tiles.missed.count > 0} testId="tile-missed" />
          <Tile label="Skipped" value={String(tiles.skipped.count)} context={tiles.skipped.context} testId="tile-skipped" />
        </div>
        <div className="hidden gap-2 laptop:col-span-3 laptop:grid laptop:grid-rows-2">
          <WideTile label="Adherence" context={tiles.adherence.short} value={tiles.adherence.value} unit={tiles.adherence.unit} testId="tile-adherence-laptop" />
          <WideTile
            label="Missed · skipped"
            context={tiles.missed.count ? `${tiles.missed.context} open` : "None missed"}
            missed={tiles.missed.count > 0}
            value={`${tiles.missed.count} · ${tiles.skipped.count}`}
            testId="tile-missed-laptop"
          />
        </div>
      </div>

      <div className="mt-4 hidden laptop:block">
        <Timeline
          axis={screen.axis}
          todayPercent={screen.todayPercent}
          rows={screen.plans.map((plan) => ({
            planId: plan.planId,
            name: plan.name,
            sub: plan.cadence,
            meta: plan.mix ? [plan.mix.concentration, plan.mix.units].filter(Boolean).join(" · ") : "No saved mix",
            bars: plan.bars.map((bar) => ({
              ...bar,
              text: bar.kind === "break" ? "Break" : `${massLabel(bar.doseMg!)} · ${daysLabel(bar.from, bar.to).toLowerCase()}`,
            })),
          }))}
        />
      </div>

      <section aria-labelledby="cycle-peptides" className="mt-7 laptop:mt-6">
        <div className="mb-2.5 flex items-baseline justify-between px-5 laptop:px-0">
          <h2 id="cycle-peptides" className="text-[20px] font-semibold tracking-[-0.015em]">
            Peptides
          </h2>
          <span className="font-mono text-[13px] font-medium text-ink-3">{screen.plans.length}</span>
        </div>
        <div className="mx-3 flex flex-col gap-2.5 laptop:mx-0 laptop:grid laptop:grid-cols-2 laptop:items-start laptop:gap-4">
          {screen.plans.map((plan) => (
            <PlanCard key={plan.planId} plan={plan} todayPercent={screen.todayPercent} />
          ))}
        </div>
      </section>

      <section aria-labelledby="cycle-history" className="mt-7 laptop:mt-6 laptop:rounded-[24px] laptop:border laptop:border-line laptop:bg-surface laptop:px-6 laptop:pt-3.5 laptop:pb-2">
        <div className="mb-1 flex items-baseline justify-between px-5 laptop:px-0">
          <h2 id="cycle-history" className="text-[20px] font-semibold tracking-[-0.015em] laptop:text-base">
            History
          </h2>
          {screen.history.length ? (
            <Link href={all} className="text-[15px] font-semibold laptop:text-[14px]" data-testid="history-all">
              <span className="laptop:hidden">See all {screen.history.length}</span>
              <span className="hidden laptop:inline">All {screen.history.length}</span>
            </Link>
          ) : null}
        </div>
        {screen.history.length ? (
          <>
            <HistoryList items={screen.history.slice(0, PHONE_HISTORY)} className="mx-5 laptop:hidden" />
            <div className="hidden laptop:block">
              <HistoryTable items={screen.history.slice(0, LAPTOP_HISTORY)} />
            </div>
          </>
        ) : (
          <p className="mx-5 py-3 text-[15px] text-ink-2 laptop:mx-0">No doses yet. They appear here once their day comes.</p>
        )}
      </section>

      <section aria-label="About this cycle" className="mt-7 laptop:mt-6 laptop:max-w-[760px]">
        <GroupLabel className="laptop:px-0">About this cycle</GroupLabel>
        <Group className="mx-3 laptop:mx-0">
          <Row density="settings" title="Goal" value={screen.goal || "—"} />
          <Row density="settings" title="Baseline" value={screen.baseline || "Not set"} />
          <Row density="settings" title="Time zone" value={screen.timeZone} />
          <Row density="settings" title="Results" href={`/app/progress?cycle=${screen.id}`} chevron />
        </Group>
      </section>
    </main>
  );
}

function Tile({ label, value, unit, context, missed = false, testId }: { label: string; value: string; unit?: string; context: string; missed?: boolean; testId: string }) {
  return (
    <div className="min-w-0 rounded-group border border-line bg-surface p-3.5" data-testid={testId}>
      <div className="text-[13px] font-medium text-ink-2">{label}</div>
      <div className="mt-2 flex items-baseline gap-0.5">
        <span className="text-[30px] leading-none font-semibold tracking-[-0.03em]" data-slot="value">
          {value}
        </span>
        {unit ? <span className="font-mono text-[14px] font-medium text-ink-2">{unit}</span> : null}
      </div>
      <div className={cn("mt-1 truncate text-[12px]", missed ? "font-semibold text-missed" : "text-ink-3")} data-slot="context">
        {context}
      </div>
    </div>
  );
}

function WideTile({ label, value, unit, context, missed = false, testId }: { label: string; value: string; unit?: string; context: string; missed?: boolean; testId: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] border border-line bg-surface px-4 py-3" data-testid={testId}>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink-2">{label}</span>
        <span className={cn("block truncate text-[12px]", missed ? "font-semibold text-missed" : "text-ink-3")}>{context}</span>
      </span>
      <span className="shrink-0 text-[28px] font-semibold tracking-[-0.03em]" data-slot="value">
        {value}
        {unit ? <span className="font-mono text-[14px] font-medium text-ink-2">{unit}</span> : null}
      </span>
    </div>
  );
}

function PlanCard({ plan, todayPercent }: { plan: PlanView; todayPercent: number | null }) {
  const mixHref = `/app/calculator?plan=${plan.planId}`;
  return (
    <article className="rounded-[24px] border border-line bg-surface p-4" data-testid="cycle-plan-card" aria-labelledby={`plan-${plan.planId}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`plan-${plan.planId}`} className="flex min-w-0 items-center gap-2 text-[18px] font-semibold">
          <span className="truncate">{plan.name}</span>
          {plan.notOffered ? <Tag tone="outline">Not offered</Tag> : null}
        </h3>
        <span className="shrink-0 font-mono text-[13px] font-medium text-ink-2" data-slot="count" aria-label={`${plan.count} doses taken`}>
          {plan.count}
        </span>
      </div>
      <div className="mt-0.5 text-[14px] text-ink-2" data-slot="schedule">
        {plan.schedule}
      </div>
      <CardLane bars={plan.bars} todayPercent={todayPercent} className="mt-3.5 laptop:hidden" />
      <ol className="mt-3 flex flex-col text-[14px]" aria-label={`${plan.name} phases`}>
        {plan.phases.map((phase) => (
          <li key={phase.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line py-2.5" data-testid="phase-row" data-when={phase.when}>
            <span className="min-w-0">
              <span className="font-mono text-[13px] font-semibold">{phase.days}</span>
              <span className="text-ink-3"> · {phase.dates}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className={phase.kind === "break" ? "text-ink-2" : "font-semibold"}>{phase.amount}</span>
              {phase.when === "now" ? <Tag tone="now">Now</Tag> : phase.when === "done" ? <span className="text-[12px] text-ink-3">Done</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <Link href={mixHref} className="flex items-center gap-2.5 rounded-[12px] bg-paper px-3 py-2.5 text-[13px] text-ink-2" data-slot="saved-mixture">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        {plan.mix ? (
          <>
            <span className="min-w-0 flex-1 truncate">{plan.mix.setup}</span>
            {plan.mix.draw ? <span className="shrink-0 font-mono text-[13px] font-semibold text-ink">{plan.mix.draw}</span> : null}
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1">No saved mix — units can&apos;t be shown.</span>
            <span className="shrink-0 font-semibold text-signal-ink">Set one up</span>
          </>
        )}
        <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
      </Link>
      {plan.guidance ? (
        <p className="mt-3 text-[13px] leading-[19px] text-ink-2" data-slot="guidance">
          <span className="font-semibold text-ink">Cycling off · supplied guidance. </span>
          {plan.guidance}
        </p>
      ) : null}
    </article>
  );
}
