import Link from "next/link";
import { ChevronRight, Layers, Plus } from "lucide-react";
import { buttonVariants } from "@/components/alpha/button-variants";
import { Group, GroupLabel } from "@/components/alpha/list";
import { StateGlyph } from "@/components/alpha/state-glyph";
import type { CycleCard, CycleGroup } from "@/lib/cycles/screens";
import { cn } from "@/lib/utils";
import { DayRuler } from "./lanes";

// Every link on the Cycles screens has prefetch={false}: in Next.js 16.2 a
// <Link> clicked while its prefetch is still in flight can commit an empty
// page (no content, no loading skeleton) until a reload (vercel/next.js#98684;
// seen here on card → detail and Browse templates). Each Cycles route has its
// own loading.tsx, so the navigation still shows a skeleton while it loads.

/** The page frame every Cycles screen shares (Today's): phone gutters, laptop max width. */
export const CYCLES_MAIN =
  "mx-auto flex w-full max-w-[1200px] flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-8 laptop:pt-6 laptop:pb-16";

/** "Cycles" and the 44 px ink round + (R10). */
export function CyclesHeader() {
  return (
    <header className="flex items-end justify-between pt-2 pr-3 pl-5 laptop:px-0">
      <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Cycles</h1>
      <Link prefetch={false} href="/app/cycles/new" aria-label="New cycle" className={buttonVariants({ variant: "ink", size: "icon" })}>
        <Plus className="size-5" aria-hidden />
      </Link>
    </header>
  );
}

/**
 * R10 Cycles (design v3): Active cards with their day ruler, next dose and
 * adherence; dashed Upcoming cards; Ended rows with their adherence; and
 * "Browse templates". Empty: the dashed block with Build a cycle / Templates.
 */
export function CyclesList({ groups }: { groups: { group: CycleGroup; label: string; cards: CycleCard[] }[] }) {
  return (
    <main className={CYCLES_MAIN}>
      <CyclesHeader />
      {groups.length === 0 ? <EmptyCycles /> : null}
      {groups.map((group) => (
        <section key={group.group} aria-label={group.label} data-testid="cycle-group" data-group={group.group} className="mt-5 laptop:mt-7">
          <GroupLabel className="laptop:px-0">
            <h2>{group.label}</h2>
          </GroupLabel>
          {group.group === "ended" ? (
            <Group className="mx-3 laptop:mx-0 laptop:max-w-[760px]">
              {group.cards.map((card) => (
                <EndedRow key={card.id} card={card} />
              ))}
            </Group>
          ) : (
            <div className="mx-3 grid gap-2.5 laptop:mx-0 laptop:grid-cols-2 laptop:gap-4">
              {group.cards.map((card) => (group.group === "upcoming" ? <UpcomingCard key={card.id} card={card} /> : <ActiveCard key={card.id} card={card} />))}
            </div>
          )}
        </section>
      ))}
      {groups.length ? (
        <Link
          prefetch={false}
          href="/app/cycles/templates"
          className="mx-3 mt-3 flex h-[52px] items-center gap-2.5 rounded-[16px] bg-sunken px-4 text-[15px] font-semibold laptop:mx-0 laptop:mt-4 laptop:max-w-[760px]"
        >
          <Layers className="size-[18px]" aria-hidden />
          <span className="flex-1">Browse templates</span>
          <ChevronRight className="size-[18px] text-ink-3" aria-hidden />
        </Link>
      ) : null}
    </main>
  );
}

function ActiveCard({ card }: { card: CycleCard }) {
  return (
    <Link prefetch={false} href={`/app/cycles/${card.id}`} className="block rounded-[24px] border border-line bg-surface p-4" data-testid="cycle-card" data-status={card.status}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[18px] font-semibold" data-slot="name">
          {card.name}
        </span>
        <span className="shrink-0 font-mono text-[13px] font-semibold" data-slot="day">
          {card.dayLabel}
        </span>
      </span>
      <span className="mt-0.5 block text-[14px] text-ink-2" data-slot="peptides">
        {card.peptides}
        {card.status === "In break" ? <span className="font-semibold text-ink"> · In break</span> : null}
      </span>
      <DayRuler total={card.total} day={card.day} height={22} className="mt-3.5" />
      <span className="mt-2 flex justify-between font-mono text-[12px] font-medium text-ink-3" aria-hidden>
        <span>{card.startLabel}</span>
        <span>{card.endLabel}</span>
      </span>
      <span className="mt-3.5 flex items-center gap-2.5 border-t border-line pt-3 text-[14px]" data-slot="next">
        {card.next ? (
          <>
            <StateGlyph state={card.next.due ? "due" : "upcoming"} size={20} />
            <span className="min-w-0 flex-1">
              <b className="font-semibold">{card.next.title}</b>{" "}
              <span className={cn(card.next.due ? "font-semibold text-signal-ink" : "text-ink-2")}>{card.next.when}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-ink-2">No doses left</span>
        )}
        {card.missed ? <span className="shrink-0 font-mono text-[13px] font-semibold text-missed">{card.missed} missed</span> : null}
        <span className="shrink-0 font-mono text-[13px] font-semibold text-ink-2" data-slot="adherence" aria-label={`Adherence ${card.adherence}`}>
          {card.adherence}
        </span>
      </span>
    </Link>
  );
}

function UpcomingCard({ card }: { card: CycleCard }) {
  return (
    <Link prefetch={false} href={`/app/cycles/${card.id}`} className="block rounded-[24px] border-[1.5px] border-dashed border-ink-3 p-4" data-testid="cycle-card" data-status={card.status}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[18px] font-semibold" data-slot="name">
          {card.name}
        </span>
        <span className="shrink-0 font-mono text-[13px] font-medium text-ink-2" data-slot="day">
          {card.startsLabel}
        </span>
      </span>
      <span className="mt-0.5 block text-[14px] text-ink-2" data-slot="peptides">
        {card.peptides} · {card.lengthLabel}
      </span>
      {card.next ? (
        <span className="mt-2 block text-[13px] text-ink-3" data-slot="next">
          First: {card.next.title}, {card.next.when.replace(/^next /, "")}
        </span>
      ) : null}
    </Link>
  );
}

function EndedRow({ card }: { card: CycleCard }) {
  return (
    <Link prefetch={false} href={`/app/cycles/${card.id}`} className="flex items-center gap-2.5 py-3 pr-3 pl-4" data-testid="cycle-card" data-status={card.status}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold" data-slot="name">
          {card.name}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-3" data-slot="peptides">
          {card.rangeLabel} · {card.peptides.replaceAll(" · ", ", ")}
        </span>
      </span>
      {card.missed ? <span className="shrink-0 font-mono text-[13px] font-semibold text-missed">{card.missed} missed</span> : null}
      <span className="shrink-0 font-mono text-[13px] font-semibold" data-slot="adherence" aria-label={`Adherence ${card.adherence}`}>
        {card.adherence}
      </span>
      <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

/** No cycle yet (R1's empty block, for Cycles). */
function EmptyCycles() {
  return (
    <section className="mx-3 mt-5 flex flex-col items-start rounded-[24px] border-[1.5px] border-dashed border-ink-3 px-5 py-6 laptop:mx-0 laptop:max-w-[640px]" data-testid="cycles-empty">
      <h2 className="text-[20px] font-semibold tracking-[-0.015em]">No cycles yet</h2>
      <p className="mt-1 text-[15px] leading-[22px] text-ink-2">
        Build one from scratch, or start from a template the team maintains and adjust it.
      </p>
      <div className="mt-4 flex gap-2">
        <Link prefetch={false} href="/app/cycles/new" className={buttonVariants({ variant: "ink", size: "md" })}>
          Build a cycle
        </Link>
        <Link prefetch={false} href="/app/cycles/templates" className={buttonVariants({ variant: "outline", size: "md" })}>
          Templates
        </Link>
      </div>
    </section>
  );
}
