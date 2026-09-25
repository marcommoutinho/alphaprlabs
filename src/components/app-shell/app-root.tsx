"use client";

import { createContext, useContext, useRef, type RefObject } from "react";
import { ToastProvider } from "./toast";

const PortalContainerContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/**
 * Where menus, modals and sheets portal to. Portalling inside `.app-root`
 * keeps them under the app's scoped tokens and styles instead of `<body>`.
 */
export function usePortalContainer(): RefObject<HTMLDivElement | null> | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}

/**
 * Scope root for everything private (`/app`, `/admin`, `/auth`). All app
 * styles are selected under `.app-root`, so they can never reach the public
 * site even though Next.js keeps loaded stylesheets across navigations.
 */
export function AppRoot({ children }: { children: React.ReactNode }) {
  const portalRef = useRef<HTMLDivElement>(null);
  return (
    <div className="app-root">
      <PortalContainerContext value={portalRef}>
        <ToastProvider>{children}</ToastProvider>
      </PortalContainerContext>
      <div ref={portalRef} className="app-portals" />
    </div>
  );
}
