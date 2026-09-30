import { RemindersSettings } from "@/components/push/reminders-panel";
import { requireResearcher } from "@/lib/auth/session";
import { pushTestEnabled } from "@/lib/push/send";

/** R8 Tracking › Dose reminders: reminders on this phone (per device), in design v3. */
export default async function NotificationsPage() {
  const researcher = await requireResearcher("/app/notifications");
  return (
    <RemindersSettings
      userId={researcher.id}
      vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
      testEnabled={pushTestEnabled()}
      headsUpMinutes={researcher.preferences.headsUpMinutes}
    />
  );
}
