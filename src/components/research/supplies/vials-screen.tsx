"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { setTrackingAction } from "@/app/(private)/app/supplies/actions";
import { lowCounter, useNavCount } from "@/components/alpha/shell/nav-counts";
import { LevelMeter } from "@/components/alpha/gauges";
import { Group, GroupLabel } from "@/components/alpha/list";
import { Tag } from "@/components/alpha/tag";
import { NEVER_ADDS, NO_VIALS, SUPPLIES_INTRO, TRACKING_OFF, VIALS_FOOTNOTE } from "@/lib/supplies/rules";
import type { SuppliesView, UnopenedGroup, VialCard } from "@/lib/supplies/view";
import { cn } from "@/lib/utils";
import { SUPPLIES_MAIN, SuppliesHeader, TrackingOff, TrackingSwitch, useSheetAction } from "./supplies-shared";
import { AddVialSheet, UnopenedSheet, VialSheet } from "./vial-sheets";
import { vialName } from "@/lib/supplies/name";

/**
 * R7 Supplies · Vials (design v3), and its laptop layout: vials in use with
 * what's left, how far it goes and a Low / Empty / Over tag; unopened vials
 * by peptide and strength; finished ones. Tapping a vial opens its sheet
 * (correct remaining, details, history, mark finished). The round + adds a
 * vial. With tracking off the list is hidden. Low is Marco's rule: less
 * than the next planned dose (not the design's "3 days").
 */
export function VialsScreen({ view }: { view: SuppliesView }) {
  const tracking = useSheetAction(setTrackingAction);
  const [target, setTarget] = useState(view.tracking);
  const on = tracking.pending ? target : view.tracking;
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [group, setGroup] = useState<UnopenedGroup | null>(null);
  const all = [...view.inUse, ...view.unopened.flatMap((g) => g.vials), ...view.finished];
  const open = all.find((v) => v.id === openId) ?? null;
  useNavCount("supplies", view.tracking ? lowCounter(view.lowCount) : null);

  const toggle = (next: boolean) => {
    setTarget(next);
    tracking.run({ enabled: next });
  };
  const unopenedCount = view.unopened.reduce((sum, g) => sum + g.vials.length, 0);

  return (
    <main className={SUPPLIES_MAIN}>
      <SuppliesHeader current="vials" addLabel="Add vial" onAdd={view.tracking ? () => setAdding(true) : null} />

      {!view.tracking ? (
        <TrackingOff title="Vial tracking is off" body={TRACKING_OFF} pending={tracking.pending} onTurnOn={() => toggle(true)} testId="supplies-off" />
      ) : (
        <div className="laptop:mt-2 laptop:grid laptop:grid-cols-12 laptop:items-start laptop:gap-6">
          <div className="laptop:col-span-7">
            {!view.hasVials ? (
              <p className="mx-5 mt-6 text-[15px] leading-[22px] text-ink-2 laptop:mx-0" data-testid="supplies-empty">
                {NO_VIALS}
              </p>
            ) : null}
            {view.inUse.length ? (
              <section aria-labelledby="vials-in-use" className="mt-[22px]">
                <GroupLabel id="vials-in-use" className="laptop:px-0">
                  In use · {view.inUse.length}
                </GroupLabel>
                <Group className="mx-3 laptop:mx-0">
                  {view.inUse.map((vial) => (
                    <VialRow key={vial.id} vial={vial} onOpen={() => setOpenId(vial.id)} />
                  ))}
                </Group>
              </section>
            ) : null}
            {view.hasVials ? <p className="mx-5 mt-3 text-[13px] leading-[19px] text-ink-3 laptop:mx-0">{VIALS_FOOTNOTE}</p> : null}
          </div>

          <div className="laptop:col-span-5">
            {view.unopened.length ? (
              <section aria-labelledby="vials-unopened" className="mt-[22px]">
                <GroupLabel id="vials-unopened" className="laptop:px-0">
                  Unopened · {unopenedCount}
                </GroupLabel>
                <Group className="mx-3 laptop:mx-0">
                  {view.unopened.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      className="flex h-[52px] w-full cursor-pointer items-center justify-between gap-3 px-4 text-left text-base hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]"
                      onClick={() => (g.vials.length === 1 ? setOpenId(g.vials[0].id) : setGroup(g))}
                      data-testid="unopened-row"
                    >
                      <span className="min-w-0 truncate">{g.title}</span>
                      <span className="shrink-0 font-mono text-[15px] font-semibold">× {g.vials.length}</span>
                    </button>
                  ))}
                </Group>
              </section>
            ) : null}
            {view.finished.length ? (
              <section aria-labelledby="vials-finished" className="mt-[22px]">
                <GroupLabel id="vials-finished" className="laptop:px-0">
                  Finished · {view.finished.length}
                </GroupLabel>
                <Group className="mx-3 laptop:mx-0">
                  {view.finished.map((vial) => (
                    <button
                      key={vial.id}
                      type="button"
                      className="flex min-h-[60px] w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]"
                      onClick={() => setOpenId(vial.id)}
                      data-testid="finished-row"
                      aria-label={`${vial.title}, ${vialName(vial.label, true)}, finished`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold text-ink-2">{vial.title}</span>
                        <span className="mt-0.5 block font-mono text-[12px] text-ink-3">{vial.meta}</span>
                      </span>
                      <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
                    </button>
                  ))}
                </Group>
              </section>
            ) : null}
          </div>
        </div>
      )}

      <TrackingSwitch
        label="Track vials"
        on={on}
        pending={tracking.pending}
        onChange={toggle}
        note={`${SUPPLIES_INTRO} ${NEVER_ADDS}`}
        className="laptop:max-w-[560px]"
      />

      <AddVialSheet open={adding} view={view} onClose={() => setAdding(false)} />
      <UnopenedSheet
        group={group}
        onClose={() => setGroup(null)}
        onPick={(id) => {
          setGroup(null);
          setOpenId(id);
        }}
      />
      <VialSheet vial={open} view={view} onClose={() => setOpenId(null)} />
    </main>
  );
}

/** An in-use vial (R7): title and tag, mono meta, the meter, what's left and how far it goes. */
function VialRow({ vial, onOpen }: { vial: VialCard; onOpen: () => void }) {
  const low = vial.tag !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full cursor-pointer px-4 py-3.5 text-left hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]"
      data-testid="vial-card"
      data-open={vial.open}
      data-tone={vial.tone}
      data-tag={vial.tag ?? undefined}
      aria-label={`${vial.title}, ${vialName(vial.label, true)}: ${vial.left}${vial.tag ? `, ${vial.tag}` : ""}`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-base font-semibold">{vial.title}</span>
        {vial.tag ? (
          <Tag tone="low" data-testid="vial-tag">
            {vial.tag}
          </Tag>
        ) : null}
      </span>
      <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-3" data-slot="meta">
        {vial.meta}
      </span>
      <LevelMeter value={vial.percent / 100} low={low} label={`${vialName(vial.label)} remaining`} className="mt-3" />
      <span className="mt-2 flex items-baseline justify-between gap-3 text-[14px]">
        <span className={cn("shrink-0 font-semibold whitespace-nowrap", low && "text-low")} data-testid="vial-left">
          {vial.left}
        </span>
        <span className="min-w-0 truncate text-right text-ink-2" data-testid="vial-forecast">
          {vial.forecast}
        </span>
      </span>
    </button>
  );
}
