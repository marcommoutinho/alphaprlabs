import type { AppIdentity } from "@/lib/app/identity";
import { AppHeader } from "./app-header";
import { TabBar } from "./tab-bar";

/** Signed-in chrome for /app (researcher) and /admin. */
export function AppShell({ identity, children }: { identity: AppIdentity; children: React.ReactNode }) {
  return (
    <div className="app-shell" data-role={identity.role}>
      <AppHeader identity={identity} />
      {children}
      <TabBar role={identity.role} />
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

/** Title-only placeholder until the owning slice builds the screen. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <AppPage>
      <h1 className="app-h1">{title}</h1>
    </AppPage>
  );
}
