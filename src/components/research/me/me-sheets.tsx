"use client";

import Image from "next/image";
import { Check, Shield } from "lucide-react";
import { Button } from "@/components/alpha/button";
import { useOnline } from "@/components/alpha/online";
import { Sheet, SheetContent } from "@/components/alpha/sheet";
import {
  R17_ALLOW,
  R17_CANT,
  R17_SEE,
  R17_TITLE,
  R17_WHO,
  R17_WHO_SUB,
  STOP_KEEP,
  STOP_POINTS,
  STOP_TITLE,
} from "@/lib/support/view";
import { cn } from "@/lib/utils";

/**
 * R17 Share history with admins: who would see it (Alpha PR Labs admins,
 * never a named admin), what they would see and what they can't do, before
 * anything changes. "Allow read-only access" shares; "Not now" closes.
 */
export function ShareSheet({
  open,
  pending,
  onAllow,
  onClose,
}: {
  open: boolean;
  pending: boolean;
  onAllow: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent
        size="auto"
        title={R17_TITLE}
        leading={
          <span className="flex size-11 items-center justify-center rounded-[14px] bg-sunken" aria-hidden>
            <Shield className="size-[22px]" />
          </span>
        }
        footer={
          <div className="flex flex-col gap-2">
            <Button needsConnection block saving={pending} onClick={onAllow} data-testid="share-allow">
              {R17_ALLOW}
            </Button>
            <Button variant="ghost" size="md" block className="h-12 text-[16px] text-ink" disabled={pending} onClick={onClose}>
              Not now
            </Button>
          </div>
        }
      >
        <div className="flex items-center gap-3 rounded-group border border-line bg-surface px-4 py-3.5" data-testid="share-who">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-sunken">
            <Image src="/logo.jpeg" alt="" width={26} height={26} className="size-[26px] rounded-[7px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">{R17_WHO}</span>
            <span className="mt-0.5 block text-[13px] text-ink-2">{R17_WHO_SUB}</span>
          </span>
        </div>
        <div className="mx-2 mt-1 grid grid-cols-2 gap-4 text-[14px] leading-[1.4]">
          <section aria-labelledby="share-see">
            <h3 id="share-see" className="text-[13px] font-semibold text-ink-2">
              They&apos;ll see
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {R17_SEE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="share-cant">
            <h3 id="share-cant" className="text-[13px] font-semibold text-ink-2">
              They can&apos;t
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-ink-2">
              {R17_CANT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * R8's switch turned off: a confirmation first (Marco, 2026-09-27: "Revoking
 * (stop sharing) asks for confirmation first"; the design turns it off at
 * once). Stopping takes effect for every admin straight away.
 */
export function StopSheet({ open, pending, onStop, onClose }: { open: boolean; pending: boolean; onStop: () => void; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent
        size="auto"
        title={STOP_TITLE}
        footer={
          <>
            <Button variant="outline" className="w-[128px]" disabled={pending} onClick={onClose}>
              {STOP_KEEP}
            </Button>
            <Button needsConnection variant="ink" saving={pending} onClick={onStop} data-testid="stop-sharing">
              Stop sharing
            </Button>
          </>
        }
      >
        <ul className="mx-2 flex flex-col gap-2 text-[15px] leading-[22px] text-ink-2">
          {STOP_POINTS.map((point) => (
            <li key={point} className="flex gap-2.5">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden />
              {point}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

export type Choice<V extends string | number> = { value: V; label: string; note: string };

/**
 * One preference's choices (R8 Preferences rows): a radio list in a sheet.
 * Picking one saves it at once and closes the sheet; picking the saved one
 * (checked) just closes it.
 */
export function ChoiceSheet<V extends string | number>({
  open,
  title,
  value,
  choices,
  pending,
  onPick,
  onClose,
  testId,
}: {
  open: boolean;
  title: string;
  /** The saved choice, checked; null when nothing is saved yet. */
  value: V | null;
  choices: readonly Choice<V>[];
  pending: boolean;
  onPick: (value: V) => void;
  onClose: () => void;
  testId: string;
}) {
  // A choice is saved with the account: offline it waits for the connection.
  const online = useOnline();
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent size="auto" title={title}>
        <div role="radiogroup" aria-label={title} className="divide-y divide-line overflow-hidden rounded-group border border-line bg-surface" data-testid={testId}>
          {choices.map((choice) => {
            const checked = choice.value === value;
            return (
              <button
                key={String(choice.value)}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={pending || !online}
                onClick={() => (checked ? onClose() : onPick(choice.value))}
                className={cn(
                  "flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left",
                  "hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)] disabled:cursor-default disabled:opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">{choice.label}</span>
                  <span className="mt-0.5 block text-[13px] text-ink-2">{choice.note}</span>
                </span>
                {checked ? <Check className="size-5 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
