"use client";

import { useTransition } from "react";
import Link from "@/components/alpha/link";
import { useRouter } from "next/navigation";
import { sendTestNotification } from "@/app/(private)/app/notifications/actions";
import { Bell, ChevronLeft } from "lucide-react";
import { Button } from "@/components/alpha/button";
import { isOnline } from "@/components/alpha/online";
import { Group } from "@/components/alpha/list";
import { useAlphaToast } from "@/components/alpha/toast";
import { AuthActions } from "@/components/auth/auth-frame";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";
import { RESEARCH_HOME } from "@/lib/auth/paths";
import { INSTALL_GUIDE_PATH } from "@/lib/install/detect";
import type { HeadsUpMinutes } from "@/lib/preferences/rules";
import { STATUS_LABEL, statusTone } from "@/lib/push/readiness";
import { cn } from "@/lib/utils";
import { HeadsUpSetting } from "./heads-up-setting";
import { readinessSeen, useReminders, type Reminders } from "./use-reminders";

// C2 copy is the prototype's, except "I've added it": installation is detected.
const COPY = {
  unsupportedStep: "This browser can't deliver push notifications. You can still use the schedule here; open the app to see what's due.",
  unsupportedSettings: "This browser can't deliver push notifications. Everything else works.",
  deniedStep:
    "Permission was denied. To restore it, open your phone's Settings → Notifications → Alpha PR Labs and allow notifications, then return here. The app can't turn this on for you.",
  deniedSettings:
    "Denied at the OS level. Restore it in Settings → Notifications → Alpha PR Labs, then return here. The app can't change this for you; your schedule still works without reminders.",
  failedSettings:
    "Permission was granted but this device couldn't be registered for reminders. Try again; if it keeps failing, reminders stay off and Today still shows what's due.",
  install: "On iPhone, reminders need the app on your Home Screen.",
  on: "Reminders on for this device.",
  off: "Reminders off. Your schedule is unchanged.",
  failed: "Permission granted, but registering this device failed. Try again.",
  offFailed: "Could not turn reminders off. Try again.",
};

type Props = { userId: string; vapidPublicKey: string };

/** "Needs install": the one line, and the install guide (/app/install) for the steps. */
function InstallNote() {
  return (
    <>
      {COPY.install}{" "}
      <Link href={INSTALL_GUIDE_PATH} className="font-semibold text-signal-ink" data-testid="reminders-install-guide">
        See how to install it
      </Link>
    </>
  );
}

type Tone = "good" | "bad" | "neutral";

/**
 * The three device facts, as a group of rows (the prompt and Dose
 * reminders). Each row: data-testid "reminder-status", its label in
 * data-label, the value in "reminder-status-value".
 */
function StatusGroup({ reminders, labels }: { reminders: Reminders; labels: [string, string, string] }) {
  const { checking, status, installed } = reminders;
  const supported = status !== "unsupported";
  const rows: [string, string, Tone][] = [
    [labels[0], supported ? "Yes" : "No", supported ? "good" : "bad"],
    [labels[1], installed ? "Yes" : "Not yet", "neutral"],
    [labels[2], STATUS_LABEL[status], statusTone(status)],
  ];
  return (
    <Group className="mx-3 mt-6 laptop:mx-0">
      {rows.map(([label, value, tone]) => (
        <div key={label} className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-[15px]" data-testid="reminder-status" data-label={label}>
          <span className="text-ink-2">{label}</span>
          <b
            className={cn("font-semibold", !checking && tone === "good" && "text-done", !checking && tone === "bad" && "text-missed")}
            data-testid="reminder-status-value"
          >
            {checking ? "Checking…" : value}
          </b>
        </div>
      ))}
    </Group>
  );
}

/**
 * The push permission prompt (design v3): opened once by itself on the first
 * launch from the Home Screen (PushSync), and whenever asked for. Turning
 * reminders on asks the browser for permission; Not now goes on to Today.
 */
export function RemindersStep({ userId, vapidPublicKey }: Props) {
  const reminders = useReminders(userId, vapidPublicKey);
  const toast = useAlphaToast();
  const router = useRouter();
  const { checking, status, canInstall } = reminders;
  const turnOn = async () => {
    if (!isOnline()) return; // offline: the button says so; nothing is sent
    const outcome = await reminders.turnOn();
    if (outcome === "enabled") toast.success({ message: COPY.on });
    else if (outcome === "failed") toast.error({ message: COPY.failed });
  };
  const toToday = () => {
    readinessSeen.mark();
    router.push(RESEARCH_HOME);
  };
  const note =
    status === "unsupported" ? COPY.unsupportedStep : status === "denied" ? COPY.deniedStep : status === "needs-install" ? <InstallNote /> : null;

  return (
    <>
      <div className="px-5 pt-9 laptop:px-0">
        <span className="grid size-14 place-items-center rounded-[16px] bg-signal-tint text-signal-ink" aria-hidden>
          <Bell className="size-7" />
        </span>
        <h1 className="mt-7 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">Reminders on your phone</h1>
        <p className="mt-2.5 text-[15px] leading-[1.5] text-ink-2">
          A reminder names the peptide, the planned amount and the syringe units. A reminder never marks anything as taken — you confirm that
          yourself.
        </p>
      </div>
      <StatusGroup reminders={reminders} labels={["Push supported on this browser", "Installed to home screen", "Notification permission"]} />
      {note ? <p className="mx-5 mt-3 text-[14px] leading-[20px] text-ink-2 laptop:mx-0">{note}</p> : null}
      <AuthActions className="flex flex-col gap-2.5">
        {!checking && (status === "not-requested" || status === "failed") ? (
          <Button variant="primary" size="lg" block saving={reminders.busy === "on"} savingLabel="Turning on…" needsConnection onClick={turnOn}>
            Turn on reminders
          </Button>
        ) : null}
        {status === "enabled" ? (
          <Button variant="ink" size="lg" block onClick={toToday}>
            Continue to Today
          </Button>
        ) : null}
        {canInstall ? (
          <Button variant="outline" size="lg" block onClick={reminders.install}>
            Install app
          </Button>
        ) : null}
        {status !== "enabled" ? (
          <Button variant="outline" size="lg" block onClick={toToday}>
            Not now
          </Button>
        ) : null}
      </AuthActions>
    </>
  );
}

/**
 * R8 Tracking › Dose reminders (/app/notifications): reminders on this
 * device, in the v3 style of R8's pages. Turning them on asks the browser
 * for permission; the device facts, and the ways out of a denied or
 * unsupported state, as on the prompt. Per device: a new phone asks again.
 */
export function RemindersSettings({
  userId,
  vapidPublicKey,
  testEnabled,
  headsUpMinutes,
}: Props & { testEnabled: boolean; headsUpMinutes: HeadsUpMinutes }) {
  const reminders = useReminders(userId, vapidPublicKey);
  const toast = useAlphaToast();
  const [testing, startTest] = useTransition();
  const { checking, status, canInstall } = reminders;

  const turnOn = async () => {
    if (!isOnline()) return; // offline: the button says so; nothing is sent
    const outcome = await reminders.turnOn();
    if (outcome === "enabled") toast.success({ message: COPY.on });
    else if (outcome === "failed") toast.error({ message: COPY.failed });
  };
  const turnOff = async () => {
    if (!isOnline()) return; // offline: the button says so; nothing is sent
    if (await reminders.turnOff()) toast.success({ message: COPY.off });
    else toast.error({ message: COPY.offFailed });
  };
  const sendTest = () => {
    if (!isOnline()) return; // offline: the button says so; nothing is sent
    startTest(async () => {
      try {
        const result = await sendTestNotification();
        if (result.tone === "error") toast.error({ message: result.toast });
        else toast.success({ message: result.toast });
      } catch {
        toast.error({ message: "Could not send the test notification. Try again." });
      }
    });
  };
  const warning = status === "denied" ? COPY.deniedSettings : status === "failed" ? COPY.failedSettings : null;
  const note = status === "unsupported" ? COPY.unsupportedSettings : status === "needs-install" ? <InstallNote /> : null;

  return (
    <main className={CYCLES_MAIN}>
      <nav aria-label="Dose reminders" className="flex h-11 items-center pl-1.5 text-[17px] text-signal-ink laptop:hidden">
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
          <h1 className="mt-1 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">Reminders on this phone</h1>
          {/* The sentence about D3's two follow-ups (30 minutes and 2 hours) is removed: superseded on 2026-09-30 by one follow-up an hour after; its new wording is Astra's to write. */}
          <p className="mt-2.5 text-[15px] leading-[1.5] text-ink-2">
            Reminders name the peptide, planned mg and syringe units. A reminder never confirms a dose. Permission is per device — a new phone asks again.
          </p>
        </header>
        <StatusGroup reminders={reminders} labels={["Push supported", "Installed to home screen", "Permission on this device"]} />
        {warning ? (
          <p
            role={status === "failed" ? "alert" : undefined}
            className="mx-3 mt-3 rounded-[16px] border border-line bg-surface px-4 py-3 text-[14px] leading-[20px] text-missed laptop:mx-0"
            data-testid="reminders-warning"
          >
            {warning}
          </p>
        ) : null}
        {note ? <p className="mx-5 mt-3 text-[14px] leading-[20px] text-ink-2 laptop:mx-0">{note}</p> : null}
        <div className="mx-3 mt-6 flex flex-col gap-2.5 laptop:mx-0 laptop:flex-row laptop:flex-wrap">
          {!checking && (status === "not-requested" || status === "failed") ? (
            <Button variant="primary" size="lg" block saving={reminders.busy === "on"} savingLabel="Turning on…" needsConnection onClick={turnOn} className="laptop:w-auto">
              Turn on reminders
            </Button>
          ) : null}
          {status === "enabled" ? (
            <Button variant="outline" size="lg" block saving={reminders.busy === "off"} savingLabel="Turning off…" needsConnection onClick={turnOff} className="laptop:w-auto">
              Turn off reminders
            </Button>
          ) : null}
          {canInstall ? (
            <Button variant="outline" size="lg" block onClick={reminders.install} className="laptop:w-auto">
              Install app
            </Button>
          ) : null}
          {testEnabled ? (
            <Button variant="outline" size="lg" block saving={testing} savingLabel="Sending…" needsConnection onClick={sendTest} className="laptop:w-auto">
              Send test notification
            </Button>
          ) : null}
        </div>
        <HeadsUpSetting minutes={headsUpMinutes} />
      </div>
    </main>
  );
}
