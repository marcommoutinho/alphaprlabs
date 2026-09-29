"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { GateBox, useRestoreGate } from "@/components/alpha/restored";
import { ScreenError } from "@/components/admin/states";
import { REFRESH_WAIT_MS } from "@/lib/app/save";

const CHECK_FAILED = new Error("Couldn't check whether the history is still shared.");

/**
 * A12's history, as the server rendered it after checking the share, but only
 * while that check is current. Back or forward puts a page back without
 * asking the server (useRestoreGate: Next.js's client cache, or the browser's
 * back/forward cache, whose document comes back hidden), so a restored
 * history shows the loading placeholders until a fresh check (GET ./access,
 * no-store) confirms the share; if it has stopped, the denied state shows and
 * the page is asked for again, so the history leaves the client cache too. A
 * history just rendered by the server shows at once: that render was the
 * check.
 */
export function HistoryGate({
  researcherId,
  renderId,
  name,
  checking,
  denied,
  children,
}: {
  researcherId: string;
  /** This server render's id (see restored.tsx). */
  renderId: string;
  name: string;
  /** What shows while checking: nothing about the person. */
  checking: ReactNode;
  /** The denied state (the name, the email). */
  denied: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const { restoring, box, reveal } = useRestoreGate(renderId);
  const [verdict, setVerdict] = useState<{ id: string; status: "denied" | "failed" } | null>(null);
  const status = verdict?.id === renderId ? verdict.status : null;

  useEffect(() => {
    if (!restoring || status) return;
    let live = true;
    // Bounded: a check that doesn't answer in time fails like one that couldn't be sent (Try again).
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REFRESH_WAIT_MS);
    fetch(`/admin/people/${encodeURIComponent(researcherId)}/access`, { cache: "no-store", headers: { accept: "application/json" }, signal: timeout.signal })
      .then(async (response) => {
        if (!live) return;
        if (response.status !== 403 && !response.ok) return setVerdict({ id: renderId, status: "failed" });
        const shared = response.ok && ((await response.json()) as { shared?: unknown }).shared === true;
        if (!live) return;
        if (shared) return reveal();
        // Not shared (or no longer an admin): the server's page replaces the one kept.
        setVerdict({ id: renderId, status: "denied" });
        router.refresh();
      })
      .catch(() => live && setVerdict({ id: renderId, status: "failed" }))
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      clearTimeout(timer);
      timeout.abort();
    };
  }, [restoring, status, renderId, researcherId, reveal, router]);

  // Failed (offline, or no answer in time): coming back online checks again.
  useEffect(() => {
    if (status !== "failed") return;
    const onOnline = () => setVerdict(null);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [status]);

  if (status === "denied") return denied;
  if (status === "failed")
    return (
      <ScreenError
        title={name}
        heading="Couldn't check access"
        error={CHECK_FAILED}
        retry={() => setVerdict(null)}
        back={{ href: "/admin/people", label: "People" }}
      />
    );
  if (restoring) return checking;
  return <GateBox box={box}>{children}</GateBox>;
}
