"use client";

import { createContext, useContext, useRef, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { ToastProvider } from "./toast";

const PortalContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/**
 * Where v3 sheets, drawers and menus portal to: inside the root, so they keep
 * its fonts (the document's own font is the public site's).
 */
export function useAlphaPortal(): RefObject<HTMLDivElement | null> | undefined {
  return useContext(PortalContext) ?? undefined;
}

/**
 * Root of the private app (design v3). A direct child of <body>: its presence
 * turns on the v3 tokens (src/styles/alpha/tokens.css). The mode is the
 * `.light` / `.dark` class the private root layout renders on <html>. Hosts
 * the v3 toasts and portals.
 */
export function AlphaRoot({ className, children }: { className?: string; children: React.ReactNode }) {
  const portalRef = useRef<HTMLDivElement>(null);
  return (
    <div className={cn("alpha", className)}>
      <PortalContext value={portalRef}>
        <ToastProvider>{children}</ToastProvider>
      </PortalContext>
      <div ref={portalRef} className="contents" data-alpha-portals="" />
    </div>
  );
}
