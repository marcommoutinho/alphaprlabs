import { AppShell } from "@/components/app-shell/app-shell";
import { requireRole } from "@/lib/auth/session";

// Researchers who have acknowledged the disclaimer (others are routed to the
// acknowledgement, and admins to their own home). Pages and server actions
// that touch data re-check access themselves.
export default async function ResearcherLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const researcher = await requireRole("researcher");
  return (
    <AppShell identity={{ name: researcher.name, email: researcher.email, role: researcher.role }}>
      {children}
    </AppShell>
  );
}
