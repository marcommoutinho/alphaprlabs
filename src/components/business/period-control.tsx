"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import { buttonVariants } from "@/components/alpha/button-variants";
import { Field, TextInput } from "@/components/alpha/field";
import { segmentedItem, segmentedTrack } from "@/components/alpha/segmented";
import { Sheet, SheetClose, SheetContent } from "@/components/alpha/sheet";
import { checkCustomRange, CUSTOM_MAX_DAYS, periodQuery, rangeLabel, type Period, type PeriodKind } from "@/lib/business/period";
import { cn } from "@/lib/utils";
import { BUSINESS_PATH } from "./frame";

const hrefFor = (kind: Exclude<PeriodKind, "custom">) => {
  const query = periodQuery({ kind, from: "", to: "" });
  return query ? `${BUSINESS_PATH}?${query}` : BUSINESS_PATH;
};

/**
 * The Business period (A1 / A2 / A13 / D9): Week | Month | custom range |
 * 12 months, as links (each view has its own URL) plus the custom segment,
 * which opens the range picker and then shows the range ("Sep 15–24").
 * 44 px on a phone, 40 on a laptop.
 */
export function PeriodControl({ period, today, className }: { period: Period; today: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const item = (mono = false) =>
    cn(segmentedItem({ size: "md", mono }), "laptop:rounded-[8px] laptop:px-3.5 laptop:text-[14px]", mono && "text-[14px] laptop:text-[13px]");
  const link = (kind: Exclude<PeriodKind, "custom">, label: string) => (
    <Link href={hrefFor(kind)} aria-current={period.kind === kind ? "page" : undefined} className={item()}>
      {label}
    </Link>
  );
  const custom = period.kind === "custom";

  return (
    <>
      <nav
        aria-label="Period"
        className={cn(
          segmentedTrack({ size: "md" }),
          "grid-flow-row grid-cols-[1fr_1fr_1.3fr_1.3fr] laptop:h-10 laptop:grid-cols-[repeat(4,auto)] laptop:rounded-[10px]",
          className,
        )}
      >
        {link("week", "Week")}
        {link("month", "Month")}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-current={custom ? "page" : undefined}
          aria-haspopup="dialog"
          aria-label={custom ? `Custom range ${rangeLabel(period)}, change` : "Custom range"}
          className={cn(item(custom), "cursor-pointer")}
        >
          {custom ? rangeLabel(period) : "Range"}
        </button>
        {link("12m", "12 months")}
      </nav>
      <RangeSheet open={open} onOpenChange={setOpen} today={today} initial={custom ? period : { from: period.from, to: period.to }} />
    </>
  );
}

/** The range picker: From and To, business dates, at most CUSTOM_MAX_DAYS days, never after today. */
function RangeSheet({
  open,
  onOpenChange,
  today,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  initial: { from: string; to: string };
}) {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [error, setError] = useState<string | null>(null);

  const show = () => {
    const checked = checkCustomRange(from, to, today);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    onOpenChange(false);
    router.push(`${BUSINESS_PATH}?${periodQuery({ kind: "custom", ...checked.range })}`);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setFrom(initial.from);
          setTo(initial.to);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <SheetContent
        title="Custom range"
        size="auto"
        footer={
          <>
            <SheetClose className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-[100px] laptop:h-12")}>Cancel</SheetClose>
            <Button size="lg" className="laptop:h-12" onClick={show}>
              Show range
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3 px-2"
          onSubmit={(event) => {
            event.preventDefault();
            show();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <TextInput type="date" value={from} max={today} onChange={(event) => setFrom(event.currentTarget.value)} mono />
            </Field>
            <Field label="To">
              <TextInput type="date" value={to} max={today} onChange={(event) => setTo(event.currentTarget.value)} mono />
            </Field>
          </div>
          <p className="text-[13px] text-ink-3">Business days in Toronto time, up to {CUSTOM_MAX_DAYS} days. Longer spans: 12 months.</p>
          {error ? (
            <p role="alert" className="text-[13px] font-medium text-missed">
              {error}
            </p>
          ) : null}
          <button type="submit" hidden />
        </form>
      </SheetContent>
    </Sheet>
  );
}
