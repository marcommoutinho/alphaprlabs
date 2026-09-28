"use client";

import { useTransition } from "react";
import Link from "@/components/alpha/link";
import { useRouter } from "next/navigation";
import { sendTestNotification } from "@/app/(private)/app/notifications/actions";
import { Bell } from "lucide-react";
import { Button } from "@/components/alpha/button";
import { Group } from "@/components/alpha/list";
import { useAlphaToast } from "@/components/alpha/toast";
import { AppButton } from "@/components/app-shell/form";
import { AuthActions } from "@/components/auth/auth-frame";
import { useToast } from "@/components/app-shell/toast";
import { RESEARCH_HOME } from "@/lib/auth/paths";
import { STATUS_LABEL, statusTone } from "@/lib/push/readiness";
import { cn } from "@/lib/utils";
import { readinessSeen, useReminders, type Reminders } from "./use-reminders";
import "@/styles/app/reminders.css";

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
  installStep: "On iPhone, reminders require the app on your home screen: Share → Add to Home Screen.",
  installSettings: "On iPhone, add the app to your home screen first: Share → Add to Home Screen.",
  on: "Reminders on for this device.",
  off: "Reminders off. Your schedule is unchanged.",
  failed: "Permission granted, but registering this device failed. Try again.",
  offFailed: "Could not turn reminders off. Try again.",
};

type Props = { userId: string; vapidPublicKey: string };

function StatusRows({ reminders, labels }: { reminders: Reminders; labels: [string, string, string] }) {
  const { checking, status, installed } = reminders;
  const pushSupported = status !== "unsupported";
  const value = (text: string, tone?: string) => (
    <b className="app-reminders-value" data-tone={checking ? "checking" : tone}>
      {checking ? "Checking…" : text}
    </b>
  );
  return (
    <div className="app-reminders-status">
      <div className="app-reminders-row">
        <span>{labels[0]}</span>
        {value(pushSupported ? "Yes" : "No", pushSupported ? "good" : "warn")}
      </div>
      <div className="app-reminders-row">
        <span>{labels[1]}</span>
        {value(installed ? "Yes" : "Not yet")}
      </div>
      <div className="app-reminders-row">
        <span>{labels[2]}</span>
        {value(STATUS_LABEL[status], statusTone(status))}
      </div>
    </div>
  );
}

function useTurnOn(reminders: Reminders) {
  const toast = useToast();
  return async () => {
    const outcome = await reminders.turnOn();
    if (outcome === "enabled") toast(COPY.on);
    else if (outcome === "failed") toast(COPY.failed, "error");
  };
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
  const { checking, status, canInstall, installed } = reminders;
  const turnOn = async () => {
    const outcome = await reminders.turnOn();
    if (outcome === "enabled") toast.success({ message: COPY.on });
    else if (outcome === "failed") toast.error({ message: COPY.failed });
  };
  const toToday = () => {
    readinessSeen.mark();
    router.push(RESEARCH_HOME);
  };
  const rows: [string, string, "good" | "bad" | "neutral"][] = [
    ["Push supported on this browser", status !== "unsupported" ? "Yes" : "No", status !== "unsupported" ? "good" : "bad"],
    ["Installed to home screen", installed ? "Yes" : "Not yet", "neutral"],
    ["Notification permission", STATUS_LABEL[status], statusTone(status)],
  ];
  const note =
    status === "unsupported" ? COPY.unsupportedStep : status === "denied" ? COPY.deniedStep : status === "needs-install" ? COPY.installStep : null;

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
      {note ? <p className="mx-5 mt-3 text-[14px] leading-[20px] text-ink-2 laptop:mx-0">{note}</p> : null}
      <AuthActions className="flex flex-col gap-2.5">
        {!checking && (status === "not-requested" || status === "failed") ? (
          <Button variant="primary" size="lg" block saving={reminders.busy === "on"} savingLabel="Turning on…" onClick={turnOn}>
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

/** C2 settings: "Reminders on this phone" (/app/notifications). */
export function RemindersSettings({ userId, vapidPublicKey, testEnabled }: Props & { testEnabled: boolean }) {
  const reminders = useReminders(userId, vapidPublicKey);
  const turnOn = useTurnOn(reminders);
  const toast = useToast();
  const [testing, startTest] = useTransition();
  const { checking, status, canInstall } = reminders;

  const turnOff = async () => {
    if (await reminders.turnOff()) toast(COPY.off);
    else toast(COPY.offFailed, "error");
  };
  const sendTest = () =>
    startTest(async () => {
      try {
        const result = await sendTestNotification();
        toast(result.toast, result.tone);
      } catch {
        toast("Could not send the test notification. Try again.", "error");
      }
    });

  return (
    <>
      <Link href="/app/me" className="app-reminders-back">
        ‹ Me
      </Link>
      <h1 className="app-h1 app-reminders-title">Reminders on this phone</h1>
      <StatusRows
        reminders={reminders}
        labels={["Push supported", "Installed to home screen", "Permission on this device"]}
      />
      <p className="app-reminders-explain">
        Reminders name the peptide, planned mg and syringe units. Two follow-ups arrive 30 minutes and 2 hours after
        an unconfirmed dose is due. A reminder never confirms a dose. Permission is per device — a new phone asks
        again.
      </p>
      {status === "denied" ? (
        <p className="app-reminders-box" data-tone="warn">
          {COPY.deniedSettings}
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="app-reminders-box" data-tone="error">
          {COPY.failedSettings}
        </p>
      ) : null}
      {status === "unsupported" ? <p className="app-reminders-note">{COPY.unsupportedSettings}</p> : null}
      {status === "needs-install" ? <p className="app-reminders-note">{COPY.installSettings}</p> : null}
      <div className="app-reminders-actions">
        {!checking && (status === "not-requested" || status === "failed") ? (
          <AppButton saving={reminders.busy === "on"} onClick={turnOn}>
            Turn on reminders
          </AppButton>
        ) : null}
        {status === "enabled" ? (
          <AppButton variant="secondary" saving={reminders.busy === "off"} onClick={turnOff}>
            Turn off reminders
          </AppButton>
        ) : null}
        {canInstall ? (
          <AppButton variant="secondary" onClick={reminders.install}>
            Install app
          </AppButton>
        ) : null}
        {testEnabled ? (
          <AppButton variant="secondary" saving={testing} savingLabel="Sending…" onClick={sendTest}>
            Send test notification
          </AppButton>
        ) : null}
      </div>
    </>
  );
}
