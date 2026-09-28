import { AppShell } from "@/components/app-shell/app-shell";
import { BadgeSync } from "@/components/push/app-badge";
import { PushSync } from "@/components/push/push-sync";
import { requireResearcher } from "@/lib/auth/session";

// The research side: researchers and admins (every admin is also a
// researcher) who have acknowledged the disclaimer; others are routed to the
// acknowledgement. Pages and server actions that touch data re-check access
// themselves, and only ever for the person's own records.
export default async function ResearcherLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const researcher = await requireResearcher();
  return (
    <AppShell identity={{ name: researcher.name, email: researcher.email, role: researcher.role }}>
      {children}
      <PushSync userId={researcher.id} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      <BadgeSync />
    </AppShell>
  );
}
