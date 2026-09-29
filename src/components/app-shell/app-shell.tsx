import { NavChoiceProvider } from "@/components/alpha/shell/nav-choice";
import { NavCountsProvider } from "@/components/alpha/shell/nav-counts";
import { SectionNav } from "@/components/alpha/shell/section-nav";
import { Sidebar } from "@/components/alpha/shell/sidebar";
import { TabBar } from "@/components/alpha/shell/tab-bar";
import type { AppIdentity } from "@/lib/app/identity";

/**
 * Signed-in chrome for the research side (/app) and the admin area (/admin),
 * design v3: a docked tab bar below 760 px and a 232 px sidebar from 760 px.
 * The navigation follows the person's role (every admin is also a
 * researcher), so both areas show the same shell. Safe areas are padded with
 * env(safe-area-inset-*).
 */
export function AppShell({ identity, children }: { identity: AppIdentity; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col laptop:pl-[232px]" data-slot="app-shell">
      <NavChoiceProvider>
        <NavCountsProvider>
          <Sidebar identity={identity} />
          <div className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">
            <SectionNav role={identity.role} />
            {children}
          </div>
          <TabBar role={identity.role} />
        </NavCountsProvider>
      </NavChoiceProvider>
    </div>
  );
}
