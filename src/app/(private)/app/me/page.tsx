import { cookies } from "next/headers";
import { MeScreen } from "@/components/research/me/me-screen";
import { APPEARANCE_COOKIE, parseAppearance } from "@/lib/alpha/appearance";
import { initialsOf } from "@/lib/app/identity";
import { requireResearcher } from "@/lib/auth/session";
import { formatMonthYear } from "@/lib/format";
import { getSupplyTracking } from "@/lib/mixtures/service";
import { getSupplementTracking, listRoutines } from "@/lib/supplements/service";
import { listShareHistory } from "@/lib/support/service";
import { shareEvents, sharingSince, SUPPORT_TIME_ZONE, supplementsSummary } from "@/lib/support/view";
import { createClient } from "@/lib/supabase/server";

/**
 * R8 Me (design v3): the signed-in person's profile, support access (share
 * the full history, read-only, with the Alpha PR Labs admins, and every
 * share and stop since), tracking, preferences and account. Only ever the
 * caller's own records, and never an admin's name.
 */
export default async function MePage() {
  const person = await requireResearcher("/app/me");
  const db = await createClient();
  const [shares, supplyTracking, supplementTracking, routines, jar] = await Promise.all([
    listShareHistory(db, person.id),
    getSupplyTracking(db, person.id),
    getSupplementTracking(db, person.id),
    listRoutines(db, person.id),
    cookies(),
  ]);
  const since = sharingSince(shares);

  return (
    <MeScreen
      view={{
        id: person.id,
        name: person.name,
        initials: initialsOf(person.name),
        email: person.email,
        since: `${person.role === "admin" ? "Admin" : "Researcher"} since ${formatMonthYear(person.createdAt, { timeZone: SUPPORT_TIME_ZONE })}`,
        sharing: since !== null,
        sharingSince: since,
        events: shareEvents(shares),
        supplyTracking,
        supplementTracking,
        routines: supplementsSummary(supplementTracking, routines, new Date()),
        preferences: person.preferences,
        appearance: person.preferences.appearance,
        deviceAppearance: parseAppearance(jar.get(APPEARANCE_COOKIE)?.value),
      }}
    />
  );
}
