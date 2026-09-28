# UI breakdown — every screen

Screen IDs match the badges in the HTML files. Measurements are phone (390 × 844) unless the ID starts with **D** (laptop, 1280 × 820). The components named here are specified in `COMPONENTS_AND_THEMING.md`.

Seed scenario for all mocks: **Jordan Reyes**, researcher. Thursday **Sep 24, 2026**, 9:12 AM. Cycle **Recovery protocol**, Sep 1 – Nov 23 (84 days, today is day 24), started from the *Recovery stack* template.
- **BPC-157:** 250 mcg, 7:30 AM and 8:00 PM daily. Vial 10 mg + 2 mL = 5 mg/mL, so 0.05 mL = 5 units on a 30-unit syringe.
- **TB-500:** 2.5 mg Mon and Thu, 9:00 AM. Vial 10 mg + 2 mL, so 0.5 mL = 50 units on a 100-unit syringe. Days 1–14 were a 5 mg loading phase.
- **Adherence:** 51 of 53 doses logged (96%). 1 missed (Wed 8:00 PM BPC-157, still open), 1 skipped (Sat Sep 12).

Admin scenario: Marco Moutinho (owner) and sellers Priya Sandhu and Owen Tremblay. Business figures for Sep 15–24:
- Revenue $3,925.00, cost of stock sold $428.27, gross profit $3,496.73 (89.1%), 32 vials sold.
- Stock: 655 vials worth $7,656.31 at cost.
- Low stock: CJC-1295 10 mg (4), Kisspeptin-10 5 mg (8), Selank 5 mg (9). Low means fewer than 10 vials; make this threshold configurable per item.

---

## Researcher · phone (`Researcher Screens.dc.html`)

### R1 Today (tab: Today)
Purpose: see the day, log the next dose in one tap, catch up on missed doses, check in.

1. **Header** (padding 8 20):
   - Mono 13 `ink-3` "Thu, Sep 24 · Day 24 of 84"; 36 px avatar "JR" on the right (`sunken`, opens Me).
   - Title "Today" 34/600.
   - A day-progress bar of 7 segments (6 px, radius 3, 4 px gap), one per scheduled item including the check-in: done `ink`, due `signal`, rest `line`.
   - Under it, "2 of 7 done" 13/600 on the left and "1 overdue from yesterday" 13/600 `missed` on the right.
2. **Now block** (next dose that is due or overdue today; otherwise the next upcoming one):
   - Pill "Due now" · "9:00 AM" · "Recovery protocol".
   - "TB-500" 22/600, with "2.5 mg · Mon and Thu" beneath.
   - Reading "50" 88 px + "units" mono 19; on the right "0.5 mL" mono 17/600 over "100-unit syringe".
   - The 100-unit syringe ruler.
   - Buttons: **Taken** (primary 56, flexes) + **Details** (ghost-on-ink 56). Taken logs the planned dose at the current time and the suggested site. Details opens R2.
3. **Overdue row** (`missed-tint`): "BPC-157 · 250 mcg" / "Not logged · Wed 8:00 PM" + **Log** (outline 44), which opens R2b. One row per open dose from the last 72 h; older ones appear only on the cycle.
4. **Check-in card** (hidden once the check-in is done): "How do you feel today?" 17/600 + mono "Check-in". Five feeling buttons (58 px). Tapping a number opens R6 with that value preselected.
5. **Schedule** section "Schedule" 20/600 + mono "6 today". The day rail shows every dose and supplement in time order. Rows: 7:30 AM BPC-157 (Taken 7:34 AM · Abdomen L) · 7:30 AM Vitamin D3 5,000 IU (Taken 7:35 AM · Supplement) · 9:00 AM TB-500 (Due now, tinted) · 1:00 PM Creatine 5 g · 8:00 PM BPC-157 (In 10 h 48 min) · 9:00 PM Magnesium glycinate 400 mg. Tapping any row opens R2 for it (or a supplement sheet).
6. **Supplies** (only when a vial is low): low row "BPC-157 · 10 mg vial" / "Low · 1.5 mg left, 6 doses, about 3 days" with a chevron to R7.
7. Tab bar. The first 756 px (above the tab bar) must show items 1–4.

### R2 Log a dose · sheet
Opened from Details or a rail row.
- **Header:** mono 13 `signal-ink` "Due 9:00 AM · Thu", "TB-500" 28/600, close.
- **Draw card** (`surface`, radius 24, padding 16 18 12):
  - Label "Draw" + a mini syringe segmented control `100 | 50 | 30`, defaulting from the saved mixture. Changing it re-scales the ruler; the unit count doesn't change.
  - "50" 80 px + "units"; "0.5 mL / of 1 mL" on the right.
  - The ruler.
- **Strip** (3 columns, dividers):
  - Dose "2.5 mg" (pencil icon; opens a number field to log a different actual amount).
  - Mix "5 mg/mL" / "10 mg + 2 mL".
  - Vial after "2.5 mg" / "of 10 · vial 2". This cell turns `low-tint` with "Vial after · low" when the result is under 3 days of doses.
- **Time taken:** segmented "Now · 9:12 AM" | "Earlier…".
- **Injection site:** a 4 × 2 chip grid, gap 8, 14 px text: Abdomen L/R, Thigh L/R, Delt L/R, Glute L/R. The suggested next site in the rotation is preselected (ink fill, no check). The last-used site has a dashed border. A right-aligned note reads "Last: Thigh R, Mon".
- **Add a note** field (48 px).
- **Footer:** **Skip** (outline 104) + **Taken · 2.5 mg** (primary).

### R2b Log a late dose
The same sheet opened from an overdue row, for BPC-157.
- Header context "Not logged · Wed 8:00 PM" in `missed`.
- Syringe set to 30: "5" units, "0.05 mL / of 0.3 mL", 30-unit ruler.
- Strip: 250 mcg · 5 mg/mL · Vial after **1.25 mg**, shown low (`low-tint`, "5 doses left").
- Time: **Earlier** is selected, revealing a date field "Wed, Sep 23" and a time field "10:15 PM" (focused). Below: "Planned 8:00 PM" and "Must be before now".
- Site collapses to a row, "Injection site · Abdomen R ›". Note field.
- Footer: **Mark skipped** (128) + **Log at 10:15 PM**.
- Validation: the time can't be in the future. Store both the actual time and the entry time.

### R6 Daily check-in · sheet
- **Header:** mono "Thu, Sep 24", "Daily check-in".
- **Overall feeling** (required): five 64 px buttons, with the selected value mirrored top-right as "4 · Good".
- **Anything unwanted?** "Pick any". Multi-select chips with checks: None, Site redness, Nausea, Headache, Fatigue, Poor sleep, Water retention, + Other (free text). Choosing None clears the others.
- **Measurement** (optional): a row with a type dropdown ("Weight ▾") and a value field "81.4" + "kg". Below it, mono "Last: 81.7 kg · Mon Sep 21".
- **Note:** textarea.
- **Footer:** **Save check-in** (primary, full width).

### R1d / R2d Dark
The same as R1 and R2 with dark tokens only. This is the acceptance test for theming.

### R10 Cycles (tab: Cycles)
- Title "Cycles" + a 44 px `ink` round **+** that opens R4a.
- **Active:** card with name 18/600, mono "Day 24 of 84", peptide list, an 84-tick bar with the today marker, and a footer showing the next dose ("TB-500 · 2.5 mg due now") plus adherence "96%".
- **Upcoming:** dashed card "Sleep and recovery" · "Starts Nov 30" · "Epithalon · Selank · 42 days".
- **Ended:** group rows with name, mono dates + peptides, adherence %, chevron.
- "Browse templates" row.

### R3 Cycle detail
- **Nav:** "‹ Cycles" · "Edit".
- **Header:** mono "Active · Sep 1 – Nov 23", title 32, "BPC-157 and TB-500 · from the Recovery stack template".
- **Now block:** "Day" / "24" 80 px + "of 84"; right "60 days left" / "Ends Mon, Nov 23". An 84-tick bar (the first 24 filled) with labels Sep 1 · Today · Nov 1 · Nov 23.
- **Tiles** (3): Adherence 96% "51 of 53 doses" · Missed 1 "Wed 8 PM" (`missed`) · Skipped 1 "Sat Sep 12".
- **Peptides** (one card each):
  - Name + mono "45 of 47", then the schedule line.
  - Phase lane with the today line.
  - Phase rows: mono "Days 1–56" + dates, dose on the right, and a "Now" tag on the current phase.
  - Mixture row in `paper`: flask icon, "10 mg + 2 mL · 5 mg/mL", mono "5 units · 30-unit".
- **History:** 4 rows (glyph, title, mono date · time · site) and "See all 51".

### R4a–c Build a cycle (full-screen flow, 3 steps)
Nav: "Cancel" · "New cycle" · mono "n of 3", with a 3-segment progress bar below.
- **R4a Choose peptides:**
  - "Start from a template" row: layers icon, "Recovery stack, GLP-1 starter and 4 more".
  - Search "Search 20 peptides".
  - Groups "Selected · 2" (pinned) and "All peptides": rows with the name + mono strengths and a 26 px checkbox.
  - Footer: ink **Continue with 2 peptides**.
  - Peptides not offered are hidden.
- **R4b Dose and mix (per peptide):**
  - Peptide switcher chips (the current one ink; the others show "to set").
  - Title = peptide.
  - Dose field (`250` + `mcg | mg` toggle).
  - Vial (strength select from the library) and BAC water (mL).
  - Now block "Each dose": syringe segmented `100 | 50 | 30`, "5" units, "0.05 mL", "5 mg/mL", and the ruler.
  - Info note when the value falls between lines of the chosen syringe.
  - Footer: Back / Continue.
- **R4c Schedule and dates (per peptide):**
  - Chips as in R4b.
  - Starts "Tue, Sep 1" | Length "84 days · Ends Nov 23".
  - Live lane preview with day labels.
  - Phase card (2 px ink border when editing): "Phase 1 · Days 1–56 · Sep 1 – Oct 26", Dose, a frequency segmented control (Daily | Weekdays | Every N days), and time chips + "Time". Weekdays shows seven 44 px day toggles; Every N shows a number field.
  - Break card (dashed) "Days 57–70 · 14 days".
  - Collapsed phase row.
  - Footer: **+ Phase** / **+ Break** (44 outline), then Back / **Next: TB-500**. The last peptide's button reads **Review cycle**; the review screen lists all lanes and has a **Start cycle** primary button.
  - Validation (show the first error, plus "(+N more)"):
    - start day ≥ 1, length ≥ 1, dose > 0
    - Every N: N ≥ 1; Weekdays: at least 1 day selected
    - phases must not overlap
    - each peptide needs at least 1 active phase

### R5 Progress (tab: Progress)
- **Header:** mono "Recovery protocol · day 24", title, segmented 7 days | **30 days** | Cycle.
- **Now block:**
  - "Feeling · cycle average" · mono "Aug 26 – Sep 24".
  - "3.8" 80 px "/ 5"; right "Up 0.6" (arrow) / "first week to last".
  - Trend chart 112 px, with days before the cycle hatched.
  - Dose tracks for BPC-157 and TB-500 (today's TB-500 shown hollow).
  - Axis labels Aug 26 · Sep 1 · Today.
- **Weight card:** "81.4 kg", "Down 2.3 kg / since Sep 1". Line with points on measured days; the pre-cycle area is filled `paper`. Axis 84 kg / 81 kg.
- **Tiles** (3): Adherence 96% · Check-ins 22 "of 24 days" · Effects 3 "days reported".
- **Unwanted effects:** group rows, name + mono dates + "2 days".
- **Check-ins:** rows with a mono date, the mini feeling bars + "4 · Good", and the note.

### R7 Supplies · Vials (from Me or the Today low row)
- **Nav:** "‹ Me" and a round + (add vial).
- Title "Supplies", segmented **Vials** | Supplements.
- **In use · 2:**
  - BPC-157 · 10 mg: "Low" tag, mono "Vial 3 · mixed Sep 17 · 5 mg/mL", a 15% `low-fill` meter, "1.5 mg left" in `low` / "6 doses · about 3 days".
  - TB-500 · 10 mg: 50% ink meter, "5 mg left" / "2 doses · to Mon Sep 28".
- **Unopened · 3:** rows with mono "× 1".
- Footnote: "Remaining is estimated from the doses you log. Tap a vial to correct it or mark it finished."
- Remaining = mixture mg − Σ logged mg on that vial. Low = under 3 days of scheduled doses.

### R13 Supplies · Supplements
- **Today · 1 of 3:** rows with a state glyph, name + amount, and a mono time. A pending row has a **Taken** button (primary for the next one due, outline for later ones).
- **Last 7 days:** a grid of 16 px cells per routine per day. Taken = `ink`; missed = dashed `ink-3`; later today = `line` outline. Legend below.
- The round + adds a routine (name, amount, unit, time, start, optional end).

### R8 Me (tab: Me)
- **Profile:** 64 px avatar, name 26/600, mono email, "Researcher since Aug 2026".
- **Support access:**
  - Card with "Let admins view my history", "Off", and a switch.
  - Copy: "Alpha PR Labs admins would see your cycles, logged doses and check-ins, read-only. You can turn this off at any time and it takes effect straight away."
  - Turning it on opens R17. Turning it off is immediate and adds a grant-history entry.
- **Tracking:** Vials and supplies (On) · Supplements (3 routines) · Dose reminders (At dose time).
- **Preferences:** Default syringe (100-unit) · Weight unit (kg) · Appearance (System).
- **Account:** Research-use disclaimer › (reopens R15 read-only) · **Sign out** (`missed`).
- Footer mono "Alpha PR Labs · research use only · v3.0".

### R11 Library (tab: Library; researchers only)
- Mono "20 peptides · updated Sep 18", title.
- Search.
- Filter chips: All · In my cycles · 2 · Recovery · Metabolic.
- Group rows: name (+ "In your cycle" tag), a one-line description, and mono strengths on the right.

### R12 Peptide detail
- "‹ Library", mono "Updated Aug 20, 2026", title, subtitle.
- Tags: mono "10 mg vial" and "Recovery".
- **Now block "Your mix · 10 mg + 2 mL"** (mono "30-unit syringe"): Strength 5 mg/mL · Your dose 250 mcg · Draw 5 units. Shown only if the peptide is in one of your cycles.
- Sections of company content: Research summary, Cycling off, Supporting supplements, References (numbered rows with an external-link icon).
- **Add to a cycle** (ink).

### R14–R16 Joining (no tab bar; 3-step progress)
- **R14 Accept invitation:**
  - 56 px logo, mono `signal-ink` "You've been invited", "Join Alpha Research".
  - Copy: "A private app for the researchers Alpha PR Labs works with. Your records are yours; admins see them only if you allow it."
  - Fields: Name · Email "from your invitation" (read-only) · Password "8 characters or more".
  - **Continue**, then "Valid until Oct 14 · Already have an account? Sign in".
  - Invalid states from the previous handoff still apply: expired, and already used.
- **R15 For research use only:**
  - "Please read this once. It's recorded with your account."
  - A 330 px scroll box of disclaimer text (**final wording supplied by Alpha PR Labs**).
  - Checkbox "I've read this and I'm using the app as a researcher."
  - **Agree and continue** stays disabled until the box is checked. Store the time it was accepted.
- **R16 Put Alpha on your Home Screen:**
  - Safari only; skip it if already running standalone.
  - Numbered steps: 1 Tap **Share**, 2 Choose **Add to Home Screen**, 3 Open **Alpha** from your Home Screen.
  - Bell note: "We'll ask about reminders the first time you open it from there."
  - Outline **I'll do it later**.
  - On the first standalone launch, show the push permission prompt.

### R17 Share history with admins · sheet
- Shield icon, "Let admins view your history?"
- One row: logo well + "Alpha PR Labs admins" / "Everyone with admin access to the app". **Admins are never named on researcher-facing screens.**
- Two columns:
  - **They'll see:** Cycles and schedules · Logged doses and sites · Check-ins and weight · Vials and supplements.
  - **They can't:** Edit anything · Log on your behalf · See it after you turn this off.
- **Allow read-only access** (primary) / **Not now** (ghost).

### R9a–c Today states
- **Empty:** dashed block with "0" / "doses today", "No cycle running", "Build one from scratch, or start from a template the team maintains and adjust it.", and **Build a cycle** (ink) + **Templates** (outline). The check-in card still shows.
- **Loading:** the real header, then skeletons for the progress bar, Now block, overdue row and check-in.
- **Error:** the `missed-tint` block "Couldn't load today's plan" / "Check your connection and try again. Everything you've already logged is saved." / **Try again** / mono "Last loaded 8:02 AM". Nothing else is shown.

---

## Admin · phone (`Admin Screens.dc.html`)

### A1 Business (tab: Business)
- **Header:** mono "Admin · Marco", avatar "MM", title "Business". Period segmented: Week | Month | **Sep 15–24** (custom; tap opens a range picker) | 12 months (see A13).
- **Now block:**
  - "Gross profit" · mono "32 vials sold", "$3,496.73" 52 px + "CAD", "89.1% of revenue".
  - Split bar: profit 89.1% `signal`, cost hatched.
  - Rows: Revenue $3,925.00 · Cost of stock sold − $428.27 · Gross profit $3,496.73.
- **Actions:** **Record sale** (primary + icon) · **Record purchase** (outline).
- **Tiles:** Stock value $7,656.31 "655 vials at cost" · Vials sold 32 "avg $122.66 each".
- **Revenue by day:** bars for Sep 15–24 (420, 0, 615, 380, 240, 0, 890, 310, 505, 565), today in `signal`. Mono "best Sep 21 · $890.00".
- **Low stock · 3:** rows with the low glyph, "CJC-1295 · 10 mg", "Low · reorder at 10", and "4 vials" on the right. "Stock" link.
- **Recent sales:** rows with "BPC-157 · 10 mg × 3" / mono "Sep 24 · Priya S. → Jordan Reyes" and "$360.00" on the right. "All sales" link.

### A13 Business · 12 months
- Segmented control set to **12 months**. Mono "Oct 2025 – Sep 2026".
- **Now block:**
  - "Gross profit · September to date" "$6,057.16" CAD.
  - "Up $1,036.01 vs Aug 1–24 ($5,021.15)". **Compare a partial month with the same days of the previous month.**
  - Footer: 12-month gross profit $64,222.26 · 12-month purchases $21,302.46.
- **Sales by month:** 12 stacked bars (cost hatched on top, gross profit ink). September is `signal` with a dashed outline. Axis O N D J F M A M J J A S. Legend. Mono "best Aug · $7,585.00".
- **Supplier purchases by month:** outlined bars on the same axis; months with no purchases show a 2 px stub. Mono "none in Nov, Apr".
- **Month by month:** newest first, the last 6 months shown.
  - Each row: month name ("to date" on the current one), gross profit on the right, mono "vials · rev · bought" beneath, and the change vs the prior month with an arrow.
  - "Show all 12 months" button.
- **Purchases by supplier (12 months):** rows with the supplier, total, share bar, and mono "% · currency · N orders". Purchases with no supplier recorded are grouped last in `ink-3`.

### A3 Stock
- **Nav:** "‹ Business", + (record purchase). Title, mono "655 vials · $7,656.31 at cost".
- Search, segmented "All 24 | Low 3".
- **Low · 3:** group with the low tint on every row.
- **All items:** rows with name + mono strength, and the count 20/600 over mono value at cost on the right.

### A4 Record a sale (full-screen modal)
- **Nav:** "Cancel" · "Record sale" / mono "Thu, Sep 24" (tap to change the date).
- Item row: "BPC-157 · 10 mg" · mono "58 on hand" ›.
- Vials stepper (−, 3, +, 44 px buttons) | Price per vial "$120.00 CAD" (focused).
- Seller segmented: Marco | **Priya** | Owen. Defaults to the signed-in admin.
- Buyer: a combobox (researcher accounts, or any typed name). Selected: "Jordan Reyes" + "Researcher" tag + clear. Helper: "Pick a researcher or type any buyer name."
- **Now block "Gross profit on this sale" "$319.86" CAD:**
  - Revenue · 3 × $120.00 → $360.00
  - Cost · 3 from Aug 30 lot at $13.38 → − $40.14. This is the FIFO allocation, listing every lot used.
- **Footer:** **Record sale · $360.00**.
- Validation:
  - vials must be a whole number > 0 and ≤ on hand ("Only 58 on hand.")
  - price ≥ 0
  - buyer required
  - Linking a researcher grants no access to their data.

### A5 Record a purchase
- Item row "TB-500 · 10 mg" · "22 on hand". The item picker includes "New peptide / strength…".
- Vials received 50 | Received "Wed, Sep 23".
- Currency: a vertical segmented control CAD | **USD**, beside Cost per vial "US$ 9.20".
- **Rate card:** "Bank of Canada rate · for Sep 23", mono "1 USD = 1.3741 CAD" *(illustrative)*, "Filled automatically", **Override**.
  - Fetch the Bank of Canada Valet FXUSDCAD series for the received date. Use the previous business day if there's no rate that day.
  - Store the rate and its source on the purchase.
- Supplier · optional: a combobox of past suppliers, plus free text.
- **Now block "Total cost" "$632.09" CAD:** 50 × US$ 9.20 = US$ 460.00 · Per vial in CAD · stock after: $12.64 · 72.
- **Footer:** **Record purchase · $632.09**.

### A7 Ledger
- Title "Ledger", segmented **Sales · 32 vials** | Purchases. Filters: date range chip, "All sellers".
- **Grouped by day:** each header has the date and the day's total in mono. Group rows: "BPC-157 · 10 mg × 3" / mono "Priya → Jordan Reyes · $120.00 ea", with "$360.00" / mono "GP $319.86" on the right.
- Recorded entries are read-only; corrections are out of scope.

### A14 Ledger · by month
- A "Group by" segmented control, Day | **Month**, next to the "All sellers" chip.
- One collapsible group per month: header with the month ("to date" on the current one), mono "vials · GP", revenue, and a chevron.
- Opening a month shows its sales by item (item, mono vials, revenue). For September: BPC-157 18 / $2,160.00, TB-500 12 / $1,860.00, Retatrutide 8 / $1,640.00, Ipamorelin 7 / $707.00, 4 other items 10 / $503.00. Each item opens to its individual sales.
- The Purchases tab groups the same way, with supplier and CAD total.

### A8 Library · admin
Segmented **Peptides · 20** | Templates · 6. Group rows show the name, mono "Updated Aug 20 · in 4 cycles", and a state: Offered (`ink-2` text), **Draft** (low tag), or **Not offered** (outline tag, name in `ink-2`).

### A9 Edit peptide
- Fields:
  - Name
  - Vial strengths (mono chips with ×, plus "+ Strength")
  - Short description
  - Research summary: textarea, **required to publish**
  - Cycling off (optional)
  - Supplements (optional)
- Offered for new cycles: a switch, with the note "4 researcher cycles and 2 templates use it. Turning it off won't change them."
- Footer: **Save and publish** (ink).

### A10 Templates
Template cards: name + mono length, a mini lane per peptide (dose-height bars, hatched breaks), and "Used for 4 cycles · updated Aug 28". A template that includes a peptide no longer offered shows a `low` line, e.g. "Includes PT-141, no longer offered", and can't be used by researchers.

### A11 People
- Invite: email field + **Invite** (ink).
- **Researchers · 5:** rows with an avatar and name. Status:
  - "Shared since Sep 10": `done`, eye icon, chevron → A12
  - "Private": `ink-3`, lock icon
  - "Private · revoked Sep 3"
  - Pending invites (dashed avatar, mono email): "Invited · expires Oct 14" in `signal-ink`, or "Invite expired Sep 19" in `low` with **Resend**.
- **Admins · 3** as a single line.

### A12 Researcher history · read-only
- "‹ People".
- **Banner** (`done-tint`, eye icon): "Read-only · shared by Jordan on Sep 10". It stays pinned under the nav.
- Name, mono "Recovery protocol · day 24 of 84".
- **Now block:** "Adherence this cycle" 96% · "51 of 53", with feeling 3.8 / weight 81.4 kg / effects 3 days beneath.
- Recent: dose and check-in rows.
- No write actions anywhere. **Access is checked server-side on every request.** If access is revoked, show the denied state: "Jordan hasn't shared their history. Only they can turn it on, from Me."

### A6a–c Stock states
- **Empty:** "0 vials", "No stock recorded yet", **Record a purchase**.
- **Loading:** row skeletons.
- **Error:** "Couldn't load stock" / "The server didn't respond. Sales and purchases are paused until counts load, so nothing is recorded against old numbers." / Try again.

---

## Laptop (`Desktop Screens.dc.html`, plus A2 in `Admin Screens.dc.html`)

All laptop screens use a 40 px browser bar (mock only), the 232 px sidebar, and main `padding: 28px 36px` on a 12-column grid with a 16 px gap. The breakpoint is at 760 px.

| ID | Screen | Layout |
|---|---|---|
| A2 | Overview | Header (mono range, title, period segmented, Record purchase / Record sale). Row 1: Now block span 8 (gross profit 56 px, split bar, 3-column legend; right 210 px: revenue by day bars, white on ink) + 2 × 2 tiles span 4. Row 2: Low stock table span 5 + Recent sales table span 7 (Date, Item, Qty, Seller → buyer, Revenue, Gross profit). |
| D9 | Overview · 12 months | Now block span 4 (Sep to date $6,057.16, change vs Aug 1–24, three 12-month totals). Chart card span 8: Sales stacked bars (150 px) above Purchases bars (64 px) on one axis with month labels. Month table span 8 (Month, Vials, Revenue, Cost, Gross profit, Margin, Purchases, GP change; footnote "* vs the same days of August"). Suppliers span 4. **Export CSV**. |
| D1 | Today | Left span 7: Now block (104 px reading, full-width ruler, Taken 240 px + "Add time, site or note"; keyboard hint "Press T to log"), overdue row with **Mark skipped** + **Log**, check-in card (title left, 5 buttons right). Right span 5: Schedule rail card, then the low vial row. |
| D2 | Cycle detail | Now block span 9 (Day 24 of 84, 84 ticks at 7.8 px pitch) + 2 stacked tiles span 3. Full-width timeline card: 180 px label column (name, times, mono mixture) + lanes of 34 px bars with the dose inside and a date axis; one today line through all lanes. History table (status, When, Peptide, Amount, Site, Note; missed row links to "Log late dose"). |
| D3 | Progress | Now block span 8 with a 150 px chart and y-labels (5 Great / 3 OK / 1 Rough), dose tracks, axis. Right span 4: weight card and 2 tiles. Check-ins table span 8 (**Export CSV**) + Unwanted effects span 4. |
| D4 | Stock + Record sale drawer | Title, search 300 + All/Low. Table: Item, On hand (count + 6 px level bar + "Low" tag), Value at cost, Avg cost, Sold 30 d. Low rows tinted. Sortable columns. The drawer (§7.12) holds A4's fields and its FIFO summary. |
| D5 | Ledger (Purchases) + Record purchase drawer | Tabs Sales / Purchases, range chip. Table: Received, Item, Vials, Unit cost (US$ or $), Rate (mono, "—" for CAD), Total CAD. The drawer holds A5's fields. |
| D6 | Library | Three columns: sidebar · 360 px list (title + Add peptide, Peptides/Templates segmented, search, rows; selected row `surface` + `line`) · editor (state line e.g. "Draft · not visible to researchers", "Preview as researcher", 2-column form; research summary shows "Required to publish" in `missed`; footer: Offered switch + **Save draft** + **Publish**, disabled while invalid). |
| D7 | Template editor | "‹ Templates", title, meta. Name + guidance fields. Timeline card (lanes, day axis 1/15/57/71/84). Per-peptide card with **+ Phase**, **+ Break** and **Remove**, plus a phase table (Phase, Days, Dose, Schedule, Time) of inline fields; weekday schedules show seven 30 px toggles. Footer: "Saving changes future copies only. The 4 cycles started from this template won't change." + **+ Add peptide** + **Save template**. |
| D8 | People | Invite card 320 px (Name, Email, **Send invitation**, "Valid for 30 days. An invitation gives no access to the person's history; only they can share it."). Table: Name, Email, Status (icon + word), action (**View history** for shared rows, **Resend** for expired invites). An "Admins" sub-group follows. |

Desktop researcher sidebar: Today (overdue count), Cycles, Progress, Library, Supplies ("low" counter). Admins get both groups; see §7.14 of the components doc.
