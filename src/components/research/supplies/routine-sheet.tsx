"use client";

import { useState } from "react";
import { endRoutineAction, saveRoutineAction } from "@/app/(private)/app/supplements/actions";
import { isOnline } from "@/components/alpha/online";
import { Button } from "@/components/alpha/button";
import { Field, TextInput } from "@/components/alpha/field";
import { Sheet, SheetContent } from "@/components/alpha/sheet";
import { formatMonthDay } from "@/lib/format";
import { REMINDERS_LATER, SUPPLEMENT_TIME_ZONE } from "@/lib/supplements/rules";
import type { RoutineCard } from "@/lib/supplements/view";
import { useRequestKey, useSheetAction } from "./supplies-shared";

/** Today in Toronto, "YYYY-MM-DD" (the day routines start and end by). */
const torontoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: SUPPLEMENT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * R13's routine sheet: add (name, amount, unit, daily time, start, optional
 * end) or edit one (from now on; the start stays), End routine (asks first;
 * its history is kept), and an ended routine's details and history.
 */
export function RoutineSheet({ routine, onClose }: { routine: RoutineCard | "new" | null; onClose: () => void }) {
  return (
    <Sheet open={routine !== null} onOpenChange={(next) => (next ? null : onClose())}>
      {routine === "new" ? <RoutineBody key="new" routine={null} onClose={onClose} /> : null}
      {routine && routine !== "new" ? <RoutineBody key={`${routine.id}/${routine.version}`} routine={routine} onClose={onClose} /> : null}
    </Sheet>
  );
}

function RoutineBody({ routine, onClose }: { routine: RoutineCard | null; onClose: () => void }) {
  const save = useSheetAction(saveRoutineAction);
  const end = useSheetAction(endRoutineAction);
  const saveKey = useRequestKey();
  const endKey = useRequestKey();
  const [today] = useState(torontoToday);
  const [name, setName] = useState(routine?.name ?? "");
  const [amount, setAmount] = useState(routine?.amount ?? "");
  const [unit, setUnit] = useState(routine?.unit ?? "");
  const [time, setTime] = useState(routine?.time ?? "08:00");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(routine?.endDate ?? "");
  const [confirming, setConfirming] = useState(false);
  const ended = routine?.ended ?? false;

  const submit = () => {
    // Offline, a save waits for the connection (the button is disabled; this covers Enter and keyboard submits).
    if (!isOnline()) return;
    const form = {
      id: routine?.id ?? null,
      version: routine?.version ?? null,
      name,
      amount,
      unit,
      time,
      startDate: routine ? null : startDate,
      endDate: endDate || null,
    };
    save.run({ ...form, requestKey: saveKey.keyFor(form) }, () => {
      saveKey.done();
      onClose();
    });
  };
  const endNow = () => {
    const form = { id: routine!.id, version: routine!.version };
    end.run({ ...form, requestKey: endKey.keyFor(form) }, () => {
      endKey.done();
      onClose();
    });
  };

  const footer = ended ? null : confirming ? (
    <>
      <Button size="lg" variant="outline" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button needsConnection size="lg" variant="ink" saving={end.pending} onClick={endNow} data-testid="end-confirm">
        End routine
      </Button>
    </>
  ) : (
    <Button needsConnection size="lg" block saving={save.pending} onClick={submit} data-testid="routine-submit">
      {routine ? "Save routine" : "Add routine"}
    </Button>
  );

  return (
    <SheetContent title={routine ? routine.name : "Add routine"} context={routine ? routine.dates : "Supplement · daily"} footer={footer}>
      {confirming ? (
        <p role="alert" className="mx-2 rounded-[14px] bg-sunken px-3.5 py-3 text-[14px] leading-5 text-ink-2">
          {routine?.upcoming
            ? "End this routine before it starts? It won't run, and it stays listed as ended."
            : "End this routine today? Today is its last day; its history is kept and nothing is deleted."}
        </p>
      ) : null}
      {end.error ? (
        <p role="alert" className="mx-2 text-[14px] font-medium text-missed">
          {end.error}
        </p>
      ) : null}

      {ended ? (
        <p className="mx-2 text-[15px] leading-[22px] text-ink-2" data-testid="routine-ended">
          {routine!.title} · {routine!.schedule}. {routine!.state}. Its history is kept; add a new routine to start again.
        </p>
      ) : (
        <form
          className="flex flex-col gap-3.5 px-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label="Name">
            <TextInput compact value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vitamin D3" maxLength={80} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount">
              <TextInput compact inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2000" />
            </Field>
            <Field label="Unit">
              <TextInput compact value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. IU" maxLength={20} />
            </Field>
          </div>
          <Field label="Daily time" description={routine ? "Changes apply from today on; what was taken stays as recorded." : undefined}>
            <TextInput compact mono type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {routine ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">Start</span>
                <span className="flex h-11 items-center rounded-[12px] bg-sunken px-3.5 font-mono text-[15px] text-ink-2">{formatMonthDay(routine.startDate)}</span>
              </div>
            ) : (
              <Field label="Start">
                <TextInput compact mono type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
            )}
            <Field label="End" optional>
              <TextInput compact mono type="date" value={endDate} min={routine ? today : startDate || today} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      )}
      {save.error ? (
        <p role="alert" className="mx-2 text-[14px] font-medium text-missed">
          {save.error}
        </p>
      ) : null}

      {routine && !ended && !confirming ? (
        <Button variant="destructive-text" size="md" className="mx-2 self-start" onClick={() => setConfirming(true)}>
          End routine
        </Button>
      ) : null}

      {routine ? (
        <section aria-label={`${routine.name} history`} className="px-2">
          <h3 className="mb-1 text-[13px] font-semibold text-ink-2">Taken · {routine.recent}</h3>
          {routine.history.length ? (
            <ol className="divide-y divide-line">
              {routine.history.slice(0, 14).map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2 text-[14px]" data-testid="routine-history-row">
                  <span className="font-mono text-[13px]">{entry.when}</span>
                  <span className="text-ink-2">
                    {entry.amount} · {entry.planned}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[14px] text-ink-3">Nothing recorded yet.</p>
          )}
        </section>
      ) : (
        <p className="mx-2 text-[13px] leading-[18px] text-ink-3">{REMINDERS_LATER}</p>
      )}
    </SheetContent>
  );
}
