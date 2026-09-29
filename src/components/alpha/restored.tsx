"use client";

import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * Back/forward puts a page back without asking the server: Next.js restores it
 * from its client cache whatever staleTimes says (16.3.7), and the browser may
 * restore the whole document from its back/forward cache. A page that checks
 * access on each request would come back as it was: a researcher history
 * after the share stopped, a peptide after it left the Library, with the
 * researcher's own regimen.
 *
 * Such a page renders a fresh id on every server render (crypto.randomUUID()
 * in the page). The first time that payload mounts it came straight from the
 * server; the same id mounting again is a restore. Only ids are kept, for
 * this tab.
 */
const shown = new Set<string>();

/**
 * The gate for one server render (`id`): `restoring` while the page was put
 * back without the server, from a mount of an id already shown (decided once,
 * when it mounts: a new id on the same mount is a fresh render) or a document
 * restored by the browser (pageshow persisted). Leaving the document
 * (pagehide) hides `box` at once, on the element itself, so a document the
 * browser keeps comes back hidden before any script runs. `reveal()` ends the
 * restore for this id (a check passed); a new id ends it too.
 */
export function useRestoreGate(id: string): { restoring: boolean; box: RefObject<HTMLDivElement | null>; reveal: () => void } {
  const [state, setState] = useState(() => ({ id, restoring: shown.has(id) }));
  const restoring = state.id === id && state.restoring;
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    shown.add(id);
  }, [id]);

  useEffect(() => {
    const onHide = () => {
      const element = box.current;
      if (!element) return;
      element.style.display = "none";
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    };
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setState({ id, restoring: true });
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, [id]);

  const reveal = useCallback(() => setState({ id, restoring: false }), [id]);
  return { restoring, box, reveal };
}

/** What a gate shows once revealed: its children, in a box that adds no layout (see useRestoreGate). */
export function GateBox({ box, children }: { box: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div ref={box} style={{ display: "contents" }} data-gate="open">
      {children}
    </div>
  );
}
