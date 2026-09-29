"use client";

import { ChevronLeft } from "lucide-react";
import Link from "@/components/alpha/link";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";
import { InstallGuide, installLead, installTitle } from "./install-guide";
import { useInstallDevice } from "./use-install";

/**
 * Me › Install the app (/app/install; "Get the app on your phone" on a
 * laptop): the install guide for every signed-in person, reached from Me and
 * the account menu while not in the installed app.
 */
export function InstallScreen() {
  const { device, acceptedHere, install } = useInstallDevice();
  return (
    <main className={CYCLES_MAIN}>
      <nav aria-label="Install the app" className="flex h-11 items-center pl-1.5 text-[17px] text-signal-ink laptop:hidden">
        <Link href="/app/me" className="flex h-11 items-center gap-0.5">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Me
        </Link>
      </nav>
      <div className="laptop:max-w-[640px]">
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <Link href="/app/me" className="hidden text-[14px] text-signal-ink laptop:block">
            ‹ Me
          </Link>
          {device ? (
            <>
              <h1 className="mt-1 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">{installTitle(device)}</h1>
              <p className="mt-2.5 text-[15px] leading-[1.5] text-ink-2">{installLead(device)}</p>
            </>
          ) : (
            <div aria-busy="true" className="mt-1">
              <div className="h-[37px] w-2/3 animate-pulse rounded-[10px] bg-sunken" />
              <div className="mt-3 h-5 w-full animate-pulse rounded-[8px] bg-sunken" />
            </div>
          )}
        </header>
        {device ? <InstallGuide device={device} install={install} acceptedHere={acceptedHere} /> : null}
      </div>
    </main>
  );
}
