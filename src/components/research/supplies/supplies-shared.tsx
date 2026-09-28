"use client";

import { ChevronLeft, Plus } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import { SegmentedLinks } from "@/components/alpha/segmented";
import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { useAlphaToast } from "@/components/alpha/toast";
import { SAVE_FAILED_MESSAGE } from "@/components/app-shell/toast";
import { cn } from "@/lib/utils";
import { CYCLES_MAIN } from "../cycles/cycles-list";

// R7 / R13 Supplies: the header both tabs share (‹ Me, the round +, the
// title and the Vials | Supplements control), the tracking switch, the
// loading state, and the two client helpers their sheets use.

export const SUPPLIES_MAIN = CYCLES_MAIN;

const TABS = [
  { key: "vials", label: "Vials", href: "/app/supplies" },
  { key: "supplements", label: "Supplements", href: "/app/supplements" },
] as const;

export type SuppliesTab = (typeof TABS)[number]["key"];

/** "‹ Me" and the round + (phone), the title, and the Vials | Supplements control. */
export function SuppliesHeader({ current, addLabel, onAdd }: { current: SuppliesTab; addLabel: string; onAdd: (() => void) | null }) {
  return (
    <>
      <nav aria-label="Supplies" className="flex h-11 items-center justify-between pr-3 pl-1.5 text-[17px] text-signal-ink laptop:hidden">
        <Link href="/app/me" className="flex h-11 items-center gap-0.5">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Me
        </Link>
        {onAdd ? (
          <Button variant="soft" size="icon" aria-label={addLabel} onClick={onAdd} data-testid="supplies-add">
            <Plus className="size-5" aria-hidden />
          </Button>
        ) : null}
      </nav>
      <header className="px-5 pt-1 laptop:flex laptop:items-end laptop:gap-4 laptop:px-0 laptop:pt-0">
        <div>
          <Link href="/app/me" className="hidden text-[14px] text-signal-ink laptop:block">
            ‹ Me
          </Link>
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Supplies</h1>
        </div>
        <SegmentedLinks links={TABS} current={current} label="Vials or supplements" className="mt-3.5 laptop:mt-0 laptop:ml-auto laptop:hidden" />
        <div className="hidden items-center gap-3 laptop:ml-auto laptop:flex">
          <SegmentedLinks links={TABS} current={current} label="Vials or supplements (laptop)" size="sm" className="w-[280px]" />
          {onAdd ? (
            <Button variant="ink" size="sm" onClick={onAdd} data-testid="supplies-add-laptop">
              <Plus className="size-4" aria-hidden />
              {addLabel}
            </Button>
          ) : null}
        </div>
      </header>
    </>
  );
}

/** The loading state of both tabs: the real header, then groups at their size. */
export function SuppliesLoading({ label, current }: { label: string; current: SuppliesTab }) {
  return (
    <main className={SUPPLIES_MAIN}>
      <SkeletonRegion label={label}>
        <div className="flex h-11 items-center justify-end pr-3 laptop:hidden">
          <Skeleton className="size-11 rounded-full" />
        </div>
        <header className="px-5 pt-1 laptop:flex laptop:items-end laptop:px-0">
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Supplies</h1>
          <Skeleton className="mt-3.5 h-11 laptop:mt-0 laptop:ml-auto laptop:h-10 laptop:w-[280px]" data-tab={current} />
        </header>
        <div className="mt-[22px] laptop:grid laptop:grid-cols-12 laptop:gap-6">
          <div className="laptop:col-span-7">
            <Skeleton className="mx-5 h-4 w-20 rounded-[6px] laptop:mx-0" />
            <Skeleton className="mx-3 mt-2 h-[236px] rounded-group laptop:mx-0" />
          </div>
          <div className="mt-6 laptop:col-span-5 laptop:mt-0">
            <Skeleton className="mx-5 h-4 w-24 rounded-[6px] laptop:mx-0" />
            <Skeleton className="mx-3 mt-2 h-[158px] rounded-group laptop:mx-0" />
          </div>
        </div>
      </SkeletonRegion>
    </main>
  );
}

/**
 * What tracking does, and where it is switched: the switches live on Me ›
 * Tracking (R8); while on, this note links there.
 */
export function TrackingNote({ note, on, className }: { note: string; on: boolean; className?: string }) {
  return (
    <p className={cn("mx-5 mt-7 text-[13px] leading-[19px] text-ink-3 laptop:mx-0", className)} data-testid="tracking-note">
      {note}
      {on ? (
        <>
          {" "}
          Turn it off in{" "}
          <Link href="/app/me" className="font-semibold text-signal-ink">
            Me › Tracking
          </Link>
          .
        </>
      ) : null}
    </p>
  );
}

/** A tracking-off block with "Turn on" (the list is hidden while it is off). */
export function TrackingOff({ title, body, pending, onTurnOn, testId }: { title: string; body: string; pending: boolean; onTurnOn: () => void; testId: string }) {
  return (
    <section className="mx-3 mt-6 flex flex-col items-start rounded-[24px] border border-line bg-surface px-5 py-6 laptop:mx-0 laptop:max-w-[640px]" data-testid={testId}>
      <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
      <p className="mt-1 text-[15px] leading-[22px] text-ink-2">{body}</p>
      <Button variant="ink" size="md" className="mt-4" saving={pending} onClick={onTurnOn}>
        Turn on
      </Button>
    </section>
  );
}

type ActionResult = { error?: string; toast?: string; tone?: string; saved?: boolean };

/**
 * Runs a server action for a v3 sheet: an inline error under the form, or a
 * toast (success: role="status"; error: role="alert"); `onSaved` when it
 * went through. A redirect (the session ended) goes to Next.js.
 */
export function useSheetAction<I>(action: (input: I) => Promise<ActionResult>) {
  const toast = useAlphaToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (input: I, onSaved?: () => void) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = await action(input);
      } catch (caught) {
        unstable_rethrow(caught);
        toast.error({ message: SAVE_FAILED_MESSAGE });
        return;
      }
      if (result.saved) {
        if (result.toast) toast.success({ message: result.toast });
        onSaved?.();
        return;
      }
      if (result.error) setError(result.error);
      if (result.toast) (result.tone === "error" ? toast.error : toast.success)({ message: result.toast });
    });
  };
  return { pending, error, setError, run };
}

/**
 * One request key per submission: the same details again (a retry, a double
 * tap) send the same key, so the server records the write once; other
 * details get a new key. `done()` forgets it once the write went through.
 */
export function useRequestKey() {
  const current = useRef<{ payload: string; key: string } | null>(null);
  const keyFor = (payload: unknown) => {
    const text = JSON.stringify(payload);
    if (current.current?.payload !== text) current.current = { payload: text, key: crypto.randomUUID() };
    return current.current.key;
  };
  const done = () => {
    current.current = null;
  };
  return { keyFor, done };
}
