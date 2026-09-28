# Components, theming and dark mode

This is the spec for every reusable piece. Token names match `tokens.css` and the Tailwind classes it creates, e.g. `bg-paper`, `text-ink-2`, `border-line`, `bg-signal`, `text-missed`. Hex values in brackets are **light / dark**.

Visual reference: `Alpha Design System.dc.html`. Open it in a browser.

---

## 1. Principles (these decide close calls)

1. **One reading per screen.** Every screen has at most one *Now block*: the only inverted surface. It holds that screen's key number. Everything else is quieter.
2. **Every number carries its scale.** Use graduated rulers and tick bars instead of rings or donuts. Syringe readings always show the syringe size, and cycle progress is one tick per day.
3. **State is a shape and a word, never colour alone.** Each state has its own glyph and a text label (see §4).
4. **Blue is reserved for what you can act on now:** the primary button, the due state, the syringe fill, the today marker and the current-period bar.
5. **Money is ink.** Never green or red, except a negative gross profit: `text-missed` with a minus sign.
6. **Sentence case everywhere.** No all-caps labels and no letter-spaced eyebrow text.

---

## 2. Colour

### Neutrals
| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | #F2F2EE | #0C0D0F | Page background, sheet background, drawer background |
| `surface` | #FFFFFF | #16181B | Grouped rows, cards, inputs, chips |
| `sunken` | #E8E8E3 | #1F2226 | Segmented track, search field, icon wells, skeletons, avatar circles |
| `line` | #DCDCD5 | #2A2D32 | 1 px card borders, row dividers, the day rail, unfilled ticks |
| `ink` | #0D0E10 | #F3F3F0 | Primary text, ink buttons, Now-block background |
| `ink-2` | #464950 | #B4B7BE | Secondary text, units next to numbers |
| `ink-3` | #676B73 | #8C9098 | Tertiary text, meta, placeholders. **Lowest allowed text colour.** |
| `on-ink-2` | #9A9EA6 | #5A5E66 | Secondary text *inside* the Now block |
| `on-ink-soft` | #C9CCD2 | #3A3D42 | Row labels inside the Now block |

### Brand and semantic
| Token | Light | Dark | Use |
|---|---|---|---|
| `signal` | #60A5FA | #60A5FA | Primary button fill, due pill, syringe fill, today marker, current-month bar. Same in both modes. |
| `on-signal` | #0A0B0D | #0A0B0D | Text/icon on `signal`. **Never themed** (8.1:1). |
| `signal-ink` | #1F5FCC | #7DB6FB | Blue text: links, nav-bar actions, "Due now", "Invited" |
| `signal-tint` | #E6EFFD | #13233A | Due row background, "Now" / "In your cycle" tags |
| `done` / `done-tint` | #177A4E / #E7F4EC | #4CC38A / #12261C | Taken, shared-access state, read-only banner |
| `missed` / `missed-tint` | #B93A26 / #FBEDEA | #FF7A61 / #2A1714 | Overdue, missed, validation error, sign out, error state |
| `low` / `low-tint` | #8A5A00 / #FFF4DE | #F0B44C / #2A2110 | Low-stock text and row tint, draft tag, expired invite |
| `low-fill` / `low-empty` | #E9A93A / #E3D6BC | #E9A93A / #4A3F28 | Meter fill and empty cells on a low row |

Contrast: every text pairing is at least 4.5:1. `ink-3` on `paper` is about 4.6:1, so never go lighter.

### Overlays and elevation
There are four surface levels. Nothing else gets a shadow.
| Level | Recipe |
|---|---|
| Flat | `bg-paper`, no border. Section text and lists sit directly on it. |
| Group | `bg-surface border border-line`, no shadow |
| Inverted (Now block) | `bg-ink text-surface`, radius 28 (phone) or 24 (desktop), no border |
| Sheet / drawer | `bg-paper`. Scrim `rgba(0,0,0,.45)` (phone) or `.28` (desktop drawer). Sheet shadow `0 -8px 40px rgba(0,0,0,.18)`, drawer shadow `-12px 0 40px rgba(0,0,0,.18)`. |

The selected segment in a segmented control uses `bg-surface` + `0 1px 3px rgba(0,0,0,.10)`.

---

## 3. Dark mode

- **Default:** follow the OS (`prefers-color-scheme`). Me → Appearance offers System / Light / Dark, which sets `.light` or `.dark` on `<html>`.
- **How it's built:** dark swaps the values of the same tokens (see `tokens.css`). **No component changes its markup or classes between modes.** R1d and R2d in `Researcher Screens.dc.html` were produced purely by swapping values; use them as the acceptance check.
- **The Now block stays inverted in both modes.** Light is an ink block on paper. Dark is a near-white block (#F3F3F0) with dark text (#16181B). Build it as `bg-ink text-surface`, secondary text `text-on-ink-2`. Inside it, tick marks and dividers use `currentColor` at 12–80% opacity (e.g. `rgba(255,255,255,.45)` in light becomes `rgba(22,24,27,.45)` in dark). Implement as `color-mix(in oklab, currentColor 45%, transparent)` so it flips automatically.
- **These stay the same in both modes:** `signal`, `on-signal`, `low-fill`, the scrim, and white text on filled done/missed glyphs.
- **Status bar:** `theme-color` meta = `paper` for each mode. `apple-mobile-web-app-status-bar-style = default`.

---

## 4. State glyphs (24 px, also used at 18–22 px)

| State | Glyph | Word | Colour |
|---|---|---|---|
| Done / taken | Filled circle `done`, white Lucide `check` 14 px | "Taken 7:34 AM" | `done` |
| Due | 2 px ring `signal-ink` with a 10 px filled dot | "Due now" | `signal-ink`, row bg `signal-tint` |
| Upcoming | 1.5 px ring `ink-3`, hollow | Time, or "In 10 h 48 min" | `ink-2` |
| Overdue / missed | 24 px square, radius 7, rotated 45° (a diamond), `missed` fill, white "!" 15/700 | "Not logged · Wed 8:00 PM" | `missed`, row bg `missed-tint` |
| Skipped | 1.5 px **dashed** ring `ink-3` | Value struck through | `ink-3` |
| Low stock | Three stacked 4 px bars: two `low-empty`, bottom one `low-fill` | "Low · 6 doses left" | `low`, row bg `low-tint` |

---

## 5. Typography

Fonts: **Geist** (UI and numbers) and **Geist Mono** (units, times, dates in lists, codes, axis labels). Use `next/font/google`. `font-variant-numeric: tabular-nums` globally. **Minimum size 12 px.**

| Role | Size / line | Weight | Tracking | Where |
|---|---|---|---|---|
| Reading XL | 88–104 / 0.8 | 600 | −0.055em | Next dose on Today (phone 88, desktop 104) |
| Reading L | 72–80 / 0.8–0.85 | 600 | −0.055em | Log sheet units (80), cycle day (80/72), feeling avg (80/72) |
| Display | 52–56 / 1 | 600 | −0.045em | Gross profit ($3,496.73) |
| Reading M | 40–64 / 0.85–1 | 600 | −0.04 to −0.05em | Sheet/drawer summaries (40), builder (64) |
| Title 1 | 34 / 1.1 | 600 | −0.03em | Screen titles ("Today") |
| Title 2 | 28 / 1.15 | 600 | −0.025em | Sheet titles, peptide name in sheet |
| Section | 20 / 1.2 | 600 | −0.015em | "Schedule", "History" |
| Headline | 17 / 22 | 600 | 0 | Card titles, nav-bar title, primary button |
| Body | 16 / 22 | 400–600 | 0 | Row titles (600), inputs |
| Callout | 15 / 20 | 400–600 | 0 | Chips, secondary button, links |
| Footnote | 13 / 18 | 500–600 | 0 | Field labels (600 `ink-2`), sub-lines |
| Caption | 12 / 16 | 400–600 | 0 | Tile context, tab labels, tags |
| Mono data | 13–15 | 500–600 | 0 | Times, "5 units", "10 mg + 2 mL", dates in lists |
| Mono unit | 13–20 | 400 | 0 | Units beside a big number, in `ink-2` / `on-ink-2` |

**Number formatting rules. Implement them in one formatter module and unit-test it:**
- Units: `mg`, `mcg`, `mL`, `units`, lower case, a space before the unit, set in mono. **Never `µg`, never `u`.**
- Always a leading zero (`0.5 mL`). No trailing zeros on doses (`2.5 mg`, not `2.50 mg`). Volume shows the precision it needs (`0.05 mL`).
- Syringe units always name the syringe: "50 units · 100-unit syringe".
- Units are **never rounded to a line.** The ruler shows where the value falls. If it falls between lines, show the info note (see §7.8).
- Money: `$3,925.00` with two decimals; a `CAD` suffix in mono on hero numbers; `US$ 9.20` for USD. Negative: `− $40.14`, with the true minus sign U+2212.
- Times follow the device locale; the mocks use 12 h (`7:30 AM`). Dates: `Thu, Sep 24` (lists), `Sep 24` (compact), `Sep 1 – Nov 23` (ranges, spaced en dash).

---

## 6. Space, radius, layout

- Base unit 4. Scale: 4, 8, 12, 16, 20, 24, 28, 32, 56.
- **Phone:** blocks (cards, Now block, groups) have a 12 px side margin. Text blocks (titles, section headers, bare lists) have 20 px. Gap between stacked blocks: 12. Before a section header: 28. Header to first block: 16–18.
- **Desktop:** sidebar 232 px, main padding `28px 36px` (`24px 36px` on dense screens), 12-column grid with a 16 px gap. Drawers are 420 px wide.
- **Radius:** tag 6–8 · chip/input 12–14 · button 16 (44 px buttons: 12) · group/card 20 · tile 20 · Now block 28 (desktop 24) · sheet top 28 · pills 99.
- **Hit targets:** 44 px minimum. Primary action 56 px (desktop 48 in drawers, 40 in page headers).
- **Safe areas:** status bar 54 px (`env(safe-area-inset-top)`), home indicator 34 px (`env(safe-area-inset-bottom)`). The tab bar is 54 px plus the bottom inset.

---

## 7. Components

Each maps to a shadcn/ui (Base UI) primitive where one exists.

### 7.1 Button (`Button`)
| Variant | Fill | Text | Border | Use |
|---|---|---|---|---|
| `primary` | `signal` | `on-signal` 17/600 | none | Actions that **record** something: Taken, Save check-in, Record sale, Allow access |
| `ink` | `ink` | `surface` 16–17/600 | none | Navigation and progression: Continue, Build a cycle, Invite, Save template |
| `outline` | `surface` | `ink` 16/600 | 1 px `line` | The alternative: Skip, Back, Record purchase (when paired) |
| `soft` | `sunken` | `ink` 15/600 | none | Small inline: Log, stepper ±, close buttons |
| `ghost` | transparent | `signal-ink` 15/600 | none | See all, Override, nav-bar actions |
| `ghost-on-ink` | `rgba(currentColor,.12)` | `surface` | none | Secondary action inside the Now block ("Details") |
| `destructive-text` | `surface` | `missed` 16/600 | 1 px `line` | Sign out |

Sizes: L 56 (radius 16) · M 44 (radius 12) · S 36–40 (radius 10). Icon + label gap 6–8, icon 18–20 px. Disabled: opacity .4. Loading: the label becomes "Saving…" and the button is disabled. Pressed: `scale(.98)` over 120 ms.

### 7.2 Input / field (`Input`, `Textarea`)
- Label above: 13/600 `ink-2`, 6 px gap. Optional fields append "· optional" (or a right-aligned 13 `ink-3` "Optional").
- Field: height 52 (compact 44–48), radius 14 (12), `bg-surface`, 1 px `line`, padding 0 14. Text 16. Mono for emails and dates.
- **Focus:** 2 px `ink` border, and the caret in `signal`.
- **Error:** 2 px `missed` border. Message below, 13/500 `missed` with an `info` icon 15 px, `role="alert"`.
- **Number with unit:** the value is 24–28/600 on the left; the unit is either mono text or an inline unit toggle (mini segmented, e.g. `mcg | mg`).
- **Read-only:** `bg-sunken`, text `ink-2`, no border.

### 7.3 Segmented control (`ToggleGroup`, single)
Track `sunken`, radius 12, padding 3, height 44 (desktop 40, mini 32). The selected segment is `surface` with radius 9, the seg shadow, and 600 weight. Unselected segments are `ink-2` at weight 400–500. Mono labels for numbers (`100 | 50 | 30`).

### 7.4 Chip (`ToggleGroup`, multiple, or single for site)
Height 44, padding 0 14, radius 12, text 15.
- Unselected: `surface` + 1 px `line`.
- Selected: `ink` fill, `surface` text, 600.
- Multi-select chips (unwanted effects) also show a 15 px check icon. **Single-select injection-site chips have no check**; fill and weight carry the state.
- "Last used" site: 1 px **dashed** `ink-3` border.
- Add chip: transparent, dashed border, plus icon.

### 7.5 List row / group
- **Group:** `surface`, 1 px `line`, radius 20, overflow hidden. Rows are divided by 1 px `line`.
- **Row:** min height 56 (settings) to 64 (content), padding 12–14 × 16. Title 16/600, sub-line 13 `ink-2` or mono 12 `ink-3`. Right side is a value (`ink-2`), a count (20–22/600) or a chevron (18 px `ink-3`).
- **Status rows (overdue, low)** are standalone rounded rows (radius 18) on a tint, with a glyph, title and status line, plus a 44 px action.
- **Group label** above: 13/600 `ink-2`, 20 px side margin, 8 px gap.

### 7.6 Day rail (Today schedule)
Grid `64px 24px 1fr`, gap 12, min row height 64 (desktop 56).
- Time column: mono 13 `ink-3`, 14 px top padding.
- Rail: a 2 px `line` vertical line centred in the 24 px column, starting below the first glyph and ending at the last.
- Glyph from §4, sitting on the rail.
- Content: title 16/600 with the dose in `ink-2` 400, units in mono. Status line 13.
- The due row gets a `signal-tint` background, radius 14, bleeding 10 px left and right.
- Supplements show a `pill` icon 14 px + "Supplement".

### 7.7 Now block
`bg-ink text-surface`, radius 28, padding `18px 20px 16px`, 12 px side margin. Contents from top:
1. Status pill (`signal` fill, `on-signal` text 13/600, height 26, 6 px dot), a mono time and right-aligned context, all in `on-ink-2`.
2. Title 22/600 and sub-line 14 `on-ink-2`.
3. The reading (§5), with its unit in mono `on-ink-2`, and a right-aligned secondary reading (mono 17/600 plus a 13 caption).
4. Its scale (§7.8).
5. Actions: primary + `ghost-on-ink`.

### 7.8 Graduated gauges
- **Syringe ruler** (height 56). Barrel: a 14 px bar, radius 5, `sunken` (or 14% currentColor inside the Now block), filled left to `value / capacity` with `signal`. Ticks below the barrel:
  - 100-unit syringe: minor tick every 2 units (1 px × 7 px), major every 10 units (1.5 px × 13 px), labels at every 10.
  - 50-unit syringe: minor every 1 unit, major every 5, labels every 10.
  - 30-unit syringe: minor every 0.5, mid every 1 (1 px × 9 px), major every 5, labels every 5.
  - Value marker: a 2 px × 37 px vertical line in `ink` at the value.
  - Labels: mono 12 `ink-3`, centred on their tick. The label at the value is 600 `ink`.
  - Implementation: SVG, or two `repeating-linear-gradient` layers. Include the closing tick at capacity.
  - **Warnings:**
    - Between lines: info note "On a 100-unit syringe, 5 units falls between the 4 and 6 lines."
    - Over capacity: `missed` note, and the barrel shows full with a hatched overflow.
- **Cycle ticks:** one 2–3 px tick per day, gap from `width / days`. Past days `ink` (inside the Now block: `surface`); future days `line` (inside the Now block: 22% currentColor). Today marker: 3 px `signal` bar extending 5–6 px above and below. Labels mono 12.
- **Phase lane:** a flex row with a 2–3 px gap. Active phase = solid `ink` bar (radius 3–8). Bar height scales with dose: higher dose = taller (e.g. 16 vs 8 px), bottom-aligned. Break = 1 px `ink-3` border + `repeating-linear-gradient(135deg, ink-3 0 1px, transparent 1px 5px)`. Desktop lanes are 34 px tall with the dose label inside the bar (13/600 `surface`).
- **Level meter (vial / stock):** a 10 px bar, radius 5, `sunken`. Fill `ink`, or `low-fill` when low. White 2 px separators every 10% (graduations). Desktop tables use a 6 px bar with no separators.
- **Feeling scale:** 5 equal buttons, height 58–64, radius 14. Number 18–20/600 and label 12 `ink-2` (Rough, Low, OK, Good, Great). Selected: `ink` fill.
- **Mini feeling bars (history):** five 8 × 14 px cells, filled `ink` up to the value, the rest `line`.

### 7.9 Charts (SVG, `vector-effect: non-scaling-stroke` when stretched)
- **Trend line:** 2–2.5 px stroke, round joins. Last point: a 4.5–5 px `signal` dot with a 2 px background-coloured ring. Gridlines 1 px dashed (2 4) `line` (or 14% currentColor on ink). The pre-cycle baseline region is hatched (45° pattern, 16% currentColor) or `paper`-filled on light cards.
- **Dose tracks** sit directly under any trend on the same x-axis. One lane per peptide: a mono 12 label, then 1.5–3 px ticks at each logged dose. A due-but-not-taken dose is a hollow tick with a `signal` border.
- **Bars:** radius 4 on top, 5–10 px gap, 1 px `ink` baseline. A zero value shows as a 2 px `line` stub. The highlighted bar (today, current month) is `signal`.
- **Stacked month bar:** the cost segment on top (hatched, 1 px `ink-3` border), gross profit below (`ink`). The current, partial month has a 1.5 px dashed outline, offset 2.
- **Purchases bars:** outlined (1.5 px `ink`, `surface` fill). The partial month is dashed.
- **Split bar (gross profit):** 14 px tall, 3 px gap. Profit portion `signal`, cost portion hatched with a 1 px border. The legend rows below repeat each swatch.

### 7.10 Stat tile
`surface` + `line`, radius 20, padding 14–16. Label 13/500 `ink-2` → reading 24–34/600 (unit in mono 14–15 `ink-2`) → context 12–13 `ink-3`. Changes are shown with an `arrow-up-right` / `arrow-down-right` icon plus words ("Down 2.3 kg since Sep 1"), never with red or green.

### 7.11 Bottom sheet (`Drawer` / vaul) — phone
- Top at 62 px from the screen top for full sheets (R2, R6), or content-height (R17). Radius 28 on top, `bg-paper`, scrim .45.
- The page behind peeks as a 30 px rounded strip at 28% paper. On iOS-style implementations the page scales to .94.
- Grabber 36 × 5, radius 3, `line`, 8 px from the top.
- Header: a mono 13 context line (coloured by state), then a 28/600 title. Close button 44 px round `sunken` with a 18 px `x` icon.
- Scrollable body, padding 14 × 12, 12 px gaps.
- Pinned footer: padding `12px 16px 34px`, top border `line`. Layout is either a 104–128 px outline button plus a primary button, or a single full-width primary.
- Motion: 320 ms `cubic-bezier(.2,.8,.2,1)` up, 240 ms down. Drag to dismiss.

### 7.12 Drawer — desktop
420 px wide, anchored right, full height of the main area, `bg-paper`, drawer shadow, scrim .28 over the main area only (the sidebar stays usable). Header: title 24/600 and a 40 px close button. Footer: Cancel (outline, 100 px) + primary. It opens where a phone sheet would.

### 7.13 Tab bar (phone) — see `Tab Bar.dc.html`
- Solid `paper`, 1 px `line` top border, 5 equal columns, 54 px tall plus the bottom inset.
- Each item: Lucide icon 22 px over a 12 px label, 4 px gap.
- Active: `ink`, label 600, plus a 28 × 2 px `ink` bar on the top edge. Inactive: `ink-3`, 500.
- Researcher: Today · Cycles · Progress · Library · Me. Admin: Today · Cycles · Progress · **Business** · Me. For admins, Library moves into Business → Library.
- Not floating, not translucent.

### 7.14 Sidebar (desktop, ≥ 760 px)
- 232 px wide, 1 px `line` right border, padding `20px 14px`.
- Logo 30 px (radius 8) + "Alpha Research" 15/600.
- Group labels 12/600 `ink-3` ("Research", "Business").
- Items are 40 px tall, radius 10, padding 0 10, 18 px icon plus a 15 px label.
  - Active: `surface` + 1 px `line`, 600.
  - Inactive: `ink-2`.
  - Right-aligned mono 12 counters: overdue count in `missed`, "3 low" in `low`.
- Researcher items: Today, Cycles, Progress, Library, Supplies.
- Admin items: Today, Cycles, Progress, Overview, Stock, Ledger, Library, People.
- User at the bottom: a 32 px avatar with name 14/600 and role 12 `ink-3`.

### 7.15 Toast (`Sonner`)
- `ink` pill, radius 16, padding `12px 8px 12px 14px`, placed 12 px above the tab bar (desktop: bottom-right).
- Contents: a 22 px glyph (done circle or missed square), text 14 `surface`, and one 44 px `ghost` action in `signal-ink` (light: #7DB6FB on ink).
- Success: "TB-500 · 2.5 mg logged at 9:12 AM" · **Undo**, auto-dismisses at 4 s.
- Error: "Couldn't save. Your entry is still here." · **Retry**. Stays until dismissed.

### 7.16 Empty / loading / error
- **Empty:** a 1.5 px dashed `ink-3` block, radius 28. It shows a zero reading (64/600 `ink-3` + mono unit), a title 22/600, one sentence 15 `ink-2`, and one or two actions. No illustration.
- **Loading:** skeletons in `sunken` with inner pieces in `line`, at the exact size and position of the real Now block and rows. Slow pulse (opacity .6 ↔ 1, 1.6 s). `aria-busy="true"` on the container. The header (date, title) renders immediately.
- **Error:** a `missed-tint` block, radius 28, `role="alert"`. It has a 44 px `surface` icon well with a `missed` icon, a title 22/600, a sentence saying what's safe, a full-width `ink` Try again button with `refresh-cw`, and a mono "Last loaded" time. **Don't show stale numbers** on Today (doses) or Stock (counts).

### 7.17 Toggle (`Switch`)
51 × 31, 27 px knob. On: `ink` track, knob right. Off: `sunken` track with a 1 px `line` border, knob left with the shadow `0 1px 3px rgba(0,0,0,.2)`. **Always put the word "On" / "Off" in 13 `ink-2` to the left of the switch.**

### 7.18 Checkbox
26 × 26, radius 8. Checked: `ink` fill with a white check 16 px. Unchecked: 1.5 px `ink-3` border.

### 7.19 Tags
Height about 22, padding 2–3 × 6–7, radius 6, 12/600.
- Now / In your cycle: `signal-tint` + `signal-ink`
- Low / Draft: `low-tint` + `low`
- Researcher / role: `sunken` + `ink-2`
- Not offered: `surface` + 1 px `line` + `ink-2`

---

## 8. Iconography
**Lucide** (`lucide-react`, which ships with shadcn/ui), 2 px stroke. Sizes: tab bar 22 · sidebar 18 · inline 14–20 · close 16–18. Icons always sit beside a word, except close, back chevron, add (+) and clear, which need an `aria-label`.

Names used: sun, calendar, activity, book-open, briefcase, user, syringe, flask-conical, pill, package, clock, shield, check, x, plus, minus, chevron-left, chevron-right, chevron-down, chevron-up, search, pencil, info, layers, arrow-up-right, arrow-down-right, refresh-cw, wifi-off, log-out, bell, share, square-plus, eye, lock, receipt, users.

The mocks load these from unpkg as CSS masks. In production, import from `lucide-react`.

---

## 9. Motion
- Screen push: 280 ms `cubic-bezier(.2,.8,.2,1)`, translate 24 px, fading in from 0.
- Taken: the button's check draws in (160 ms), then the Now block content cross-fades to the next dose (240 ms), and the rail glyph fills to done. Show the Undo toast.
- The syringe fill animates width over 300 ms when dose or syringe changes.
- Respect `prefers-reduced-motion`: switch to fades only.
