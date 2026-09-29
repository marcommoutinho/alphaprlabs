"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/alpha/button";
import { InstallGuide, installLead, installTitle } from "@/components/push/install-guide";
import { useInstallDevice } from "@/components/push/use-install";
import { RESEARCH_HOME } from "@/lib/auth/paths";
import { showsInstallStep } from "@/lib/push/readiness";
import { AuthActions, AuthHeading } from "./auth-frame";

/**
 * R16 Put Alpha on your Home Screen (step 3 of 3), for everyone not already
 * in the installed app: the install guide, opened on this phone and
 * browser's steps (Marco, 2026-09-29); on a laptop, "Get the app on your
 * phone" with a QR code. Already running from the Home Screen, it goes
 * straight on to Today. Reminders are offered on the first launch from the
 * Home Screen (PushSync).
 */
export function InstallStep() {
  const router = useRouter();
  // Decided in the browser (the server can't tell standalone from a tab); null while rendering on the server.
  const { device, acceptedHere, install } = useInstallDevice();
  const shows = device ? showsInstallStep({ standalone: device.installed }) : null;
  useEffect(() => {
    if (shows === false) router.replace(RESEARCH_HOME);
  }, [router, shows]);

  if (!device || !shows) {
    return (
      <p role="status" className="sr-only">
        {shows === false ? "Opening Today…" : "Loading…"}
      </p>
    );
  }

  return (
    <>
      <AuthHeading title={installTitle(device, true)} lead={installLead(device)} />
      <InstallGuide device={device} install={install} acceptedHere={acceptedHere} />
      <AuthActions>
        <Button variant="outline" size="lg" block onClick={() => router.push(RESEARCH_HOME)}>
          I&apos;ll do it later
        </Button>
      </AuthActions>
    </>
  );
}
