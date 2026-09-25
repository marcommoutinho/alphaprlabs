# Handoff: Alpha PR Labs — Researcher & Admin App

## Overview
Invite-only web app (installable PWA) for Alpha PR Labs. Two roles:

- **Researcher** — plans peptide research cycles, records actual administrations, uses a reconstitution calculator, logs check-ins/measurements, optionally tracks personal supplies and supplement routines, and can grant the admin read-only support access.
- **Admin (Marco)** — the business back office: invites researchers, maintains the peptide library and cycle templates, records business inventory (purchases, sales) with FIFO cost and gross profit, and views a researcher's history only when that researcher has granted access.

**Build order: admin side first (A1–A8).** Researcher screens (C1–C2, R1–R11) follow. Both are specified here because admin data (library, templates, invitations, grants) feeds the researcher side.

## About the Design Files
The files in this bundle are **design references built in HTML** — a working prototype showing intended look, copy and behavior. They are **not production code to copy**. Recreate the designs in the target codebase's stack using its established patterns. If no codebase exists yet, a reasonable default is React + TypeScript (Next.js or Vite), a relational DB (Postgres), server-side auth with email invitations, and Web Push for reminders.

The prototype stores everything in `localStorage` and simulates network latency (650 ms), failures, push permission and time. None of that is production behavior.

**Open the prototype:** serve the folder (`npx serve .`) and open `Alpha PR Labs App.dc.html`. The grey **PROTOTYPE** bar at the top is test chrome only (role switch, clock +1 h/+1 day, simulated phone notification, expire session, scenario guide, reset). Do not build it.

## Fidelity
**High-fidelity.** Final colors, type, spacing, copy and interactions. Recreate pixel-accurately. All copy in the prototype is final **except** bracketed library text such as `[Supplied peptide information placeholder…]` — that is admin-entered content.

---

## Design Tokens

### Colors
| Token | Value | Use |
|---|---|---|
| bg | `#050505` | App background |
| surface | `#111111` | Cards, inputs, panels |
| surface-menu | `#141414` | Dropdown menu |
| surface-accent | `#0d1626` | Highlighted card (due dose), avatar |
| text | `#FFFFFF` | Primary text |
| text-2 | `rgba(255,255,255,.75)` | Menu items |
| text-3 | `rgba(255,255,255,.6)` | Secondary text, inactive nav |
| text-4 | `rgba(255,255,255,.55)` | Labels, metadata — **minimum for any text** |
| placeholder | `rgba(255,255,255,.4)` | Input placeholder only |
| border | `rgba(255,255,255,.08)` | Card borders, dividers |
| border-input | `rgba(255,255,255,.12)` | Inputs |
| border-strong | `rgba(255,255,255,.15)` | Secondary buttons |
| divider-row | `rgba(255,255,255,.06)` | List row separators |
| primary | `#60A5FA` | Primary buttons, active indicator, focus ring, checkbox accent |
| primary-strong | `#3B82F6` | Timeline bars |
| primary-text | `#93C5FD` | Accent text (links, "Due", labels) |
| primary-soft | `#BFDBFE` | Info toast text, avatar initials |
| on-primary | `#050505` | Text on primary buttons |
| warning | `#FBBF24` | Unconfirmed, zero stock, not offered |
| warning-soft | `#FDE68A` | Warn toast text, side effects |
| error | `#F87171` | Inline errors |
| error-soft | `#FECACA` | Error toast/box text |
| success | `#4ADE80` | "Access granted" |

Toasts: info bg `#0d1626` / border `rgba(96,165,250,.4)`; warn bg `#1a1408` / border `rgba(251,191,36,.4)`; error bg `#2a0f0f` / border `rgba(248,113,113,.4)`.

### Typography
Font: **Inter** 400/500/600/700 (Google Fonts), fallback `system-ui, sans-serif`. `-webkit-font-smoothing: antialiased`. **Minimum 12px anywhere.**

| Role | Size / weight / tracking |
|---|---|
| Page title (h1) | 32px / 700 / −0.02em (auth screens 30px) |
| Hero number | 44–56px / 700 / −0.03em, line-height 1 |
| KPI number | 32px desktop, 26px phone / 700 / −0.03em |
| Section title (h2) | 16px / 700 (cards 15px) |
| Body / list rows | 14–15px / 400 |
| Nav links | 15px / 500 |
| Buttons | primary 15–16px / 700; secondary 13–15px / 400 |
| Field label | 12px / 400, color text-4, 6px below-gap |
| Meta / helper | 12–13px, color text-4 |

### Radius, spacing, shadow
- Radius: inputs 14px (compact 12/10px), buttons 12–14px, cards 18–20px, hero cards 24px, menu 16px, menu items 10px, pills 99px, phone sheet `28px 28px 0 0`.
- Heights: primary button 52px (48 in panels), header button 40px, input 48px (44 compact), menu item 40px, hit targets ≥ 44px on phone.
- Page padding: desktop `36px 40px 80px`, phone `20px 20px 120px`. Max widths: lists 1040px, forms 640px, support 860px, auth 420–520px.
- Common gaps: 8, 10, 12, 14, 16, 22, 28, 36px.
- Shadow: menu only — `0 16px 40px rgba(0,0,0,.5)`.
- Focus: `outline: 2px solid #60A5FA; outline-offset: 2px` on `:focus-visible` for links, buttons, selects. Inputs: border becomes `#60A5FA`.
- Motion: screens enter with `fadeUp` (opacity 0→1, translateY 8px→0, 250–300 ms ease).

### Breakpoint
One breakpoint: **< 760px = phone.** Phone replaces the top nav with a small header plus a bottom tab bar, collapses 2/3-column grids to 1 column, and turns modals into bottom sheets.

---

## App Shell

### Desktop header (≥ 760px)
- `position: sticky; top: 0`, height 64px, padding `0 40px`, bg `rgba(5,5,5,.9)` + `backdrop-filter: blur(12px)`, bottom border `border`.
- Left: logo 30×30 (radius 8), 28px gap, then nav.
- **Nav:** links 15px/500, padding `0 12px`, full header height, gap 4px, `white-space: nowrap`. Inactive `text-3`; hover `#fff`; **active** `#fff` + bottom indicator `box-shadow: inset 0 -2px 0 #60A5FA`, plus `aria-current="page"`. Weight never changes between states. If space runs short, the nav scrolls horizontally rather than wrapping.
  - Admin: **Inventory · Sales · Library · Templates · Invitations · Support**
  - Researcher: **Today · Cycles · Library · Calculator · Progress** (no "Me" on desktop)
- Sub-screens highlight their parent: Stock item / Record purchase / Record sale → Inventory; Researcher history → Support; Cycle detail / builder → Cycles; Peptide / Template detail → Library.
- **Account button** (right, `flex: none`): 44px high, radius 12, border `border-input` (`rgba(96,165,250,.55)` when the researcher is on any account page). Contents: 28px avatar circle (bg `#0d1626`, border `rgba(96,165,250,.35)`, initials 12px/700 `#BFDBFE`), name (nowrap), "Admin" tag for the admin (12px, text-3), ▾. Hover bg `rgba(255,255,255,.06)`. `aria-haspopup="menu"`, `aria-expanded`.
- **Account menu:** absolute, right-aligned, 8px below the button, width 264, padding 8. Header shows name (14/600) and email (12, text-4). Items are 40px, 14px, left-aligned; the current item has bg `rgba(255,255,255,.06)`.
  - Researcher: Profile & support access · Notifications · Personal supplies · Supplements · divider · Sign out
  - Admin: Sign out
  - Closes on outside click, Esc, or any navigation.

### Phone (< 760px)
- Header 56px: logo 26px left; avatar + ▾ right opens the same menu. This is the only sign-out path for the admin on phone.
- Bottom tab bar with the same items as the nav, plus **Me** for the researcher. Labels 12px/600, 20px icon above. Active: `#fff` with a filled `#60A5FA` icon; inactive: text-3 with an outlined icon. **Icons are placeholders — pick a real icon set.**

### Global patterns
- **Saving:** buttons show "Saving…" / "Sending…" and are disabled while a request is in flight.
- **Save failure:** error toast *"Could not save. Nothing was lost — your entry is still here. Try again."*. Form input is preserved.
- **Toasts:** bottom center (desktop 32px from bottom, phone 96px), auto-dismiss 3.6 s.
- **Inline errors:** `role="alert"`, 13px `#F87171`, shown under the form. One message at a time unless noted.
- **Empty states:** plain sentence in text-4, no illustrations.
- **Currency:** CAD, formatted `CAD 1,234.00` (`en-CA`, 2 decimals).
- **Dates:** `Fri Sep 11`, `Sep 11, 2026`, `Fri Sep 11 · 07:30` (24-hour clock).

---

## Admin Screens (build first)

### A4 Inventory — admin landing screen
**Purpose:** Business stock, counted in whole vials per peptide + strength. Business stock only — never a researcher's personal supplies.
- **Header row:** h1 "Inventory". Subtitle *"Whole vials on hand, counted per peptide and strength. Business stock only — never a researcher's personal supplies."* Right: secondary "Record purchase", primary "Record sale" (40px).
- **Table** (28px below): columns `2fr 1fr 1fr 1fr 40px` (phone `1.6fr 1fr 1fr 1fr auto`), gap 12. Header row 12px text-4: *Peptide · strength | On hand | Purchased | Sold*. Rows are 16px-padded links: **Name** · `8 mg` (text-3), On hand bold (`#FBBF24` when 0), Purchased/Sold text-3, `›`.
- **Empty:** *"No stock items yet. Record a purchase to create one."*
- A stock item is created only by recording a purchase ("New peptide / strength…").

### A4 Stock item
- "‹ Inventory" back link, 13px text-4.
- h1 `Compound A · 8 mg`. Below: on-hand number 44px/700 plus "vials on hand".
- Actions: "Record purchase" (preselects this item), "Record sale" (disabled when on hand is 0).
- Two columns (1 on phone), gap 28:
  - **Purchases**, caption *"Oldest first — the order FIFO uses."* Rows: `Aug 15 · 10 vials at CAD 20.00`, sub-line = allocation note (how many of these vials have been sold), total on the right.
  - **Sales**, caption *"Each sale keeps the cost it was allocated at the time."* Rows: date · qty · buyer, revenue on the right. Sub-line: `Cost CAD x (allocation) · gross profit CAD y`.
- Empty states: "No purchases yet." / "No sales yet."

### A5 Record purchase
Max width 640.
- **Fields, in order:**
  1. Stock item (select, plus "New peptide / strength…"). Choosing New reveals Peptide (select, all library peptides) and Vial strength (mg, decimal) side by side.
  2. Received (date).
  3. Vials (int) and Cost per vial (CAD) side by side.
- Summary card: "Total purchase cost" → `CAD x` (or `—`).
- Validation, first failure wins:
  - Date required → *"Enter the date received."*
  - Vials must be an integer > 0 → *"Vials must be a whole number greater than 0."*
  - Cost must be ≥ 0 → *"Enter the cost per vial in CAD (0 or more)."*
- Footnote: *"Purchases already allocated to sales can't be edited here — historical gross profit must not change. Corrections are out of scope for this MVP."*

### A6 Record sale
Two columns, form left and preview card right.
- **Intro copy:** *"Manual entry. No ordering, checkout or payment happens here. Linking a researcher account is a buyer reference only — it grants no access to their private records and adds nothing to their personal supplies."*
- **Fields:**
  - Stock item (shows `· N on hand`) and Sale date.
  - Buyer segmented toggle (44px): **Researcher account** / **Outside buyer**. The selected side is white bg with `#050505` text.
    - Account: select `Name · email`.
    - Outside: "Buyer name or reference", placeholder *"No app account needed"*.
  - Vials and Price per vial (CAD).
- **Preview card** (`#111`, radius 20):
  - Available (warning color if too few), Revenue, Cost of vials sold · FIFO, divider, **Gross profit** (red if negative).
  - "Cost allocation, oldest stock first" lines, e.g. `10 × CAD 20.00 (Aug 15)`.
  - Footnote: *"Gross profit is revenue minus the purchase cost of these vials. It is not net profit; other expenses aren't included."*
- **Validation:** item required, date required, integer vials > 0, price ≥ 0, outside-buyer name required. Insufficient stock blocks saving with an explanatory error.
- **Save** stores the sale **with its FIFO allocation frozen**: `{purchaseId, qty, unitCost, date}[]`, plus revenue and cogs. Later purchases never change past sales.

### A7 Sales & gross profit
- **Filters** (top right, 40px selects): Period (All time / This month / Last month) and Item (All peptides & strengths / each item).
- **KPIs:** 4 columns (2 on phone): Vials sold, Revenue, Cost of vials sold, **Gross profit** (label in `#93C5FD`).
- Note: *"Gross profit = revenue − FIFO purchase cost of the vials sold. Not net profit. Current stock is a separate figure — see Inventory."*
- **By-item breakdown rows**, columns `2fr 1fr 1fr 1fr 1fr`: label, vials, revenue, cost, profit.
- **"Sales in this view"** list, same row format as the stock item's Sales list.
- **Empty states:**
  - *"No purchases or sales yet."*
  - *"Purchases recorded, no sales yet."*
  - *"No sales match this period and item."*

### A2 Peptide library
**Two-pane layout:** list left, editor right (stacked on phone).
- Subtitle: *"Supplied information and internal guidance researchers see. Maintenance only — nothing here generates research."*
- Primary action: "Add peptide".
- **List rows:** name, and a meta line `Updated Aug 20, 2026 · cycling-off guidance · supplement guidance · referenced by N`. Badge "Available" (text-3) or "Not offered" (warning). The selected row has bg `rgba(96,165,250,.06)`.
- **Editor card fields:**
  - Name
  - Information researchers see (textarea, 3 rows)
  - Cycling-off guidance · optional
  - Supporting supplement guidance · optional
  - Checkbox: *Available for new cycles*
- **Validation:**
  - Name required
  - Information required → *"Add the information researchers will see (incomplete entries can't be published)."*
- Turning off "available" hides the peptide from new cycles and templates. Existing cycles keep it. Show the reference-count note in the editor.
- Idle right pane: *"Select an entry to edit it, or add a new peptide."*

### A3 Cycle templates
Same two-pane pattern.
- Subtitle: *"Starting points researchers copy. Editing a template changes future copies only — existing researcher cycles are untouched."*
- Primary action: "New template".
- **List rows:** name, `N days · updated Aug 28`, summary (`Compound A · 2 phase(s) + Compound B · 1 phase(s)`), warning line if it includes a peptide that's no longer offered, and `N researcher cycle(s) were started from it — they won't change.`
- **Editor:**
  - Name, and "Guidance shown with the template · optional".
  - **What researchers receive**, with helper *"Days count from the researcher's start date (day 1). They can adjust everything after copying."*
  - Per peptide: a bordered block (radius 14) with name + "Remove peptide".
  - Per phase: a block (radius 12). Active phases have bg `rgba(96,165,250,.06)` and a `#93C5FD` title; breaks have a transparent bg. Title: `Active phase · day 1–29` or `Break · day 30–36`, with "Remove".
    - Grid, 2 columns: **Starts on day** (int) and **Length (days)** (int).
    - Active phases also have **Dose (mg)** (decimal), **Local time** (time), **Schedule** (full width: *Every N days* / *Fixed weekdays*), then either **Every (days)** or a row of 7 weekday toggles (Mon…Sun, 44×44, selected = white bg with dark text).
  - Buttons: "+ Phase" (active, 28 days, every 5 days, 08:00, starting the day after the last phase ends) and "+ Break" (7 days).
  - Below all peptides: an available-peptide select and "+ Add peptide" (adds one active phase: day 1, 28 days, every 5 days, 08:00, dose blank).
- **Validation, in order:**
  - Name required.
  - At least one peptide.
  - No unavailable peptides.
  - Per phase: start day ≥ 1, length ≥ 1, active dose > 0, interval ≥ 1 or ≥ 1 weekday.
  - Phases in a peptide must not overlap.
  - Each peptide needs ≥ 1 active phase.
  - Show the first error plus `(+N more)`.
- **Scope note** under Save: *"Saving updates future copies only. Cycles already created from this template are not changed."*
- **Stored shape:** relative offsets (`offset` 0-based, `len` days). When a researcher uses the template, each phase converts to absolute dates from their start date.

### A1 Researcher invitations
- Subtitle: *"The only way to join. An invitation creates a researcher account once accepted; it gives you no access to that person's private history."*
- **Left card "Invite a researcher":** Name, Email, primary "Send invitation". Footnote *"Valid for 30 days. Promotion, suspension and other account tools are not part of this MVP."*
- **Right list, newest first:** **Name** · email, `Sent Sep 9, 2026`, and a state label:
  - Pending (`#93C5FD`)
  - Accepted
  - Expired (warning)
  - Send failed (error)
  - Expired and failed rows show a "Resend" button (32px). Resend resets the row to pending with today's date.
- **Validation:**
  - Valid email.
  - Not an existing account → *"{email} already has an account. They can sign in or recover access."*
  - No duplicate pending invite → *"{email} already has a pending invitation."*
- Send failure keeps the row as **Send failed** so it can be resent.
- **Open decision:** there is no way to cancel a pending invitation. Confirm with product.

### A8 Researcher support
- Copy: *"You can only open a researcher's history after they grant you access from their profile. Access is read-only and ends the moment they revoke it. No editing, messaging or shared workspace."*
- **Rows:** name · email, a sub-line, and a state:
  - **Access granted** (`#4ADE80`): *"Read-only since {date}"*
  - **Revoked** (warning): *"Revoked {date} — opening will be denied"*
  - **No access** (text-4): *"They haven't granted access"*
- **Empty:** a card saying *"No researcher has granted you access. Ask them to grant it under Me → Support access."*

### A8 Researcher history (read-only)
- "‹ Support" back link. **Access is checked server-side on every request.**
- **Denied state:**
  - Red "Access denied" label, h1 "{name} hasn't granted you access".
  - Body text:
    - Revoked: *"{name} revoked your access on {date}. Their history is private again; you'd need a new grant from them."*
    - Never granted: *"{name} hasn't shared their history with you. Only they can grant access, from their own profile."*
- **Granted state:**
  - `Read-only · granted {date}` label (`#93C5FD`), name h1, `{email} · full profile history · nothing here can be edited`.
  - 2×2 cards: **Cycles** (name · status, dates · peptides · goal), **Recent actual administrations** (peptide · mg, time), **Check-ins & measurements** (date · feeling n/5, side effects in `#FDE68A`, quoted note, measurements line), **Personal supplies & supplements**.
  - No write actions anywhere.

---

## Researcher Screens (build second)

- **C1 Invitation** — three states:
  - valid: "You're invited / Join Alpha PR Labs Research"
  - expired: *"Invitations are valid for 30 days. Ask Marco to send a new one…"*
  - used: *"Sign in instead, or recover access…"*
- **C1 Account setup (step 1 of 3)** — name, email (read-only, from the invite), password ≥ 8 characters.
- **C1 Acknowledgement (step 2 of 3)** — required checkbox, recorded with the account.
- **C2 Notification readiness (step 3 of 3, optional)**
  - Shows install and permission status.
  - Handles unsupported, denied, and iPhone-not-installed cases (iOS push requires Add to Home Screen).
  - "Turn on reminders" triggers the OS prompt. "Not now" skips.
  - Failure: *"Permission granted, but registering this device failed."*
- **C1 Sign in / Recover access**
  - Sign in shows a session-expired notice when relevant.
  - Recovery always shows the same confirmation, so it doesn't reveal which emails have accounts.
- **R1 Today**
  - Due-now hero card with dose, syringe units (from the saved mixture), a one-tap **Taken** button, and "Add time, site or notes".
  - Unconfirmed past doses in warning color, upcoming doses, and supplement routines if enabled.
- **R5 Confirm sheet**
  - Amount (mg) and actual time (Now / Earlier), with site and notes optional.
  - Actual time can't be in the future.
  - For every-N-days schedules, the next dose moves to the actual time + N.
  - Records both the actual time and the time it was entered.
- **R2 Cycles / R4 Cycle detail**
  - Status: Upcoming, Active, In break, or Ended.
  - An 84-day-style timeline per peptide with phase bars (active solid, break hatched), dose markers (Actual, Due, Planned, Unconfirmed), and a Today line.
  - "Edit future plan" and "Results" actions.
- **R3 Cycle builder**
  - Name, time zone, goal (required), baseline (optional).
  - Per peptide: a saved mixture plus dated phases with dose, schedule (every N days *or* fixed weekdays) and local time; "+ Phase" and "+ Break".
  - Editing a cycle that already has history changes future doses only.
- **R6 Library / Peptide detail / Template detail**
  - Read-only admin content.
  - "Use as starting point" copies a template into the builder. It's blocked if the template includes a peptide that's no longer offered.
- **R7 Calculator** (see rules below)
  - Fields: vial mg, liquid mL, intended dose mg, syringe (1 mL/100 units, 0.5 mL/50, 0.3 mL/30) and line spacing (auto or unknown).
  - "Save mixture" stores the result.
- **R9 Progress**
  - Check-in: feeling 1–5 (required), side-effect chips, note, one optional measurement (value + unit).
  - The history view shows check-ins alongside doses and phases.
- **R11 Me**
  - Profile, grant or revoke read-only support access (with a confirm step, shows past grants), sign out.
- **C2 Notification settings** — per-device reminder status.
- **R8 Personal supplies** (optional feature)
  - Vials linked to a mixture; the remaining amount is estimated from confirmed doses.
  - Calculating never deducts, and admin sales never add here.
- **R10 Supplements** (optional)
  - Shows supplied guidance. Nothing is tracked until the researcher creates a routine (name, amount, unit, time).

---

## Business Rules (must be implemented and unit-tested)

**These were written for the prototype. Re-derive them and test them; don't copy them as-is.**

1. **Schedules**
   - *Every N days:* the first dose falls on the phase start at the given local time. Each later dose = the **actual** time of the previous confirmed dose + N days (or the planned time + N if it wasn't confirmed).
   - *Fixed weekdays:* each selected weekday at the local time, within the phase dates. Keeps its weekday and time regardless of when doses were taken.
   - Each peptide's schedule is independent of the others.
2. **Dose states:** `taken` (has an actual), `due` (today, not taken), `open` / Unconfirmed (past, not taken), `planned` (future).
3. **Calculator**
   - concentration = vial mg ÷ mL; volume = dose ÷ concentration; units = volume × 100 (U-100 syringe).
   - Default line spacing: 100-unit syringe → 2 units, 50 → 1, 30 → 0.5.
   - **Never round.** Flag when units fall between lines, when they exceed the syringe capacity, or when line spacing is unknown.
   - Validation: all values > 0, and the dose can't exceed the whole vial.
4. **FIFO**
   - Allocate the sold quantity against purchases of the same item, oldest first (by date, then id), minus quantities already allocated.
   - cogs = Σ qty × unitCost. Store the allocation on the sale.
   - on hand = Σ purchased − Σ sold. Block sales above on hand.
5. **Gross profit** = revenue − cogs. Label it "gross", never "net".
6. **Templates** are copied when used. Editing a template never changes existing cycles.
7. **Library availability:** an unavailable peptide can't be added to new cycles or templates. Existing references remain.
8. **Support access**
   - Only the researcher can grant or revoke. It is read-only.
   - Revoking takes effect immediately. Keep a grant history (granted and revoked timestamps).
   - Linking a researcher to a sale grants nothing.
9. **Records are append-only for actual doses.** Plan edits affect future doses only.

## Data Model (from prototype seed)
```
Admin { id, name, email }
Account (researcher) { id, name, email, ackAt }
Invitation { id, email, name, state: pending|accepted|expired|failed, sentAt, expiresAt (+30d) }
Peptide { id, name, info, cyclingOff?, supp?, available: bool, updatedAt }
Template { id, name, guidance?, updatedAt, plans: [{ peptideId, phases: [TplPhase] }] }
  TplPhase { type: active|break, offset (0-based day), len (days), mg?, schedType?: interval|weekdays, every?, days?: 0-6[], time? "HH:MM" }
Cycle { id, accountId, name, goal, baseline?, tz (IANA), start, end, templateId?, plans: [Plan] }
  Plan { id, peptideId, mixtureId?, phases: [Phase] }
  Phase { id, type, start, end (dates), mg?, schedType?, every?, days?, time? }
Actual { key = planId:phaseId:(index|date), time, mg, site?, notes?, enteredAt, vialId? }
Mixture { id, peptideId, mg, mL, syringe: 100|50|30, lineStep? }
Vial (personal) { id, label, mixtureId, peptideId, strengthMg }
Checkin { date, feeling 1-5, effects[], note } · Measurement { date, what, value, unit, cycleId? }
Routine (supplement) { id, name, amount, unit, time, start, end? } · SuppTaken { key, time }
Grant { id, accountId, adminId, grantedAt, revokedAt? }
StockItem { id, peptideId, strengthMg }
Purchase { id, itemId, date, qty (int), unitCost (CAD) }
Sale { id, itemId, date, buyerType: account|outside, accountId?, buyerName?, qty, price, revenue, cogs, alloc: [{purchaseId, qty, unitCost, date}], recordedAt }
PushSubscription (per device) { accountId, endpoint, keys, createdAt }
```
Privacy boundary: admin queries must never read a researcher's Cycle / Actual / Checkin / Measurement / Vial / Routine without an active Grant.

## Seed / Test Scenarios
The prototype's "Scenario guide" (PROTOTYPE bar → Guide) lists six end-to-end paths. They make good acceptance tests. Admin-relevant ones:
- **FIFO sale:** Compound A · 8 mg → purchase 10 × CAD 20, then 10 × CAD 25 → sale to Jordan, 12 × CAD 40 → revenue 480, FIFO cost 250, gross profit 230, 8 left. An outside buyer for 9 → insufficient stock. The researcher's supplies are unchanged.
- **Support access:** the researcher grants → the admin can open the history → the researcher revokes → the admin gets access denied.
- **Templates:** edit "Recomp starter" → existing cycle "Recomp Spring 26" is unchanged.

## Assets
- `assets/logo.jpeg` — Alpha PR Labs mark, shown at 26–44px with radius 7–12px.
- Tab bar icons: **not designed**. Use a consistent outline icon set (e.g. Lucide) at 20px.
- No other imagery.

## Open Decisions
1. Cancelling a pending invitation (not in the design).
2. Correcting or voiding recorded purchases and sales (out of scope in the design; affects FIFO history).
3. Real admin-supplied library text.
4. Tab bar icon set.

## Files
- `Alpha PR Labs App.dc.html` — the full interactive prototype (all screens, logic and copy). The template markup holds the layout and inline styles. The script at the bottom (`class Component`) holds the state, validation, FIFO, scheduling and calculator logic.
- `support.js` — prototype runtime only (needed to open the file; not for production).
- `assets/logo.jpeg`
