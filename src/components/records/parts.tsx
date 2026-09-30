"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Minus, Plus, RotateCw } from "lucide-react";
import { Skeleton } from "@/components/alpha/skeleton";
import { shortDate } from "@/lib/alpha/format";
import { cn } from "@/lib/utils";

// Pieces shared by A4 Record sale and A5 Record purchase (and their laptop
// drawers). Pickers are the platform's own (a native select or date input
// laid over the designed row): the iOS wheel on a phone, the browser's list
// on a laptop, both keyboard and screen-reader ready.

export type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; code: number };

/**
 * GET `url` as JSON (never cached), again whenever `url` or `round` changes;
 * null loads nothing. An answer for an older url is dropped. `keep`: while the
 * same url loads again (a new round or a retry), its last answer stands, so
 * what was built on it (an entry being typed) stays on screen.
 */
export function useJson<T>(url: string | null, round = 0, keep = false): [Load<T> | null, () => void] {
  const [state, setState] = useState<{ key: string; url: string; load: Load<T> } | null>(null);
  const [retries, setRetries] = useState(0);
  // The request this answer is for: until its answer arrives, it's loading.
  const key = `${round}:${retries}:${url}`;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw response.status;
        const data = (await response.json()) as T;
        setState({ key, url, load: { status: "ready", data } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, url, load: { status: "error", code: typeof reason === "number" ? reason : 0 } });
      });
    return () => controller.abort();
  }, [url, key]);
  const retry = useCallback(() => setRetries((count) => count + 1), []);
  if (!url) return [null, retry];
  if (!state || state.key !== key) {
    if (keep && state?.url === url && state.load.status === "ready") return [state.load, retry];
    return [{ status: "loading" }, retry];
  }
  return [state.load, retry];
}

/** A value that settles `delay` ms after it stops changing (the preview waits for typing to pause). */
export function useSettled<T>(value: T, delay = 180): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** The card every entry sits in: surface, 1 px line, radius 16; `strong` is the 2 px ink border of the key entry. */
export const cardClass = (strong = false, invalid = false) =>
  cn(
    "relative rounded-[16px] bg-surface",
    strong ? "border-2 border-ink" : "border border-line",
    invalid && "border-2 border-missed",
  );

/**
 * A4 / A5 "Item" row (64 px): label, the value 17/600, mono meta ("58 on
 * hand") and a chevron, with a native select over it.
 */
export function PickerRow({
  label,
  value,
  meta,
  options,
  selected,
  onSelect,
  placeholder,
  invalid,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
  options: readonly { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  testId?: string;
}) {
  return (
    <div className={cn(cardClass(false, invalid), "flex h-16 items-center gap-2.5 pr-3 pl-4 focus-within:border-2 focus-within:border-ink")}>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink-3">{label}</span>
        <span className="mt-0.5 block truncate text-[17px] font-semibold">{value}</span>
      </span>
      {meta ? <span className="shrink-0 font-mono text-[13px] font-medium text-ink-2">{meta}</span> : null}
      <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
      <select
        aria-label={label}
        data-testid={testId}
        value={selected}
        onChange={(event) => onSelect(event.currentTarget.value)}
        className="absolute inset-0 size-full cursor-pointer appearance-none rounded-[16px] text-base opacity-0"
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The mono date ("Thu, Sep 24") with a native date input over it; never after `max`. */
export function DateButton({
  value,
  max,
  onChange,
  label,
  className,
  testId,
}: {
  value: string;
  max: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
  testId?: string;
}) {
  return (
    <span className={cn("relative inline-flex cursor-pointer underline decoration-line decoration-dotted underline-offset-4", className)}>
      <span aria-hidden>{value ? shortDate(value) : "Choose a date"}</span>
      {/* 16 px although unseen: iOS zooms into any field under 16 px that takes focus. */}
      <input
        type="date"
        aria-label={label}
        data-testid={testId}
        value={value}
        max={max}
        required
        onChange={(event) => onChange(event.currentTarget.value)}
        className="absolute inset-0 size-full cursor-pointer text-base opacity-0"
      />
    </span>
  );
}

/** A4 Vials: − and + (44 px, sunken, radius 12) around the count (28/600), which can also be typed. */
export function Stepper({
  label,
  value,
  onChange,
  invalid,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  testId?: string;
}) {
  const count = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const step = (by: number) => onChange(String(Math.min(100_000, Math.max(1, (count ?? 0) + by))));
  return (
    <div className={cn(cardClass(false, invalid), "pt-2.5 pr-2 pb-2 pl-3.5")}>
      <label htmlFor={`${testId}-input`} className="text-[12px] text-ink-3">
        {label}
      </label>
      <div className="mt-1 flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label="Fewer"
          disabled={count !== null && count <= 1}
          onClick={() => step(-1)}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[12px] bg-sunken text-ink disabled:opacity-40"
        >
          <Minus className="size-[18px]" aria-hidden />
        </button>
        <input
          id={`${testId}-input`}
          data-testid={testId}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="w-0 min-w-0 flex-1 bg-transparent text-center text-[28px] font-semibold text-ink outline-none"
        />
        <button
          type="button"
          aria-label="More"
          onClick={() => step(1)}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[12px] bg-sunken text-ink"
        >
          <Plus className="size-[18px]" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A money entry: label, the prefix ("$", "US$"), the amount 26/600 and a mono unit ("CAD"). */
export function MoneyCard({
  label,
  prefix,
  unit,
  value,
  onChange,
  strong = true,
  invalid,
  testId,
  placeholder = "0.00",
}: {
  label: string;
  prefix: string;
  unit?: string;
  value: string;
  onChange: (value: string) => void;
  strong?: boolean;
  invalid?: boolean;
  testId?: string;
  placeholder?: string;
}) {
  return (
    <div className={cn(cardClass(strong, invalid), "px-3.5 pt-[9px] pb-2")}>
      <label htmlFor={`${testId}-input`} className="text-[12px] text-ink-3">
        {label}
      </label>
      <div className="mt-1 flex h-11 items-center gap-1">
        <span className="text-[26px] font-semibold tracking-[-0.02em]" aria-hidden>
          {prefix}
        </span>
        <input
          id={`${testId}-input`}
          data-testid={testId}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="w-0 min-w-0 flex-1 bg-transparent text-[26px] font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-ink-3"
        />
        {unit ? <span className="shrink-0 font-mono text-[13px] font-medium text-ink-2">{unit}</span> : null}
      </div>
    </div>
  );
}

/** A section label (13/600 ink-2) above a control. */
export function PartLabel({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="px-1 text-[13px] font-semibold text-ink-2">
      {children}
    </div>
  );
}

/** A field's message under it: an error (missed, role=alert) or a helper (ink-3). */
export function PartNote({ error, children, testId }: { error?: boolean; children: React.ReactNode; testId?: string }) {
  return (
    <div
      role={error ? "alert" : undefined}
      data-testid={testId}
      className={cn("mt-1.5 px-1 text-[13px]", error ? "font-medium text-missed" : "text-ink-3")}
    >
      {children}
    </div>
  );
}

/** The Now block's lines: label (on-ink-2) and amount (600), each above a 12 % rule. */
export function NowLines({ lines }: { lines: readonly { key: string; label: React.ReactNode; amount: React.ReactNode; testId?: string }[] }) {
  return (
    <div className="mt-2.5 flex flex-col text-[14px]">
      {lines.map((line) => (
        <div
          key={line.key}
          data-testid={line.testId}
          className="flex justify-between gap-3 border-t border-[color-mix(in_oklab,currentColor_12%,transparent)] py-[7px]"
        >
          <span className="min-w-0 text-on-ink-2">{line.label}</span>
          <span className="shrink-0 font-semibold">{line.amount}</span>
        </div>
      ))}
    </div>
  );
}

/** Opening skeleton: the item row, two cards and the Now block. */
export function RecordSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading" data-testid="record-loading">
      <Skeleton className="h-16 rounded-[16px]" />
      <div className="grid grid-cols-2 gap-2.5">
        <Skeleton className="h-[92px] rounded-[16px]" />
        <Skeleton className="h-[92px] rounded-[16px]" />
      </div>
      <Skeleton className="h-11 rounded-[12px]" />
      <Skeleton className="h-[52px] rounded-[14px]" />
      <Skeleton className="h-36 rounded-[24px]" />
    </div>
  );
}

/** The sheet couldn't load its stock counts: recording is paused until they do. */
export function RecordLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-[20px] border border-line bg-surface px-5 py-5" role="alert" data-testid="record-load-error">
      <p className="text-[15px] leading-[1.45] text-ink-2">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex h-11 cursor-pointer items-center gap-2 rounded-[12px] bg-sunken px-4 text-[15px] font-semibold text-ink"
      >
        <RotateCw className="size-4" aria-hidden />
        Try again
      </button>
    </div>
  );
}
