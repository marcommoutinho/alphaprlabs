import { AppShell } from "@/components/app-shell/app-shell";
import { DEV_PLACEHOLDER_IDENTITY } from "@/lib/app/identity";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // DEV_PLACEHOLDER_IDENTITY is development-only; S2 replaces it with the
  // signed-in admin's verified identity.
  return <AppShell identity={DEV_PLACEHOLDER_IDENTITY.admin}>{children}</AppShell>;
}
