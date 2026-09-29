import { TodayScreen, type TodayCheckIn } from "@/components/research/today-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { confirmationsByCycle, listDoseRecords, listDoseSkips, planSetups } from "@/lib/doses/service";
import { todayView } from "@/lib/doses/today";
import { getSupplyTracking, listPersonalVials, planMixtures } from "@/lib/mixtures/service";
import { addDaysToDate } from "@/lib/doses/rules";
import { shortDate } from "@/lib/alpha/format";
import { shownMeasurement } from "@/lib/preferences/rules";
import { checkInDay } from "@/lib/progress/rules";
import { listCheckIns } from "@/lib/progress/service";
import { SUPPLEMENT_TIME_ZONE } from "@/lib/supplements/rules";
import { todayIn } from "@/lib/supplements/schedule";
import { getSupplementTracking, listRoutines, listTaken } from "@/lib/supplements/service";
import { supplementsToday } from "@/lib/supplements/view";
import { deductionsOfVials } from "@/lib/supplies/service";
import { todaySupply } from "@/lib/supplies/view";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const KEY = /^[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9-]{1,10}$/i;

/** How far back R6 looks for the last value of a measurement ("Last: 81.7 kg · Mon Sep 21"). */
const MEASUREMENT_LOOKBACK_DAYS = 90;

/** "Jordan Reyes" → "JR". */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]!.toUpperCase())
    .join("") || "?";

/**
 * R1 Today (design v3), for the signed-in researcher's own cycles only (a
 * granted admin reads other people's history in A8, never here).
 * `?dose=<occurrence key>` is where a reminder tap lands (public/sw.js opens
 * the payload's url): the dose's sheet opens with its current details, or a
 * note says it changed. With supplement tracking on, today's supplement
 * routines are on the day rail too, each with its own one-tap Taken; they
 * never touch peptide stock. Loading and error states: ./loading.tsx and
 * ./error.tsx (R9b, R9c).
 */
export default async function TodayPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const dose = typeof params.dose === "string" && KEY.test(params.dose) ? params.dose.toLowerCase() : null;
  const person = await requireResearcher(`/app/today${dose ? `?dose=${encodeURIComponent(dose)}` : ""}`);

  const db = await createClient();
  const now = new Date();
  // Today's supplement Taken records (yesterday included, for a zone seam).
  const supplementFrom = addDaysToDate(todayIn(now, SUPPLEMENT_TIME_ZONE), -1);
  const checkInToday = checkInDay(now);
  // Every read at once; the tracked vials' deductions as soon as tracking and the vials are known.
  const trackingLoading = getSupplyTracking(db, person.id);
  const vialsLoading = listPersonalVials(db, person.id);
  const trackedLoading = Promise.all([trackingLoading, vialsLoading]).then(([on, all]) => all.filter((vial) => on && vial.mixtureId && !vial.finishedAt));
  const [cycles, records, skips, library, mixtures, setups, tracking, vials, tracked, deductions, supplementTracking, routines, taken, checkIns] = await Promise.all([
    listCycles(db, person.id),
    listDoseRecords(db, person.id),
    listDoseSkips(db, person.id),
    listCyclePeptides(db),
    planMixtures(db, person.id),
    planSetups(db, person.id),
    trackingLoading,
    vialsLoading,
    trackedLoading,
    trackedLoading.then((open) => (open.length ? deductionsOfVials(db, open.map((vial) => vial.id)) : [])),
    getSupplementTracking(db, person.id),
    listRoutines(db, person.id),
    listTaken(db, person.id, { from: supplementFrom }),
    listCheckIns(db, person.id, { from: addDaysToDate(checkInToday, -MEASUREMENT_LOOKBACK_DAYS), to: checkInToday }),
  ]);
  const openVials = new Map<string, string>();
  if (tracking) for (const vial of vials) if (vial.mixtureId && !vial.finishedAt) openVials.set(vial.mixtureId, vial.label);
  const confirmations = confirmationsByCycle(records, skips);
  // R8: a low, empty or over tracked vial beside the doses it serves, and the low row.
  const peptides = new Map(library.map((peptide) => [peptide.id, peptide]));
  const supply = todaySupply({
    tracking,
    vials: tracked,
    mixtures,
    deductions,
    cycles,
    confirmations,
    now,
    peptideNames: new Map(library.map((peptide) => [peptide.id, peptide.name])),
  });

  const view = todayView({
    cycles,
    confirmations,
    peptides,
    mixtures,
    setups,
    vials: openVials,
    stock: supply.notes,
    vialEstimates: supply.vials,
    now,
    requestedKey: dose,
  });

  // R6: today's check-in (one per America/Toronto day), and each measurement's last value (a weight in R8's unit).
  const { weightUnit, defaultSyringe } = person.preferences;
  const last: TodayCheckIn["last"] = {};
  for (const entry of checkIns) {
    if (!entry.measurement) continue;
    const shown = shownMeasurement(entry.measurement, weightUnit);
    last[entry.measurement.name] = { value: shown.value, unit: shown.unit, day: shortDate(entry.day) };
  }
  const checkIn: TodayCheckIn = {
    day: checkInToday,
    dayLabel: shortDate(checkInToday),
    done: checkIns.some((entry) => entry.day === checkInToday),
    last,
    weightUnit,
  };

  return (
    <TodayScreen
      key={dose ?? ""}
      view={view}
      supplements={supplementsToday({ tracking: supplementTracking, routines, taken, now })}
      lowVials={supply.low}
      checkIn={checkIn}
      initials={initialsOf(person.name)}
      defaultSyringe={defaultSyringe}
    />
  );
}
