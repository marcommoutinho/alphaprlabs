"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { Appearance } from "@/lib/alpha/appearance";
import type { SyringeCapacity } from "@/lib/calculator/calculator";
import { applyAppearance } from "../appearance";
import { Button } from "../button";
import { AddChip, ChipGroup } from "../chip";
import { Checkbox, Field, NumberInput, Switch, TextArea, TextInput } from "../field";
import { LevelMeter, SyringeRuler, TickBar } from "../gauges";
import { Group, GroupLabel, Row, StatusRow } from "../list";
import { NowActions, NowBlock, NowHeader, NowReading } from "../now-block";
import { Segmented } from "../segmented";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "../sheet";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { StatTile } from "../stat-tile";
import { StateGlyph, type GlyphState } from "../state-glyph";
import { Pill, Tag } from "../tag";
import { useAlphaToast } from "../toast";

const SYRINGES = [
  { value: "100", label: "100" },
  { value: "50", label: "50" },
  { value: "30", label: "30" },
] as const;

const SITES = ["Abdomen L", "Abdomen R", "Thigh L", "Thigh R", "Delt L", "Delt R", "Glute L", "Glute R"];
const EFFECTS = ["None", "Site redness", "Nausea", "Headache", "Fatigue"];

/**
 * Every V0 component, drawn in light and dark side by side (each pane pins
 * its mode with data-alpha-theme). Sheets, drawers and toasts open over the
 * page, so they follow the page's appearance: switch it at the top.
 */
export function DesignGallery({ appearance }: { appearance: Appearance }) {
  const [pageAppearance, setPageAppearance] = useState<Appearance>(appearance);
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-3 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-9 laptop:pt-7 laptop:pb-16">
      <header className="flex flex-wrap items-end gap-4 px-2 laptop:px-0">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px] font-medium text-ink-3">Design v3 · V0 foundation</div>
          <h1 className="mt-0.5 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">Components</h1>
          <p className="mt-2 max-w-[640px] text-[15px] text-ink-2">
            Each component in light and dark. Sheets, drawers and toasts open over the page and follow its appearance.
          </p>
        </div>
        <div className="flex w-full flex-col gap-1.5 laptop:w-[320px]">
          <span id="page-appearance" className="text-[13px] font-semibold text-ink-2">
            Page appearance
          </span>
          <Segmented<Appearance>
            aria-labelledby="page-appearance"
            value={pageAppearance}
            onValueChange={(next) => {
              setPageAppearance(next);
              applyAppearance(next);
            }}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
      </header>
      <OverlayDemos />
      <div className="grid gap-4 laptop:grid-cols-2">
        <Pane theme="light" />
        <Pane theme="dark" />
      </div>
    </div>
  );
}

function Pane({ theme }: { theme: "light" | "dark" }) {
  return (
    <section
      data-alpha-theme={theme}
      aria-label={theme === "light" ? "Light" : "Dark"}
      className="flex min-w-0 flex-col gap-7 rounded-[28px] border border-line p-3 pb-6 laptop:p-5"
    >
      <div className="px-2 font-mono text-[13px] font-medium text-ink-3">{theme === "light" ? "Light · default" : "Dark"}</div>
      <Showcase />
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="px-2 text-[20px] leading-[1.2] font-semibold tracking-[-0.015em]">{title}</h2>
      {children}
    </div>
  );
}

function Showcase() {
  const [syringe, setSyringe] = useState<"100" | "50" | "30">("100");
  const [unit, setUnit] = useState<"mcg" | "mg">("mcg");
  const [site, setSite] = useState<string[]>(["Abdomen R"]);
  const [effects, setEffects] = useState<string[]>(["Site redness", "Fatigue"]);
  const [shared, setShared] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [period, setPeriod] = useState("30");

  return (
    <>
      <Section title="Now block">
        <NowBlock aria-label="Next dose">
          <NowHeader pill={<Pill>Due now</Pill>} time="9:00 AM" context="Recovery protocol" />
          <div className="mt-3.5 text-[22px] font-semibold">TB-500</div>
          <div className="text-[14px] text-on-ink-2">2.5 mg · Mon and Thu</div>
          <NowReading className="mt-4" value="50" unit="units" secondary="0.5 mL" caption="100-unit syringe" />
          <SyringeRuler className="mt-4" units="50" capacity={100} onInk />
          <NowActions>
            <Button>
              <Check aria-hidden />
              Taken
            </Button>
            <Button variant="ghost-on-ink">Details</Button>
          </NowActions>
        </NowBlock>
        <NowBlock aria-label="Cycle day">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[13px] text-on-ink-2">Day</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[80px] leading-[0.85] font-semibold tracking-[-0.055em]">24</span>
                <span className="font-mono text-[19px] text-on-ink-2">of 84</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[17px] font-semibold">60 days left</div>
              <div className="text-[13px] text-on-ink-2">Ends Mon, Nov 23</div>
            </div>
          </div>
          <TickBar className="mt-5" days={84} today={24} onInk labels={["Sep 1", "Today", "Nov 1", "Nov 23"]} />
        </NowBlock>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-col gap-2.5">
          <Button block>
            <Check aria-hidden />
            Taken
          </Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="ink">Continue</Button>
            <Button variant="outline">Skip</Button>
            <Button variant="soft" size="md">
              Log
            </Button>
            <Button variant="ghost" size="md">
              See all
            </Button>
            <Button variant="destructive-text" size="md">
              Sign out
            </Button>
            <Button size="md" saving>
              Record sale
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Segmented controls">
        <Segmented
          aria-label="Time taken"
          value="now"
          onValueChange={() => {}}
          options={[
            { value: "now", label: "Now · 9:12 AM" },
            { value: "earlier", label: "Earlier…" },
          ]}
        />
        <Segmented aria-label="Period" size="sm" value={period} onValueChange={setPeriod} options={[
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
          { value: "cycle", label: "Cycle" },
        ]} />
      </Section>

      <Section title="Syringe ruler">
        <div className="flex flex-col gap-4 rounded-[24px] bg-surface px-[18px] pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-ink-2">Draw</span>
            <Segmented
              aria-label="Syringe"
              size="mini"
              mono
              className="w-[156px]"
              value={syringe}
              onValueChange={setSyringe}
              options={SYRINGES}
            />
          </div>
          <div className="flex items-end justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-[80px] leading-[0.8] font-semibold tracking-[-0.055em]">5</span>
              <span className="font-mono text-[19px] text-ink-2">units</span>
            </div>
            <div className="text-right font-mono text-[15px]">
              <div className="font-semibold">0.05 mL</div>
              <div className="text-ink-3">of {Number(syringe) / 100} mL</div>
            </div>
          </div>
          <SyringeRuler units="5" capacity={Number(syringe) as SyringeCapacity} />
        </div>
        <SyringeRuler units="12.5" capacity={50} />
        <SyringeRuler units="120" capacity={100} />
      </Section>

      <Section title="Tick bar and meters">
        <TickBar days={84} today={24} labels={["Sep 1", "Today", "Nov 23"]} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <LevelMeter value={0.15} low label="BPC-157 vial remaining" />
            <div className="mt-2 text-[13px] font-semibold text-low">Low · 1.5 of 10 mg</div>
          </div>
          <div>
            <LevelMeter value={0.5} label="TB-500 vial remaining" />
            <div className="mt-2 text-[13px] text-ink-2">5 mg left</div>
          </div>
        </div>
        <LevelMeter value={0.4} variant="table" label="Stock level" />
      </Section>

      <Section title="State glyphs">
        <Group>
          {(
            [
              ["done", "Taken 7:34 AM"],
              ["due", "Due now"],
              ["upcoming", "In 10 h 48 min"],
              ["overdue", "Not logged · Wed 8:00 PM"],
              ["skipped", "Skipped"],
              ["low", "Low · 6 doses left"],
            ] as [GlyphState, string][]
          ).map(([state, word]) => (
            <Row key={state} density="settings" leading={<StateGlyph state={state} />} title={word} />
          ))}
        </Group>
      </Section>

      <Section title="List rows and status rows">
        <StatusRow
          tone="overdue"
          title={
            <>
              BPC-157 <span className="font-normal text-ink-2">· 250 mcg</span>
            </>
          }
          status="Not logged · Wed 8:00 PM"
          action={
            <Button variant="outline" size="md">
              Log
            </Button>
          }
        />
        <StatusRow tone="low" title="BPC-157 · 10 mg vial" status="Low · 1.5 mg left, 6 doses, about 3 days" href="#" />
        <div>
          <GroupLabel>Tracking</GroupLabel>
          <Group>
            <Row density="settings" title="Vials and supplies" value="On" chevron onClick={() => {}} />
            <Row density="settings" title="Supplements" value="3 routines" chevron onClick={() => {}} />
            <Row title="Recovery protocol" meta="Sep 1 – Nov 23 · BPC-157, TB-500" count="96%" chevron onClick={() => {}} />
          </Group>
        </div>
      </Section>

      <Section title="Tiles">
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile label="Adherence" value="96" unit="%" context="51 of 53 doses" />
          <StatTile label="Weight" value="81.4" unit="kg" context="2.3 kg since Sep 1" change="down" />
          <StatTile label="Missed" value="1" tone="missed" context="Wed 8 PM" />
          <StatTile label="Stock value" value="$7,656.31" context="655 vials at cost" />
        </div>
      </Section>

      <Section title="Chips and tags">
        <ChipGroup
          aria-label="Injection site"
          className="grid grid-cols-4"
          value={site}
          onValueChange={(next) => setSite(next.length ? next : site)}
          options={SITES.map((name) => ({ value: name, label: name, lastUsed: name === "Thigh R" }))}
        />
        <div className="flex flex-wrap gap-2">
          <ChipGroup
            aria-label="Unwanted effects"
            multiple
            value={effects}
            onValueChange={setEffects}
            options={EFFECTS.map((name) => ({ value: name, label: name }))}
          />
          <AddChip>Other</AddChip>
        </div>
        <div className="flex flex-wrap gap-2 px-1">
          <Tag tone="now">Now</Tag>
          <Tag tone="now">In your cycle</Tag>
          <Tag tone="low">Low</Tag>
          <Tag tone="low">Draft</Tag>
          <Tag tone="role">Researcher</Tag>
          <Tag tone="outline">Not offered</Tag>
          <Tag tone="role" mono>
            10 mg vial
          </Tag>
        </div>
      </Section>

      <Section title="Fields">
        <Field label="Buyer">
          <TextInput defaultValue="Jordan Reyes" />
        </Field>
        <Field label="Dose">
          <NumberInput
            defaultValue="250"
            aria-label="Dose"
            unit={
              <Segmented
                aria-label="Dose unit"
                size="mini"
                mono
                className="w-[112px]"
                value={unit}
                onValueChange={setUnit}
                options={[
                  { value: "mcg", label: "mcg" },
                  { value: "mg", label: "mg" },
                ]}
              />
            }
          />
        </Field>
        <Field label="BAC water" optional>
          <NumberInput defaultValue="2" unit="mL" />
        </Field>
        <Field label="Price per vial" error="Enter a price of $0.00 or more.">
          <TextInput defaultValue="" placeholder="$ —" />
        </Field>
        <Field label="Email" description="From your invitation">
          <TextInput defaultValue="jordan@example.com" readOnly mono />
        </Field>
        <Field label="Note" optional>
          <TextArea placeholder="Add a note" />
        </Field>
      </Section>

      <Section title="Switch and checkbox">
        <Group>
          <Row
            density="settings"
            title="Let admins view my history"
            trailing={<Switch aria-label="Let admins view my history" checked={shared} onCheckedChange={setShared} />}
          />
          <Row
            density="settings"
            title="Dose reminders"
            trailing={<Switch aria-label="Dose reminders" checked onCheckedChange={() => {}} />}
          />
        </Group>
        <label className="flex items-center gap-3 px-2 text-[15px]">
          <Checkbox aria-label="I've read this" checked={agreed} onCheckedChange={setAgreed} />
          I&apos;ve read this and I&apos;m using the app as a researcher.
        </label>
      </Section>

      <Section title="Skeleton">
        <SkeletonRegion label="Loading today" className="flex flex-col gap-3">
          <Skeleton className="h-1.5 rounded-[3px]" />
          <Skeleton className="flex h-[300px] flex-col gap-3 rounded-now p-5">
            <Skeleton inner className="h-[26px] w-28 rounded-full" />
            <Skeleton inner className="h-6 w-40" />
            <Skeleton inner className="mt-4 h-20 w-44" />
            <Skeleton inner className="mt-auto h-14 w-full rounded-btn" />
          </Skeleton>
          <Skeleton className="h-16 rounded-[18px]" />
        </SkeletonRegion>
      </Section>
    </>
  );
}

function OverlayDemos() {
  const toast = useAlphaToast();
  const [syringe, setSyringe] = useState<"100" | "50" | "30">("30");
  return (
    <section aria-label="Sheets and toasts" className="flex flex-wrap gap-2 px-2 laptop:px-0">
      <Sheet>
        <SheetTrigger render={<Button variant="ink" size="md" />}>Open a sheet</SheetTrigger>
        <SheetContent
          context="Due 9:00 AM · Thu"
          contextTone="signal"
          title="BPC-157"
          footer={
            <>
              <SheetClose render={<Button variant="outline" className="w-[104px]" />}>Skip</SheetClose>
              <SheetClose render={<Button />}>Taken · 250 mcg</SheetClose>
            </>
          }
        >
          <div className="flex flex-col gap-4 rounded-[24px] bg-surface px-[18px] pt-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-ink-2">Draw</span>
              <Segmented
                aria-label="Syringe"
                size="mini"
                mono
                className="w-[156px]"
                value={syringe}
                onValueChange={setSyringe}
                options={SYRINGES}
              />
            </div>
            <SyringeRuler units="5" capacity={Number(syringe) as SyringeCapacity} />
          </div>
          <Field label="Note" optional>
            <TextInput compact placeholder="Add a note" />
          </Field>
        </SheetContent>
      </Sheet>
      <Button
        variant="outline"
        size="md"
        onClick={() =>
          toast.success({
            message: "TB-500 · 2.5 mg logged at 9:12 AM",
            action: { label: "Undo", onAction: () => toast.success({ message: "Undone. TB-500 is due again." }) },
          })
        }
      >
        Success toast
      </Button>
      <Button
        variant="outline"
        size="md"
        onClick={() =>
          toast.error({ message: "Couldn't save. Your entry is still here.", action: { label: "Retry", onAction: () => {} } })
        }
      >
        Error toast
      </Button>
    </section>
  );
}
