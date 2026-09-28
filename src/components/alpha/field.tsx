"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Field (§7.2): label above (13/600 `ink-2`, 6 px gap), "· optional" for
 * optional fields, and an error below (13/500 `missed` with an info icon,
 * role="alert") that also turns the control's border `missed`. The control
 * inside must be one of TextInput, TextArea or NumberInput so Base UI wires
 * the label, description and error to it.
 */
export function Field({
  label,
  optional = false,
  description,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  optional?: boolean;
  description?: React.ReactNode;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <FieldPrimitive.Root invalid={Boolean(error)} className={cn("flex flex-col gap-1.5", className)}>
      <FieldPrimitive.Label className="text-[13px] font-semibold text-ink-2">
        {label}
        {optional ? <span className="font-medium text-ink-3"> · optional</span> : null}
      </FieldPrimitive.Label>
      {children}
      {description ? (
        <FieldPrimitive.Description className="text-[13px] text-ink-3">{description}</FieldPrimitive.Description>
      ) : null}
      {error ? (
        <FieldPrimitive.Error match role="alert" className="flex items-center gap-1.5 text-[13px] font-medium text-missed">
          <Info className="size-[15px] shrink-0" aria-hidden />
          {error}
        </FieldPrimitive.Error>
      ) : null}
    </FieldPrimitive.Root>
  );
}

/** Border states shared by every field: 1 px `line`; focus 2 px `ink`; error 2 px `missed`. */
const fieldFrame = cn(
  "rounded-[14px] border border-line bg-surface text-ink transition-[border-color,box-shadow] duration-150",
  "focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--ink)] focus-visible:outline-none",
  "data-invalid:border-missed data-invalid:shadow-[inset_0_0_0_1px_var(--missed)]",
  "read-only:border-transparent read-only:bg-sunken read-only:text-ink-2 read-only:shadow-none",
  "disabled:opacity-40",
);

export function TextInput({
  compact = false,
  mono = false,
  className,
  ...props
}: FieldPrimitive.Control.Props & { compact?: boolean; mono?: boolean }) {
  return (
    <FieldPrimitive.Control
      className={cn(
        fieldFrame,
        "w-full px-3.5 text-base placeholder:text-ink-3",
        compact ? "h-11 rounded-[12px]" : "h-[52px]",
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldPrimitive.Control
      render={<textarea />}
      className={cn(fieldFrame, "min-h-24 w-full resize-y px-3.5 py-3 text-base leading-[22px] placeholder:text-ink-3", className)}
      {...(props as FieldPrimitive.Control.Props)}
    />
  );
}

/**
 * Number with unit (§7.2): the value 24/600 on the left, the unit in mono on
 * the right, or an inline unit toggle (a mini Segmented) passed as `unit`.
 * The value stays a string: amounts are exact decimals, never floats.
 */
export function NumberInput({
  unit,
  className,
  ...props
}: FieldPrimitive.Control.Props & { unit?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex h-14 items-center gap-2 rounded-[12px] border border-line bg-surface pr-1.5 pl-3.5",
        "transition-[border-color,box-shadow] duration-150",
        "focus-within:border-ink focus-within:shadow-[inset_0_0_0_1px_var(--ink)]",
        "has-data-invalid:border-missed has-data-invalid:shadow-[inset_0_0_0_1px_var(--missed)]",
        className,
      )}
    >
      <FieldPrimitive.Control
        inputMode="decimal"
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[24px] font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-ink-3"
        {...props}
      />
      {typeof unit === "string" ? <span className="pr-2 font-mono text-[15px] text-ink-3">{unit}</span> : unit}
    </div>
  );
}

/**
 * Switch (§7.17): 51 × 31 with a 27 px knob, "On" / "Off" in 13 `ink-2` to
 * its left. On: `ink` track, knob right. Off: `sunken` track with a `line`
 * edge, knob left with a shadow. The hit area is extended to 44 px.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...aria
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="text-[13px] text-ink-2" aria-hidden>
        {checked ? "On" : "Off"}
      </span>
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer items-center rounded-full p-0.5",
          "before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
          "bg-sunken shadow-[inset_0_0_0_1px_var(--line)] transition-[background-color,box-shadow] duration-200",
          "data-checked:bg-ink data-checked:shadow-none data-disabled:cursor-default data-disabled:opacity-40",
        )}
        {...aria}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-[27px] rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,.2)] transition-transform duration-200 ease-alpha",
            "data-checked:translate-x-5 data-checked:shadow-none motion-reduce:transition-none",
          )}
        />
      </SwitchPrimitive.Root>
    </span>
  );
}

/** Checkbox (§7.18): 26 × 26, radius 8; checked `ink` with a 16 px check. */
export function Checkbox({
  checked,
  onCheckedChange,
  className,
  ...aria
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      className={cn(
        "relative flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[8px] border-[1.5px] border-ink-3 bg-surface",
        "before:absolute before:-inset-[9px] before:content-['']",
        "data-checked:border-ink data-checked:bg-ink data-checked:text-surface",
        className,
      )}
      {...aria}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-4" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
