"use client";

import { Info } from "lucide-react";
import Image from "next/image";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { useAlphaToast } from "@/components/alpha/toast";
import { SAVE_FAILED_MESSAGE } from "@/lib/app/save";
import { cn } from "@/lib/utils";

// Design v3 joining and sign-in (R14–R16, and sign-in / recovery in the same
// style): no tab bar; on a phone the screen is the page, with its action
// pinned to the bottom; on a laptop a centred 480 px card on `paper`.

/** The screen: full height on a phone, a centred card on a laptop. */
export function AuthFrame({ step, children, className }: { step?: 1 | 2 | 3; children: React.ReactNode; className?: string }) {
  return (
    <main className="flex min-h-dvh flex-col bg-paper text-ink laptop:items-center laptop:justify-center laptop:px-6 laptop:py-12">
      <div
        className={cn(
          "flex w-full flex-1 flex-col pt-[env(safe-area-inset-top)]",
          "laptop:max-w-[480px] laptop:flex-none laptop:rounded-[28px] laptop:border laptop:border-line laptop:bg-surface laptop:px-6 laptop:pt-2 laptop:pb-6 laptop:shadow-[0_24px_60px_rgba(0,0,0,.06)]",
          className,
        )}
      >
        {step ? <AuthSteps step={step} /> : null}
        {children}
      </div>
    </main>
  );
}

/** R14–R16's three-step progress: 4 px bars, done and current in `ink`. */
export function AuthSteps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={step}
      aria-label={`Step ${step} of 3`}
      className="mx-5 mt-3.5 grid grid-cols-3 gap-1 laptop:mx-0"
      data-testid="auth-steps"
    >
      {[1, 2, 3].map((n) => (
        <i key={n} className={cn("h-1 rounded-[2px]", n <= step ? "bg-ink" : "bg-line")} />
      ))}
    </div>
  );
}

/** The 56 px logo, a mono kicker, the title and the lead. */
export function AuthHeading({
  logo = false,
  kicker,
  title,
  lead,
  className,
}: {
  logo?: boolean;
  kicker?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-5 laptop:px-0", logo ? "pt-9" : "pt-7", className)}>
      {logo ? <Image src="/logo.jpeg" alt="Alpha PR Labs" width={56} height={56} className="size-14 rounded-[14px]" preload /> : null}
      {kicker ? <div className={cn("font-mono text-[13px] font-medium text-signal-ink", logo && "mt-7")}>{kicker}</div> : null}
      <h1 className={cn("text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance", kicker ? "mt-1.5" : logo && "mt-7")}>{title}</h1>
      {lead ? <div className="mt-2.5 text-[15px] leading-[1.5] text-ink-2">{lead}</div> : null}
    </div>
  );
}

/** The bottom action area: pinned to the foot of the phone screen, after the content on a laptop. */
export function AuthActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mt-auto px-4 pt-6 pb-[calc(20px+env(safe-area-inset-bottom))] laptop:mt-8 laptop:px-0 laptop:pt-0 laptop:pb-0", className)}>
      {children}
    </div>
  );
}

/** A form-level error (role="alert"), 13/500 `missed` with the info icon. */
export function FormError({ children, className }: { children?: React.ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="alert" data-testid="form-error" className={cn("flex items-start gap-1.5 text-[13px] leading-[18px] font-medium text-missed", className)}>
      <Info className="mt-px size-[15px] shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** A notice above a form ("Your session expired…"), on `signal-tint`. */
export function AuthNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="status" className={cn("mx-4 mt-5 rounded-[14px] bg-signal-tint px-4 py-3 text-[14px] leading-[20px] text-signal-ink laptop:mx-0", className)}>
      {children}
    </p>
  );
}

type SubmitResult = { error?: string; toast?: string; tone?: "error" | "success" | "info" } | undefined | void;

/**
 * Calls an auth server action without resetting the form: an inline error,
 * or a v3 toast; a redirect navigates; a failed request shows the
 * save-failure toast and keeps what was typed.
 */
export function useAuthSubmit<Input, Result extends SubmitResult>(action: (input: Input) => Promise<Result>) {
  const toast = useAlphaToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function submit(input: Input, onResult?: (result: Result) => void) {
    startTransition(async () => {
      let result: Result;
      try {
        result = await action(input);
      } catch (caught) {
        unstable_rethrow(caught);
        toast.error({ message: SAVE_FAILED_MESSAGE });
        return;
      }
      setError(result?.error);
      if (result?.toast) (result.tone && result.tone !== "error" ? toast.success : toast.error)({ message: result.toast });
      onResult?.(result);
    });
  }

  return { pending, error, setError, submit };
}
