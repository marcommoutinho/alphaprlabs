"use client";

import { useState } from "react";
import { savePreferencesAction } from "@/app/(private)/app/me/actions";
import { Group } from "@/components/alpha/list";
import { ChoiceSheet } from "@/components/research/me/me-sheets";
import { SettingRow } from "@/components/research/me/setting-row";
import { useRequestKey, useSheetAction } from "@/components/research/supplies/supplies-shared";
import { HEADS_UP_CHOICES, type HeadsUpMinutes, type PreferencePatch } from "@/lib/preferences/rules";
import { HEADS_UP_OPTION_LABEL, SETTING_HINT, SETTING_LABEL } from "@/lib/reminders/copy";

/**
 * Me › Dose reminders: the Advance heads-up (S13; Marco, 2026-09-30), a
 * setting of the account (every device), saved like Me's preferences
 * (savePreferencesAction) from a choice sheet in their style: Off, or 15
 * (the default), 30 or 60 minutes before each dose time.
 */
export function HeadsUpSetting({ minutes }: { minutes: HeadsUpMinutes }) {
  const save = useSheetAction(savePreferencesAction);
  const request = useRequestKey();
  const [picking, setPicking] = useState(false);
  const [shown, setShown] = useState<HeadsUpMinutes | null>(null);
  const current = save.pending && shown !== null ? shown : minutes;

  const pick = (headsUpMinutes: HeadsUpMinutes) => {
    const patch: PreferencePatch = { headsUpMinutes };
    setShown(headsUpMinutes);
    save.run({ requestKey: request.keyFor(patch), patch }, () => {
      request.done();
      setPicking(false);
    });
  };

  return (
    <section aria-label={SETTING_LABEL} className="mt-6">
      <Group className="mx-3 laptop:mx-0">
        <SettingRow label={SETTING_LABEL} value={HEADS_UP_OPTION_LABEL[current]} onClick={() => setPicking(true)} testId="heads-up" />
      </Group>
      <p className="mx-5 mt-2 text-[13px] leading-[18px] text-ink-2 laptop:mx-0" data-testid="heads-up-hint">
        {SETTING_HINT}
      </p>
      <ChoiceSheet<HeadsUpMinutes>
        open={picking}
        title={SETTING_LABEL}
        value={current}
        choices={HEADS_UP_CHOICES.map((value) => ({ value, label: HEADS_UP_OPTION_LABEL[value] }))}
        pending={save.pending}
        onPick={pick}
        onClose={() => setPicking(false)}
        testId="choices-heads-up"
      />
    </section>
  );
}
