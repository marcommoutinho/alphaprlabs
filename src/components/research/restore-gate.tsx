"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { GateBox, useRestoreGate } from "@/components/alpha/restored";
import { type RestorePhase, restoreWait } from "@/lib/app/save";
import { ScreenLoadError } from "./screen-load-error";

const RESTORE_FAILED = new Error("Couldn't load the page again after Back or Forward.");

/**
 * For the Library and a peptide (the researcher's own cycles and mix): put
 * back by Back or Forward (useRestoreGate), the route's placeholder shows,
 * never the page as it was, while the server is asked again
 * (router.refresh()); the refreshed page (a new id) shows. That wait is
 * bounded (restoreWait): if the page doesn't come, or the device is offline,
 * the screen's error with Try again shows instead, and coming back online
 * asks again.
 */
export function RestoreGate({
  id,
  placeholder,
  failed,
  children,
}: {
  id: string;
  placeholder: ReactNode;
  /** The error screen's title and heading (and way back), as the route's own error. */
  failed: { title: string; heading: string; back?: { href: string; label: string } };
  children: ReactNode;
}) {
  const router = useRouter();
  const { restoring, box } = useRestoreGate(id);
  const [phase, setPhase] = useState<{ id: string; phase: RestorePhase } | null>(null);
  const wait = useRef<ReturnType<typeof restoreWait> | null>(null);

  useEffect(() => {
    if (!restoring) return;
    const restore = restoreWait({ refresh: () => router.refresh(), onPhase: (next) => setPhase({ id, phase: next }) });
    wait.current = restore;
    restore.start();
    const onOnline = () => restore.again();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      restore.done();
      wait.current = null;
    };
  }, [restoring, id, router]);

  if (!restoring) return <GateBox box={box}>{children}</GateBox>;
  if (phase?.id === id && phase.phase === "failed") return <ScreenLoadError {...failed} error={RESTORE_FAILED} retry={() => wait.current?.again()} />;
  return placeholder;
}
