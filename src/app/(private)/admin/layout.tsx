import { AppShell } from "@/components/app-shell/app-shell";
import { RecordProvider } from "@/components/records/record-provider";
import { requireAdmin } from "@/lib/auth/session";

// Admins only (researchers are sent to Today). Layouts don't re-run on every
// client navigation, so pages and server actions that touch data re-check the
// role themselves. Record sale and Record purchase (A4 / A5, the D4 / D5
// drawers) open from any admin page over it (RecordProvider).
export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();
  return (
    <AppShell identity={{ name: admin.name, email: admin.email, role: admin.role }}>
      <RecordProvider>{children}</RecordProvider>
    </AppShell>
  );
}
