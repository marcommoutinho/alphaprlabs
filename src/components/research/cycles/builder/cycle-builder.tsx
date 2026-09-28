"use client";

import Link from "@/components/alpha/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";
import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { saveCycleAction } from "@/app/(private)/app/cycles/actions";
import { Button } from "@/components/alpha/button";
import { useAlphaToast } from "@/components/alpha/toast";
import { mgFromUnit } from "@/lib/alpha/format";
import { isPositiveDecimal } from "@/lib/calculator/decimal";
import {
  blankMix,
  type BuilderMix,
  type BuilderPhase,
  type BuilderPlan,
  type BuilderState,
  cycleDays,
  mixEntry,
  mixIssues,
  newBuilderPlan,
  newPhase,
  reviewIssues,
  scheduleIssues,
  withDose,
  withUnit,
  formFromBuilder,
} from "@/lib/cycles/builder";
import { builderTitle, fromTemplateNote, saveLabel } from "@/lib/cycles/display";
import { plusDays } from "@/lib/cycles/geometry";
import { type CyclePeptide, PEPTIDE_REQUIRED, tomorrowIn } from "@/lib/cycles/rules";
import { SAVE_FAILED_MESSAGE } from "@/components/app-shell/toast";
import { isValidTimeZone } from "@/lib/schedule/zone";
import { cn } from "@/lib/utils";
import { Footer, Issues, PlanChips } from "./parts";
import { StepDose } from "./step-dose";
import { StepPeptides } from "./step-peptides";
import { StepReview } from "./step-review";
import { StepSchedule } from "./step-schedule";

type Step = "peptides" | "dose" | "schedule" | "review";

// The device's IANA zone: the suggestion for a new cycle. Read on the client
// only; the server renders without it.
const noSubscription = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
const noZone = () => "";

/**
 * R4a–c Build a cycle and its review (design v3): full screen on the phone
 * (over the tab bar), in the page on a laptop. Three steps, the second and
 * third one peptide at a time, then the review with Start cycle. The same
 * flow edits a cycle ("Edit future plan": ended phases read-only, started
 * ones keep their start, a started peptide can't be removed) and starts one
 * from a template (prefilled). Saved through saveCycleAction, which checks
 * everything again; each issue list shows its first entry plus "(+N more)".
 *
 * The time zone is named and stored with the cycle: a new cycle suggests the
 * device's zone, and while the researcher hasn't chosen a start date the
 * start follows "tomorrow" in the chosen zone.
 */
export function CycleBuilder({
  initial,
  peptides,
  zones,
  now,
  datesZone,
  templateName = null,
  templates = null,
  savedMixes = {},
  effective = {},
  startLocked = false,
}: {
  initial: BuilderState;
  /** Names for every peptide the builder may show (only available ones are offered). */
  peptides: CyclePeptide[];
  zones: string[];
  /** The server's "now" (ISO). */
  now: string;
  /** The zone the initial start date was computed in. */
  datesZone: string;
  templateName?: string | null;
  /** R4a's template row ("Recovery stack, GLP-1 starter and 4 more"), or null. */
  templates?: string | null;
  /** The researcher's saved mix per peptide, reused when a peptide is added. */
  savedMixes?: Record<string, BuilderMix>;
  /** While editing: each plan's first date changes apply from. */
  effective?: Record<string, string>;
  startLocked?: boolean;
}) {
  const editing = initial.cycleId !== null;
  const [state, setState] = useState<BuilderState>(initial);
  const [step, setStep] = useState<Step>("peptides");
  const [current, setCurrent] = useState(0);
  const [issues, setIssues] = useState<string[]>([]);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [startTouched, setStartTouched] = useState(editing);
  const [datedFor, setDatedFor] = useState(editing ? initial.timeZone : datesZone);
  const [pending, startTransition] = useTransition();
  const device = useSyncExternalStore(noSubscription, deviceZone, noZone);
  const toast = useAlphaToast();
  const router = useRouter();
  const top = useRef<HTMLDivElement>(null);
  // The last submission's details and request key (see save()).
  const submission = useRef<{ payload: string; key: string } | null>(null);

  const library = useMemo(() => new Map(peptides.map((peptide) => [peptide.id, peptide])), [peptides]);
  const nameOf = (id: string) => library.get(id)?.name ?? "Unknown peptide";

  // A new cycle follows the device's zone until the researcher picks one; an
  // untouched start moves to tomorrow in the zone chosen.
  const timeZone = state.timeZone || (editing ? "" : device);
  const zoneForDates = isValidTimeZone(timeZone) ? timeZone : datedFor;
  if (zoneForDates !== datedFor) {
    setDatedFor(zoneForDates);
    if (!startTouched) {
      const days = Temporal.PlainDate.from(tomorrowIn(now, datedFor)).until(tomorrowIn(now, zoneForDates)).days;
      if (days !== 0) setState((s) => ({ ...s, start: plusDays(s.start, days) }));
    }
  }
  const zoneOptions = useMemo(() => [...new Set([...zones, ...(timeZone ? [timeZone] : [])])].sort(), [zones, timeZone]);

  const plan = state.plans[Math.min(current, state.plans.length - 1)] as BuilderPlan | undefined;
  const totalDays = cycleDays(state);
  const cancelHref = editing ? `/app/cycles/${state.cycleId}` : "/app/cycles";

  const go = (next: Step, index = current) => {
    setIssues([]);
    setIssuesOpen(false);
    setStep(next);
    setCurrent(index);
    if (next === "schedule") setExpanded(state.plans[index]?.phases.find((phase) => phase.lock !== "ended")?.key ?? null);
    top.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };
  const fail = (list: string[]) => {
    setIssues(list);
    setIssuesOpen(false);
  };
  const updatePlan = (index: number, change: (plan: BuilderPlan) => BuilderPlan) =>
    setState((s) => ({ ...s, plans: s.plans.map((p, i) => (i === index ? change(p) : p)) }));
  const patchPhase = (key: string, patch: Partial<BuilderPhase>) =>
    updatePlan(current, (p) => ({ ...p, phases: p.phases.map((phase) => (phase.key === key ? { ...phase, ...patch } : phase)) }));

  function toggle(peptide: CyclePeptide) {
    setIssues([]);
    setState((s) => {
      const index = s.plans.findIndex((p) => p.peptideId === peptide.id);
      if (index >= 0) return s.plans[index].started ? s : { ...s, plans: s.plans.filter((_, i) => i !== index) };
      return { ...s, plans: [...s.plans, newBuilderPlan(peptide.id, savedMixes[peptide.id] ?? blankMix())] };
    });
  }

  function doseContinue() {
    if (!plan) return;
    const name = nameOf(plan.peptideId);
    const list = [...(isPositiveDecimal(mgFromUnit(plan.dose, plan.unit)) ? [] : [`${name}: enter a dose above 0.`]), ...mixIssues(plan, name)];
    if (list.length) return fail(list);
    go("schedule");
  }

  function scheduleNext() {
    if (!plan) return;
    const list = scheduleIssues(plan, nameOf(plan.peptideId));
    if (list.length) return fail(list);
    if (current < state.plans.length - 1) go("dose", current + 1);
    else go("review");
  }

  function back() {
    if (step === "dose") return current === 0 ? go("peptides", 0) : go("schedule", current - 1);
    if (step === "schedule") return go("dose");
    if (step === "review") return go("schedule", state.plans.length - 1);
  }

  function save() {
    const list = reviewIssues(state, nameOf, isValidTimeZone(timeZone));
    if (list.length) return fail(list);
    const mixes = state.plans.map((plan) => mixEntry(plan, state.links[plan.peptideId] ?? null)).filter((entry) => entry !== null);
    const payload = { ...formFromBuilder({ ...state, timeZone }), mixes };
    // One request key per submission: the same details sent again (a retry
    // after a lost answer) reuse it, so the server returns that save instead
    // of saving twice; anything changed is a new submission.
    const text = JSON.stringify(payload);
    if (submission.current?.payload !== text) submission.current = { payload: text, key: crypto.randomUUID() };
    const requestKey = submission.current.key;
    startTransition(async () => {
      let result;
      try {
        result = await saveCycleAction({ ...payload, requestKey });
      } catch (error) {
        unstable_rethrow(error);
        toast.error({ message: SAVE_FAILED_MESSAGE });
        return;
      }
      if (result.errors?.length) return fail(result.errors);
      if (result.toast) return toast.error({ message: result.toast });
      if (result.saved && result.cycleId) {
        toast.success({ message: result.message ?? "Saved." });
        router.push(`/app/cycles/${result.cycleId}`);
      }
    });
  }

  const stepNumber = step === "peptides" ? 1 : step === "dose" ? 2 : 3;
  const chips = state.plans.map((p) => ({ key: p.planId ?? p.peptideId, name: nameOf(p.peptideId), set: isPositiveDecimal(mgFromUnit(p.dose, p.unit)) }));

  return (
    <div
      ref={top}
      className={cn(
        "fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-paper pt-[env(safe-area-inset-top)] text-ink",
        "laptop:static laptop:z-auto laptop:mx-auto laptop:min-h-full laptop:w-full laptop:max-w-[720px] laptop:overflow-visible laptop:px-8 laptop:pt-6",
      )}
      data-testid="cycle-builder"
      data-step={step}
    >
      <nav aria-label="Builder" className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-5 text-[17px] laptop:px-0">
        <Link href={cancelHref} className="justify-self-start text-signal-ink">
          Cancel
        </Link>
        <span className="font-semibold" data-testid="builder-title">
          {builderTitle(editing)}
        </span>
        <span className="justify-self-end font-mono text-[13px] font-medium text-ink-3" data-testid="builder-step">
          {step === "review" ? "Review" : `${stepNumber} of 3`}
        </span>
      </nav>
      <div className="mx-5 mt-1.5 grid shrink-0 grid-cols-3 gap-1 laptop:mx-0" aria-hidden>
        {[1, 2, 3].map((n) => (
          <i key={n} className={cn("h-1 rounded-[2px]", n <= stepNumber ? "bg-ink" : "bg-line")} />
        ))}
      </div>

      <div className="flex-1 pb-6">
        {step === "peptides" ? (
          <StepPeptides
            selected={state.plans.map((p) => ({ peptide: library.get(p.peptideId) ?? { id: p.peptideId, name: nameOf(p.peptideId), available: false }, locked: p.started }))}
            library={peptides}
            templates={editing || templateName ? null : templates}
            templateNote={templateName ? fromTemplateNote(templateName) : null}
            onToggle={toggle}
          />
        ) : null}
        {step === "dose" && plan ? (
          <>
            <PlanChips plans={chips} current={current} onSelect={(i) => go("dose", i)} />
            <StepDose
              plan={plan}
              name={nameOf(plan.peptideId)}
              onDose={(dose) => updatePlan(current, (p) => withDose(p, dose))}
              onUnit={(unit) => updatePlan(current, (p) => withUnit(p, unit))}
              onMix={(mix) => updatePlan(current, (p) => ({ ...p, mix }))}
              linked={plan.peptideId in state.links}
            />
          </>
        ) : null}
        {step === "schedule" && plan ? (
          <>
            <PlanChips plans={chips} current={current} onSelect={(i) => go("schedule", i)} />
            <div className="px-5 pt-[18px] laptop:px-0">
              <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.025em]">{nameOf(plan.peptideId)}</h1>
              <p className="mt-1 text-[15px] text-ink-2">Phases and breaks, by day of the cycle. A dose change is a new phase.</p>
            </div>
            <StepSchedule
              plan={plan}
              name={nameOf(plan.peptideId)}
              start={state.start}
              startLocked={startLocked}
              totalDays={totalDays}
              effective={plan.planId ? (effective[plan.planId] ?? null) : null}
              expanded={expanded}
              onExpand={setExpanded}
              onStart={(start) => {
                setStartTouched(true);
                setState((s) => ({ ...s, start }));
              }}
              onPhase={patchPhase}
              onRemove={(key) => updatePlan(current, (p) => ({ ...p, phases: p.phases.filter((phase) => phase.key !== key) }))}
            />
          </>
        ) : null}
        {step === "review" ? (
          <StepReview
            state={state}
            timeZone={timeZone}
            zones={zoneOptions}
            totalDays={totalDays}
            nameOf={nameOf}
            onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
          />
        ) : null}
      </div>

      <Footer>
        <Issues issues={issues} open={issuesOpen} onOpenChange={setIssuesOpen} />
        {step === "peptides" ? (
          <Button
            variant="ink"
            block
            onClick={() => (state.plans.length ? go("dose", 0) : fail([PEPTIDE_REQUIRED]))}
          >
            {state.plans.length ? `Continue with ${state.plans.length} ${state.plans.length === 1 ? "peptide" : "peptides"}` : "Choose a peptide"}
          </Button>
        ) : null}
        {step === "schedule" && plan ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="md" onClick={() => addPhase("active")}>
              + Phase
            </Button>
            <Button variant="outline" size="md" onClick={() => addPhase("break")}>
              + Break
            </Button>
          </div>
        ) : null}
        {step !== "peptides" ? (
          <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2.5">
            <Button variant="outline" onClick={back} className="text-base">
              Back
            </Button>
            {step === "dose" ? (
              <Button variant="ink" onClick={doseContinue}>
                Continue
              </Button>
            ) : step === "schedule" ? (
              <Button variant="ink" onClick={scheduleNext} className="min-w-0">
                <span className="truncate">{current < state.plans.length - 1 ? `Next: ${nameOf(state.plans[current + 1].peptideId)}` : "Review cycle"}</span>
              </Button>
            ) : (
              <Button variant="primary" onClick={save} saving={pending}>
                {saveLabel(editing)}
              </Button>
            )}
          </div>
        ) : null}
      </Footer>
    </div>
  );

  function addPhase(kind: "active" | "break") {
    if (!plan) return;
    const phase = newPhase(plan, kind);
    updatePlan(current, (p) => ({ ...p, phases: [...p.phases, phase] }));
    setExpanded(phase.key);
  }
}
