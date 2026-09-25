import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  /** md: 52px form button; sm: 40px header/toolbar button. */
  size?: "md" | "sm";
  /** Full width. */
  block?: boolean;
  /** A request is in flight: shows `savingLabel` and disables the button. */
  saving?: boolean;
  savingLabel?: string;
};

export function AppButton({
  variant = "primary",
  size = "md",
  block = false,
  saving = false,
  savingLabel = "Saving…",
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: AppButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "app-btn",
        `app-btn--${variant}`,
        size === "sm" && "app-btn--sm",
        block && "app-btn--block",
        className,
      )}
      disabled={disabled || saving}
      aria-busy={saving || undefined}
      {...rest}
    >
      {saving ? savingLabel : children}
    </button>
  );
}

/** Label above a control: 12px, text-4, 6px gap. Wraps the control. */
export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("app-field", className)}>
      <span className="app-field-label">{label}</span>
      {children}
    </label>
  );
}

/** One inline form error under the form, announced with role="alert". */
export function InlineError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="app-inline-error">
      {children}
    </p>
  );
}

/** Empty state: a plain sentence in text-4, no illustration. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="app-empty">{children}</p>;
}
