import { AppPage } from "@/components/app-shell/app-shell";
import { RemindersSettings } from "@/components/push/reminders-panel";
import { requireRole } from "@/lib/auth/session";
import { pushTestEnabled } from "@/lib/push/send";

/** C2 settings: reminders on this phone (per device). */
export default async function NotificationsPage() {
  const researcher = await requireRole("researcher", "/app/notifications");
  return (
    <AppPage width="form">
      <RemindersSettings
        userId={researcher.id}
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        testEnabled={pushTestEnabled()}
      />
    </AppPage>
  );
}
