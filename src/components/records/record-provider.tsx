"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/alpha/button";
import { buttonVariants } from "@/components/alpha/button-variants";
import type { RecordKind } from "@/lib/records/forms";
import { cn } from "@/lib/utils";
import { PurchaseSheet } from "./purchase-sheet";
import { SaleSheet } from "./sale-sheet";

type Open = { kind: RecordKind; itemId: string | null; token: number };

type Recorder = { open: (kind: RecordKind, itemId?: string | null) => void };

const RecordContext = createContext<Recorder | null>(null);

export function useRecorder(): Recorder {
  const recorder = useContext(RecordContext);
  if (!recorder) throw new Error("useRecorder must be used inside <RecordProvider>");
  return recorder;
}

/**
 * A4 / A5 (phone: full-screen) and the D4 drawers (laptop): Record sale and
 * Record purchase open over whatever admin page they're started from, so the
 * page stays where it was. Each opening is a fresh form with its own token: a
 * submission that answers late (a Retry from a toast) closes only the opening
 * it was made in, never one opened after it.
 */
export function RecordProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<Open | null>(null);
  const openings = useRef(0);
  const open = useCallback((kind: RecordKind, itemId: string | null = null) => {
    openings.current += 1;
    setCurrent({ kind, itemId, token: openings.current });
  }, []);
  const close = useCallback(() => setCurrent(null), []);
  const done = useCallback((token: number) => setCurrent((now) => (now?.token === token ? null : now)), []);
  const recorder = useMemo(() => ({ open }), [open]);
  return (
    <RecordContext value={recorder}>
      {children}
      <SaleSheet opening={current?.kind === "sale" ? current : null} onClose={close} onDone={done} />
      <PurchaseSheet opening={current?.kind === "purchase" ? current : null} onClose={close} onDone={done} />
    </RecordContext>
  );
}

/** A button that opens Record sale or Record purchase (usable from server components). */
export function RecordButton({
  kind,
  itemId,
  variant = kind === "sale" ? "primary" : "outline",
  size = "sm",
  className,
  children,
  ...aria
}: {
  kind: RecordKind;
  itemId?: string | null;
  variant?: "primary" | "outline" | "ink" | "soft";
  size?: "lg" | "md" | "sm" | "icon";
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const recorder = useRecorder();
  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={() => recorder.open(kind, itemId ?? null)} {...aria}>
      {children}
    </Button>
  );
}

/**
 * Opens a record sheet once from the URL (`?record=sale|purchase&recordItem=`):
 * the old /admin/inventory/sale and /purchase addresses redirect here. The
 * parameters are then removed, so a reload or Back doesn't open it again.
 */
export function OpenRecordFromUrl({ kind, itemId }: { kind: RecordKind | null; itemId: string | null }) {
  const recorder = useRecorder();
  const router = useRouter();
  const pathname = usePathname();
  const opened = useRef(false);
  useEffect(() => {
    if (!kind || opened.current) return;
    opened.current = true;
    recorder.open(kind, itemId);
    const url = new URL(window.location.href);
    url.searchParams.delete("record");
    url.searchParams.delete("recordItem");
    router.replace(`${pathname}${url.search}`, { scroll: false });
  }, [kind, itemId, recorder, router, pathname]);
  return null;
}

/** Link-styled classes for a record button (kept for callers that style it like the page's other actions). */
export const recordButtonClass = (variant: "primary" | "outline") =>
  cn(buttonVariants({ variant, size: "sm" }), "rounded-[12px] text-[14px]");
