"use client";

import { ChevronRight, Eye, EyeOff, LogOut } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { savePreferencesAction, shareWithTeamAction, stopSharingAction } from "@/app/(private)/app/me/actions";
import { setSupplementTrackingAction } from "@/app/(private)/app/supplements/actions";
import { setTrackingAction } from "@/app/(private)/app/supplies/actions";
import { applyAppearance } from "@/components/alpha/appearance";
import { buttonVariants } from "@/components/alpha/button-variants";
import { Switch } from "@/components/alpha/field";
import Link from "@/components/alpha/link";
import { useOnline } from "@/components/alpha/online";
import { Group, GroupLabel } from "@/components/alpha/list";
import { Sheet, SheetContent } from "@/components/alpha/sheet";
import { useSignOut } from "@/components/app-shell/use-sign-out";
import { rememberedReminders } from "@/components/push/use-reminders";
import type { Appearance } from "@/lib/alpha/appearance";
import { SYRINGE_CAPACITIES, type SyringeCapacity } from "@/lib/calculator/calculator";
import {
  APPEARANCE_LABEL,
  APPEARANCE_NOTE,
  appearanceRowLabel,
  type PreferencePatch,
  type Preferences,
  SYRINGE_CHOICE_LABEL,
  SYRINGE_CHOICE_NOTE,
  WEIGHT_UNIT_LABEL,
  WEIGHT_UNIT_NOTE,
  WEIGHT_UNITS,
  type WeightUnit,
} from "@/lib/preferences/rules";
import { NEVER_ADDS, SUPPLIES_INTRO } from "@/lib/supplies/rules";
import { R8_COPY, R8_TITLE, type ShareEvent } from "@/lib/support/view";
import { cn } from "@/lib/utils";
import { CYCLES_MAIN } from "../cycles/cycles-list";
import { useRequestKey, useSheetAction } from "../supplies/supplies-shared";
import { ChoiceSheet, ShareSheet, StopSheet } from "./me-sheets";

export type MeView = {
  id: string;
  name: string;
  initials: string;
  email: string;
  /** "Researcher since Aug 2026" */
  since: string;
  sharing: boolean;
  /** "Shared since Fri, Sep 11, 2026 · 7:30 AM", or null. */
  sharingSince: string | null;
  events: ShareEvent[];
  supplyTracking: boolean;
  supplementTracking: boolean;
  /** "3 routines" (while supplement tracking is on). */
  routines: string;
  preferences: Preferences;
  /** The account's appearance, or null: never chosen on the account. */
  appearance: Appearance | null;
  /** This device's own choice (its cookie; System without one), shown while the account has none. */
  deviceAppearance: Appearance;
};

const SUPPLEMENTS_NOTE = "Track supplement routines with reminders and Taken, beside your doses. Turning it off keeps every routine and record.";
const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];

type Picking = "syringe" | "weight" | "appearance" | null;
type TrackingSheet = "vials" | "supplements" | null;

/**
 * R8 Me (design v3), phone and laptop: the profile; Support access (the
 * switch opens R17 to share; stopping asks first) and the sharing history;
 * Tracking (vials and supplements on or off, dose reminders); Preferences
 * (default syringe, weight unit, appearance, stored with the account);
 * Account (the research-use disclaimer, sign out). Only ever the caller's
 * own account, and never an admin's name.
 */
export function MeScreen({ view }: { view: MeView }) {
  return (
    <main className={CYCLES_MAIN}>
      <div className="laptop:grid laptop:grid-cols-12 laptop:items-start laptop:gap-x-8">
        <div className="laptop:col-span-7">
          <Profile view={view} />
          <SupportAccess view={view} />
        </div>
        <div className="laptop:col-span-5 laptop:mt-2">
          <Tracking view={view} />
          <PreferencesGroup view={view} />
          <Account />
          <p className="mx-5 mt-4 text-center font-mono text-[12px] text-ink-3 laptop:mx-0">Alpha PR Labs · research use only · v3.0</p>
        </div>
      </div>
    </main>
  );
}

function Profile({ view }: { view: MeView }) {
  return (
    <header className="flex items-center gap-4 px-5 pt-4 laptop:px-0 laptop:pt-2">
      <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-sunken text-[22px] font-semibold" aria-hidden>
        {view.initials}
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-[26px] leading-[1.15] font-semibold tracking-[-0.02em]">{view.name}</h1>
        <div className="mt-0.5 truncate font-mono text-[13px] text-ink-2" data-testid="me-email">
          {view.email}
        </div>
        <div className="mt-0.5 text-[13px] text-ink-3" data-testid="me-since">
          {view.since}
        </div>
      </div>
    </header>
  );
}

/** R8 "Support access": the switch (on → R17; off → the stop confirmation) and every share and stop since. */
function SupportAccess({ view }: { view: MeView }) {
  const share = useSheetAction(shareWithTeamAction);
  const stop = useSheetAction(stopSharingAction);
  const shareKey = useRequestKey();
  const stopKey = useRequestKey();
  const [sheet, setSheet] = useState<"share" | "stop" | null>(null);
  const labelId = useId();
  const pending = share.pending || stop.pending;

  const allow = () =>
    share.run({ requestKey: shareKey.keyFor({ kind: "share" }) }, () => {
      shareKey.done();
      setSheet(null);
    });
  const stopNow = () =>
    stop.run({ requestKey: stopKey.keyFor({ kind: "stop" }) }, () => {
      stopKey.done();
      setSheet(null);
    });

  return (
    <section aria-labelledby="me-support" className="mt-7">
      <GroupLabel id="me-support" className="laptop:px-0">
        Support access
      </GroupLabel>
      <div className="mx-3 rounded-group border border-line bg-surface px-4 py-3.5 laptop:mx-0" data-testid="support-card" data-sharing={view.sharing}>
        <div className="flex items-center gap-3">
          <span id={labelId} className="min-w-0 flex-1 text-base font-semibold">
            {R8_TITLE}
          </span>
          <Switch checked={view.sharing} disabled={pending} onCheckedChange={(on) => setSheet(on ? "share" : "stop")} aria-labelledby={labelId} />
        </div>
        <p className="mt-2 text-[14px] leading-[1.45] text-ink-2">{R8_COPY}</p>
        {view.sharingSince ? (
          <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-done" data-testid="support-since">
            <Eye className="size-4 shrink-0" aria-hidden />
            {view.sharingSince}
          </p>
        ) : null}
      </div>

      {view.events.length ? (
        <section aria-labelledby="me-sharing-history" className="mt-6">
          <GroupLabel id="me-sharing-history" className="laptop:px-0">
            Sharing history
          </GroupLabel>
          <Group className="mx-3 laptop:mx-0" data-testid="sharing-history">
            {view.events.map((event) => (
              <div key={event.key} className="flex min-h-14 items-center gap-3 px-4 py-2.5" data-testid="share-event" data-kind={event.kind}>
                <span
                  className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", event.kind === "shared" ? "bg-done-tint text-done" : "bg-sunken text-ink-2")}
                  aria-hidden
                >
                  {event.kind === "shared" ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{event.label}</span>
                  <span className="mt-0.5 block font-mono text-[12px] text-ink-3">{event.time}</span>
                </span>
              </div>
            ))}
          </Group>
        </section>
      ) : null}

      <ShareSheet open={sheet === "share"} pending={share.pending} onAllow={allow} onClose={() => setSheet(null)} />
      <StopSheet open={sheet === "stop"} pending={stop.pending} onStop={stopNow} onClose={() => setSheet(null)} />
    </section>
  );
}

/** "At dose time" while this device has reminders on for this account, else "Off" (read on the device). */
function useDeviceReminders(userId: string): string {
  const [value, setValue] = useState("");
  useEffect(() => {
    const read = () => setValue(rememberedReminders(userId) ? "At dose time" : "Off");
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [userId]);
  return value;
}

function SettingRow({
  label,
  value,
  mono = false,
  onClick,
  href,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  onClick?: () => void;
  href?: string;
  testId: string;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1 text-base">{label}</span>
      <span className={cn("shrink-0 text-ink-2", mono ? "font-mono text-[15px] font-medium" : "text-base")} data-testid={`${testId}-value`}>
        {value}
      </span>
      <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
    </>
  );
  const classes = "flex h-14 w-full cursor-pointer items-center gap-2.5 pr-3 pl-4 text-left hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]";
  return href ? (
    <Link href={href} className={classes} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={classes} data-testid={testId}>
      {body}
    </button>
  );
}

/** R8 "Tracking": the vial and supplement switches (moved here from Supplies) and dose reminders. */
function Tracking({ view }: { view: MeView }) {
  const [sheet, setSheet] = useState<TrackingSheet>(null);
  const reminders = useDeviceReminders(view.id);
  return (
    <section aria-labelledby="me-tracking" className="mt-6 laptop:mt-0">
      <GroupLabel id="me-tracking" className="laptop:px-0">
        Tracking
      </GroupLabel>
      <Group className="mx-3 laptop:mx-0">
        <SettingRow label="Vials and supplies" value={view.supplyTracking ? "On" : "Off"} onClick={() => setSheet("vials")} testId="me-supplies" />
        <SettingRow
          label="Supplements"
          value={view.supplementTracking ? view.routines : "Off"}
          onClick={() => setSheet("supplements")}
          testId="me-supplements"
        />
        <SettingRow label="Dose reminders" value={reminders} href="/app/notifications" testId="me-reminders" />
      </Group>
      <TrackingSheet
        open={sheet === "vials"}
        title="Vials and supplies"
        label="Track vials"
        on={view.supplyTracking}
        note={`${SUPPLIES_INTRO} ${NEVER_ADDS}`}
        action={setTrackingAction}
        link={{ href: "/app/supplies", label: "Open Supplies" }}
        onClose={() => setSheet(null)}
      />
      <TrackingSheet
        open={sheet === "supplements"}
        title="Supplements"
        label="Track supplements"
        on={view.supplementTracking}
        note={SUPPLEMENTS_NOTE}
        action={setSupplementTrackingAction}
        link={{ href: "/app/supplements", label: "Open Supplements" }}
        onClose={() => setSheet(null)}
      />
    </section>
  );
}

function TrackingSheet({
  open,
  title,
  label,
  on,
  note,
  action,
  link,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  on: boolean;
  note: string;
  action: (input: { enabled: boolean }) => Promise<{ saved?: boolean; toast?: string; tone?: string; error?: string }>;
  link: { href: string; label: string };
  onClose: () => void;
}) {
  const save = useSheetAction(action);
  const [target, setTarget] = useState(on);
  const checked = save.pending ? target : on;
  const labelId = useId();
  const online = useOnline();
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent size="auto" title={title}>
        <Group>
          <div className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 text-base" id={labelId}>
              {label}
            </span>
            <Switch
              checked={checked}
              disabled={save.pending || !online}
              onCheckedChange={(next) => {
                setTarget(next);
                save.run({ enabled: next });
              }}
              aria-labelledby={labelId}
            />
          </div>
        </Group>
        <p className="mx-2 text-[13px] leading-[19px] text-ink-3">{note}</p>
        {checked ? (
          <Link href={link.href} className={cn(buttonVariants({ variant: "outline", size: "md", block: true }), "mt-1")} onClick={onClose}>
            {link.label}
          </Link>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** R8 "Preferences": each row opens its choices; a pick is saved with the account at once. */
function PreferencesGroup({ view }: { view: MeView }) {
  const save = useSheetAction(savePreferencesAction);
  const request = useRequestKey();
  const [picking, setPicking] = useState<Picking>(null);
  const [shown, setShown] = useState<{ syringe: SyringeCapacity; weight: WeightUnit; appearance: Appearance | null } | null>(null);
  const current = save.pending && shown ? shown : { syringe: view.preferences.defaultSyringe, weight: view.preferences.weightUnit, appearance: view.appearance };

  const pick = (patch: PreferencePatch, next: typeof current) => {
    setShown(next);
    save.run({ requestKey: request.keyFor(patch), patch }, () => {
      request.done();
      // This page at once (and this device's cookie); other devices follow the account on their next load.
      if (patch.appearance) applyAppearance(patch.appearance);
      setPicking(null);
    });
  };

  return (
    <section aria-labelledby="me-preferences" className="mt-6">
      <GroupLabel id="me-preferences" className="laptop:px-0">
        Preferences
      </GroupLabel>
      <Group className="mx-3 laptop:mx-0">
        <SettingRow label="Default syringe" value={SYRINGE_CHOICE_LABEL[current.syringe]} mono onClick={() => setPicking("syringe")} testId="pref-syringe" />
        <SettingRow label="Weight unit" value={WEIGHT_UNIT_LABEL[current.weight]} mono onClick={() => setPicking("weight")} testId="pref-weight" />
        <SettingRow label="Appearance" value={appearanceRowLabel(current.appearance, view.deviceAppearance)} onClick={() => setPicking("appearance")} testId="pref-appearance" />
      </Group>
      <ChoiceSheet<SyringeCapacity>
        open={picking === "syringe"}
        title="Default syringe"
        value={current.syringe}
        choices={SYRINGE_CAPACITIES.map((c) => ({ value: c, label: SYRINGE_CHOICE_LABEL[c], note: `U-100 · ${SYRINGE_CHOICE_NOTE[c]}. A saved mix keeps its own.` }))}
        pending={save.pending}
        onPick={(syringe) => pick({ defaultSyringe: syringe }, { ...current, syringe })}
        onClose={() => setPicking(null)}
        testId="choices-syringe"
      />
      <ChoiceSheet<WeightUnit>
        open={picking === "weight"}
        title="Weight unit"
        value={current.weight}
        choices={WEIGHT_UNITS.map((u) => ({ value: u, label: WEIGHT_UNIT_LABEL[u], note: WEIGHT_UNIT_NOTE[u] }))}
        pending={save.pending}
        onPick={(weight) => pick({ weightUnit: weight }, { ...current, weight })}
        onClose={() => setPicking(null)}
        testId="choices-weight"
      />
      {/* Checked: the account's choice only. Before one, nothing is checked, so any pick (even this device's) is saved. */}
      <ChoiceSheet<Appearance>
        open={picking === "appearance"}
        title="Appearance"
        value={current.appearance}
        choices={APPEARANCES.map((a) => ({ value: a, label: APPEARANCE_LABEL[a], note: APPEARANCE_NOTE[a] }))}
        pending={save.pending}
        onPick={(appearance) => pick({ appearance }, { ...current, appearance })}
        onClose={() => setPicking(null)}
        testId="choices-appearance"
      />
    </section>
  );
}

/** R8 "Account": the research-use disclaimer (read-only) and Sign out. */
function Account() {
  const { pending, signOut } = useSignOut();
  return (
    <Group className="mx-3 mt-6 laptop:mx-0">
      <SettingRow label="Research-use disclaimer" value="" href="/app/me/disclaimer" testId="me-disclaimer" />
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={signOut}
        className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 font-semibold text-missed hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)] disabled:opacity-60"
      >
        <LogOut className="size-[18px]" aria-hidden />
        Sign out
      </button>
    </Group>
  );
}
