import { AppShell } from "@/components/app-shell/app-shell";
import { requireRole } from "@/lib/auth/session";

// Admins only. Layouts don't re-run on every client navigation, so pages and
// server actions that touch data re-check the role themselves.
export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireRole("admin");
  return <AppShell identity={{ name: admin.name, email: admin.email, role: admin.role }}>{children}</AppShell>;
}
