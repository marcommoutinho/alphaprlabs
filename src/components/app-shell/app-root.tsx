"use client";

import { createContext, useContext, useRef, type RefObject } from "react";
import { ToastProvider } from "./toast";

const PortalContainerContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/**
 * Where the legacy screens' menus, modals and sheets portal to: inside a
 * `.app-root` host, so they keep the legacy scoped tokens and styles.
 */
export function usePortalContainer(): RefObject<HTMLDivElement | null> | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}

/**
 * Legacy style scope for the private area (/app, /admin, /auth) while the
 * screens are rebuilt to design v3. The legacy styles are all selected under
 * `.app-root`; each legacy page renders its own `.app-root` (AppPage, the auth
 * layout), and the legacy toasts and portals render in `.app-root` hosts that
 * draw no box (display: contents). The v3 shell and components sit outside
 * every `.app-root`, so legacy rules never reach them.
 */
export function AppRoot({ children }: { children: React.ReactNode }) {
  const portalRef = useRef<HTMLDivElement>(null);
  return (
    <PortalContainerContext value={portalRef}>
      <ToastProvider>{children}</ToastProvider>
      <div className="app-root" data-legacy-host="">
        <div ref={portalRef} className="app-portals" />
      </div>
    </PortalContainerContext>
  );
}
