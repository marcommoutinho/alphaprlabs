import type { AppIdentity, AppSide } from "@/lib/app/identity";
import { AppHeader } from "./app-header";
import { TabBar } from "./tab-bar";

/**
 * Signed-in chrome for the research side (/app) and the admin back office
 * (/admin). `side` picks the navigation; `identity.role` only decides whether
 * the account menu offers the switch to the admin side.
 */
export function AppShell({
  identity,
  side,
  children,
}: {
  identity: AppIdentity;
  side: AppSide;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell" data-side={side}>
      <AppHeader identity={identity} side={side} />
      {children}
      <TabBar side={side} />
    </div>
  );
}

type PageWidth = "list" | "form" | "support" | "narrow";

/**
 * One screen's <main>: handoff page padding, max width and the fadeUp enter
 * motion (re-runs on every navigation because each page renders its own).
 * Widths: list 1040, form 640, support 860, narrow 760.
 */
export function AppPage({ width = "list", children }: { width?: PageWidth; children: React.ReactNode }) {
  return (
    <main className="app-page" data-width={width}>
      {children}
    </main>
  );
}
