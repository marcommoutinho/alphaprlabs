"use client";

import { Bell, Share, SquarePlus } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/alpha/button";
import { readFacts } from "@/components/push/use-reminders";
import { RESEARCH_HOME } from "@/lib/auth/paths";
import { showsInstallStep } from "@/lib/push/readiness";
import { AuthActions, AuthHeading } from "./auth-frame";

const noop = () => () => {};

/**
 * R16 Put Alpha on your Home Screen (step 3 of 3). Only iPhone / iPad
 * Safari sees it; anywhere else, or already running from the Home Screen,
 * it goes straight on to Today. Reminders are offered on the first launch
 * from the Home Screen (PushSync), because iPhone only allows them there.
 */
export function InstallStep() {
  const router = useRouter();
  // Decided in the browser (the server can't tell standalone from a tab); null while rendering on the server.
  const shows = useSyncExternalStore(noop, () => showsInstallStep(readFacts()), () => null);
  useEffect(() => {
    if (shows === false) router.replace(RESEARCH_HOME);
  }, [router, shows]);

  if (!shows) {
    return (
      <p role="status" className="sr-only">
        Opening Today…
      </p>
    );
  }

  const steps: { n: number; text: React.ReactNode; icon: React.ReactNode }[] = [
    {
      n: 1,
      text: (
        <>
          Tap <b className="font-semibold">Share</b> in Safari&apos;s toolbar
        </>
      ),
      icon: <Share className="size-[22px] text-signal-ink" aria-hidden />,
    },
    {
      n: 2,
      text: (
        <>
          Choose <b className="font-semibold">Add to Home Screen</b>
        </>
      ),
      icon: <SquarePlus className="size-[22px]" aria-hidden />,
    },
    {
      n: 3,
      text: (
        <>
          Open <b className="font-semibold">Alpha</b> from your Home Screen
        </>
      ),
      icon: <Image src="/logo.jpeg" alt="" width={30} height={30} className="size-[30px] rounded-[8px]" />,
    },
  ];

  return (
    <>
      <AuthHeading title="Put Alpha on your Home Screen" lead="It opens full screen like any app, and it's the only way iPhone allows dose reminders." />
      <ol className="mx-3 mt-6 overflow-hidden rounded-[24px] border border-line bg-surface laptop:mx-0" data-testid="install-steps">
        {steps.map((step) => (
          <li key={step.n} className="flex items-center gap-3.5 border-b border-line p-4 last:border-b-0">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-mono text-[15px] font-semibold text-surface" aria-hidden>
              {step.n}
            </span>
            <span className="flex-1 text-base">{step.text}</span>
            {step.icon}
          </li>
        ))}
      </ol>
      <p className="mx-5 mt-3.5 flex gap-2.5 text-[14px] leading-[1.45] text-ink-2 laptop:mx-0">
        <Bell className="mt-px size-[18px] shrink-0" aria-hidden />
        We&apos;ll ask about reminders the first time you open it from there.
      </p>
      <AuthActions>
        <Button variant="outline" size="lg" block onClick={() => router.push(RESEARCH_HOME)}>
          I&apos;ll do it later
        </Button>
      </AuthActions>
    </>
  );
}
