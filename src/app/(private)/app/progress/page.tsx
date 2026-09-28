import { ProgressScreen } from "@/components/research/progress/progress-screen";
import { shortDate } from "@/lib/alpha/format";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles, listCyclePeptides } from "@/lib/cycles/service";
import { addDaysToDate } from "@/lib/doses/rules";
import { confirmationsByCycle, listDoseRecords, listDoseSkips } from "@/lib/doses/service";
import { cycleStartOf, progressScreen, progressSelection, readRange } from "@/lib/progress/screen";
import { countCheckIns, listCheckIns } from "@/lib/progress/service";
import { NO_CYCLE_PARAM } from "@/lib/progress/view";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * How far back the check-in sheet looks for a measurement's last value
 * ("Last: 81.7 kg · Mon Sep 21"), as Today does; and how far before a
 * cycle's start its measurement baseline is looked for.
 */
const MEASUREMENT_LOOKBACK_DAYS = 90;

/**
 * R5 / D3 Progress, for the signed-in researcher's own records only (a
 * granted admin reads other people's check-ins in A8, S17, never here).
 * `?range=7d|30d|cycle` (30 days by default) and `?cycle=<id>|none` (by
 * default the current cycle, else check-ins only). A check-in needs no cycle.
 */
export default async function ProgressPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = typeof params.cycle === "string" ? params.cycle.toLowerCase() : null;
  const asked = raw === NO_CYCLE_PARAM || (raw && UUID.test(raw)) ? raw : null;
  const range = readRange(params.range);
  const query = new URLSearchParams({ ...(range ? { range } : {}), ...(asked ? { cycle: asked } : {}) }).toString();
  const person = await requireResearcher(`/app/progress${query ? `?${query}` : ""}`);

  const db = await createClient();
  const now = new Date();
  const cycles = await listCycles(db, person.id);
  const { cycle, window } = progressSelection(cycles, asked, range, now);
  // From the range, R6's lookback and, with a cycle, the lookback before its start (the measurement's baseline).
  const start = cycle ? cycleStartOf(cycle) : null;
  const lookback = [window.from, addDaysToDate(window.today, -MEASUREMENT_LOOKBACK_DAYS), ...(start ? [addDaysToDate(start, -MEASUREMENT_LOOKBACK_DAYS)] : [])].sort()[0];
  const [library, total, checkIns, records, skips] = await Promise.all([
    listCyclePeptides(db),
    countCheckIns(db, person.id),
    listCheckIns(db, person.id, { from: lookback, to: window.today }),
    // Doses are shown only beside a cycle.
    cycle ? listDoseRecords(db, person.id) : Promise.resolve([]),
    cycle ? listDoseSkips(db, person.id) : Promise.resolve([]),
  ]);

  const screen = progressScreen({
    cycles,
    selectedId: asked,
    range,
    checkIns,
    total,
    confirmations: confirmationsByCycle(records, skips),
    peptides: new Map(library.map((peptide) => [peptide.id, peptide])),
    now,
  });

  // R6's "Last: …" beside the measurement: each kind's latest value before today.
  const last: Record<string, { value: string; unit: string; day: string }> = {};
  for (const entry of checkIns) {
    if (entry.measurement && entry.day < window.today) last[entry.measurement.name] = { value: entry.measurement.value, unit: entry.measurement.unit, day: shortDate(entry.day) };
  }

  return <ProgressScreen screen={screen} checkIn={{ day: window.today, dayLabel: shortDate(window.today), last }} />;
}
