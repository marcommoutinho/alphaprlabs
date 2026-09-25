import { AppShell } from "@/components/app-shell/app-shell";
import { DEV_PLACEHOLDER_IDENTITY } from "@/lib/app/identity";

export default function ResearcherLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // DEV_PLACEHOLDER_IDENTITY is development-only; S2 replaces it with the
  // signed-in researcher's verified identity.
  return <AppShell identity={DEV_PLACEHOLDER_IDENTITY.researcher}>{children}</AppShell>;
}
