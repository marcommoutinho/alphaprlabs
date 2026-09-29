"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { markShown, useRestored } from "@/components/alpha/restored";
import { ScreenError } from "@/components/admin/states";

type Status = "shown" | "checking" | "denied" | "failed";

const CHECK_FAILED = new Error("Couldn't check whether the history is still shared.");

/**
 * A12's history, as the server rendered it after checking the share, but only
 * while that check is current. Back or forward puts a page back without
 * asking the server (Next.js restores it from its client cache, the browser
 * may restore the whole tab), so a restored history is hidden (the loading
 * placeholders) until a fresh check (GET ./access, no-store) confirms the
 * share; if it has stopped, the denied state shows and the page is asked for
 * again, so the history leaves the client cache too. A history just rendered
 * by the server shows at once: that render was the check.
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
  const restored = useRestored(renderId);
  const [check, setCheck] = useState<{ id: string; status: Status } | null>(null);
  const status: Status = check?.id === renderId ? check.status : restored ? "checking" : "shown";

  useEffect(() => markShown(renderId), [renderId]);

  // The browser kept the whole tab (bfcache): check again.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setCheck({ id: renderId, status: "checking" });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [renderId]);

  useEffect(() => {
    if (status !== "checking") return;
    let live = true;
    const settle = (next: Status) => {
      if (!live) return;
      setCheck({ id: renderId, status: next });
      // Not shared (or no longer an admin): the server's page replaces the one kept.
      if (next === "denied") router.refresh();
    };
    fetch(`/admin/people/${encodeURIComponent(researcherId)}/access`, { cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        if (response.status === 403) return settle("denied");
        if (!response.ok) return settle("failed");
        const body = (await response.json()) as { shared?: unknown };
        settle(body.shared === true ? "shown" : "denied");
      })
      .catch(() => settle("failed"));
    return () => {
      live = false;
    };
  }, [status, renderId, researcherId, router]);

  if (status === "shown") return children;
  if (status === "denied") return denied;
  if (status === "failed")
    return (
      <ScreenError
        title={name}
        heading="Couldn't check access"
        error={CHECK_FAILED}
        retry={() => setCheck({ id: renderId, status: "checking" })}
        back={{ href: "/admin/people", label: "People" }}
      />
    );
  return checking;
}
