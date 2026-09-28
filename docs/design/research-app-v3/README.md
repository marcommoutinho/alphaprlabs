# Handoff: Alpha Research app · design v3

## Overview
Alpha Research is the private app for Alpha PR Labs. It's invite-only and gets installed from the browser to the phone's Home Screen. It has two sides:

- **Researchers** follow peptide cycles and log each dose in one tap. They get exact syringe units from their saved vial mixture, do a daily check-in, track progress next to their doses, and can optionally track vials and supplements. They browse the company's peptide library and can choose to share their history with admins, read-only.
- **Admins** (the owner and two sellers, who are also researchers) see gross profit, revenue and cost, month by month. They manage stock by peptide and vial strength, and record sales (CAD) and purchases (CAD or USD at the Bank of Canada rate). They also maintain the library and cycle templates, and invite people.

This v3 design **replaces** the earlier direction in `design_handoff_alpha_pr_labs_app/`. From that bundle, keep only the **business rules, data model and validation copy**. They still apply, and the relevant parts are repeated below. Discard its visual spec (near-black cards, Inter, the "PROTOTYPE" bar).

## About the design files
The `.dc.html` files in this folder are **design references built in HTML**. They're static mockups showing the intended look, layout, copy and states. **They are not production code.** Recreate them in the target stack:

- **Next.js** (App Router) with **Tailwind CSS 4** and **shadcn/ui on Base UI**, installed as a PWA.
- Use `lucide-react` for icons and `next/font/google` for Geist and Geist Mono.
- Use a charting approach that renders SVG. Hand-rolled SVG is fine; the charts are simple.

To view them, serve the folder (`npx serve .`) and open any `.dc.html` file. They need `support.js` beside them, plus an internet connection for the fonts and icons. Each file is a pannable, zoomable canvas of labelled frames (R1, A4, D2 and so on).

## Fidelity
**High fidelity.** Colours, type, spacing, radii, copy and states are final. Recreate them pixel-accurately using the tokens in `tokens.css`. These parts are placeholders:

- Library text (research summaries, guidance, references) and the disclaimer wording. The company supplies these.
- The Bank of Canada rate shown (1.3741). Fetch the real rate.
- The seller and supplier names (Priya Sandhu, Owen Tremblay, Halcyon Peptides, Northline Supply), and monthly figures before September 2026.

## What's in this folder
| File | Contents |
|---|---|
| `README.md` | This file: overview, stack, behaviour, state, rules, tokens summary |
| `UI_BREAKDOWN.md` | **Every screen**: purpose, layout, contents, exact copy, validation |
| `COMPONENTS_AND_THEMING.md` | **Design system**: colour (light and dark), dark-mode rules, state glyphs, type scale, number formatting, spacing, and every component spec |
| `tokens.css` | Drop-in CSS variables for light and dark, a Tailwind 4 `@theme` block, and shadcn aliases |
| `Alpha Design System.dc.html` | Visual design system: direction, colour, type, space, icons, components |
| `Researcher Screens.dc.html` | R1–R17: Today, log sheets, check-in, cycles, builder, progress, supplies, supplements, library, Me, joining, share access, states, dark variants |
| `Admin Screens.dc.html` | A1–A14: Business overview (phone and laptop A2), 12 months, stock, record sale/purchase, ledger (by day and by month), library admin, templates, people, read-only history, stock states |
| `Desktop Screens.dc.html` | D1–D9: laptop layouts for Today, Cycle, Progress, Stock + sale drawer, Ledger + purchase drawer, Overview 12 months, Library, Template editor, People |
| `Tab Bar.dc.html` | Tab bar component reference (researcher and admin, light and dark) |
| `assets/logo.jpeg` | Alpha PR Labs mark. Use at 26–56 px, radius 8–14. |
| `support.js` | Runtime for viewing the mockups only |

## Design direction (the reasoning behind the calls)
The app should feel like a **bench instrument**: one reading at a time, printed large, with its scale drawn next to it.

- **One inverted Now block per screen** holds the key number. That's the next dose in syringe units, the cycle day, the feeling average, or gross profit.
- **Graduated scales replace rings everywhere.** That covers syringe rulers with real line spacing, one tick per cycle day, dose-height phase lanes, and graduated vial meters.
- **Light is the default** (warm neutral paper, ink black, brand blue #60A5FA). **Dark follows the OS** and swaps the same tokens.
- **States are shapes and words.** Colour is never the only signal.

Two earlier directions (flat black cards with all-caps labels, then glassy blue glows) were rejected. Don't reintroduce translucent cards, glows, gradients, rings or a floating frosted tab bar.

## Navigation
- **Phone (< 760 px):** a docked 5-tab bar.
  - Researcher: Today · Cycles · Progress · Library · Me.
  - Admin: Today · Cycles · Progress · **Business** · Me. For admins, Library lives in Business.
  - Supplies and Supplements open from Me and from the Today low row.
  - Sheets: Log dose, Check-in, Share access. Full-screen modals: Build cycle, Record sale, Record purchase, Edit peptide.
- **Laptop (≥ 760 px):** a 232 px sidebar.
  - Researcher: Today, Cycles, Progress, Library, Supplies.
  - Admin adds a **Business** group: Overview, Stock, Ledger, Library, People.
  - Phone sheets become right-hand drawers (420 px) over the list they change.

## Interactions and behaviour
- **Taken (one tap)** logs the planned amount at the current time, the suggested site, and the vial that's in use. It shows the "Undo" toast (4 s), advances the Now block to the next dose, and updates the rail glyph and the day-progress bar.
- **Details / row tap** opens Log a dose (R2). **Log** on an overdue row opens R2b with Earlier preselected and prefilled with the planned time. The actual time can't be in the future. Store both the actual time and the entry time.
- **Skip / Mark skipped** records a skip. It counts against adherence as "skipped", not "missed".
- **Check-in:** tapping 1–5 on Today opens R6 with that value set. Feeling is required. Choosing "None" clears the other effects. There's one optional measurement.
- **Syringe switch** (100 / 50 / 30) re-scales the ruler only; units are U-100 and don't change. Show the between-lines note or the over-capacity warning (see the components doc, §7.8).
- **Site rotation:** preselect the next site in the order Abdomen L → Abdomen R → Thigh L → Thigh R → Delt L → Delt R → Glute L → Glute R, skipping the last-used site. The last-used site gets a dashed border.
- **Share access (Me):** turning it on opens the R17 confirmation; turning it off is immediate. Keep a grant history. Admin reads of researcher data are checked server-side on every request.
- **Business period:** Week / Month / custom range / 12 months. For a partial current month, compare with the same days of the previous month.
- **Record sale:** the FIFO cost preview updates live. Block vials above on hand. On save, freeze the allocation on the sale.
- **Record purchase:** when the currency is USD, fetch the Bank of Canada rate for the received date (use the previous business day if there's none), allow override, and store the rate and source.
- **Ledger:** group by Day or Month. Month groups open to item totals, then to individual entries.
- **Loading:** skeletons with the same shapes as the real content, and a slow pulse. **Errors** replace data rather than showing stale numbers on Today (doses) and Stock (counts).
- **Toasts:** success toasts auto-dismiss at 4 s with Undo. Error toasts ("Couldn't save. Your entry is still here." · Retry) stay until dismissed, and the form input is kept.
- **Motion:** screen push 280 ms `cubic-bezier(.2,.8,.2,1)`. Sheets 320 ms up and 240 ms down. Honour `prefers-reduced-motion`.
- **Install:** R16 appears in iOS Safari only. Request push permission on the first standalone launch.

## State management (client)
- `today`: the dose instances for the local day, plus overdue ones from the last 72 h, each in state `taken | due | upcoming | overdue | skipped`. Also supplement instances, the check-in status, and low vials.
- `logDraft`: `{ doseId, amount, unit, takenAt | 'now', site, vialId, note }`.
- `checkinDraft`: `{ feeling 1–5, effects[], note, measurement? { type, value, unit } }`.
- `cycleBuilder`: `{ step, peptides[], perPeptide: { dose, unit, mixture { vialMg, mL, syringe }, phases[] } }`.
- `businessRange`: `week | month | custom(start,end) | 12m`. `ledger`: `{ tab: sales|purchases, groupBy: day|month, filters }`.
- `appearance`: `system | light | dark`, which sets `.light` or `.dark` on `<html>`.
- Server data: cycles, plans, phases, actuals, mixtures, vials, check-ins, measurements, routines, grants, library, templates, stock items, purchases (with rate), sales (with the frozen allocation), invitations, push subscriptions.

## Business rules (carry over from v2; re-derive and unit-test)
1. **Schedules.** Daily, fixed weekdays, or every N days, per phase, at local times. For every-N schedules, the next dose is the previous **actual** time + N (or planned + N if it wasn't confirmed). Each peptide's schedule is independent. Breaks produce no doses.
2. **Dose state:** `taken` (has an actual) · `due` (today, not taken, within the window) · `overdue` (past, not taken, not skipped) · `upcoming` (future) · `skipped`.
3. **Calculator:**
   - concentration = vial mg ÷ mL; volume = dose ÷ concentration; units = volume × 100.
   - **Never round.** Flag between-lines values, over-capacity values, and doses larger than the whole vial.
   - Line spacing: 100-unit syringe → 2 units, 50 → 1, 30 → 0.5.
4. **Vial remaining** = mixture mg − Σ logged mg for that vial. Low = under 3 days of scheduled doses.
5. **FIFO:**
   - Allocate each sale against the oldest purchases of the same item first.
   - Cost of stock sold (COGS) = Σ qty × unit cost (in CAD).
   - On hand = purchased − sold.
   - Freeze the allocation on the sale; later purchases never change past sales.
6. **Gross profit** = revenue − COGS. Always label it "gross", never "net".
7. **Month over month:** monthly totals come from sales and purchase dates in the business time zone (America/Toronto). The current month's change compares day 1 through today with the same days of the previous month.
8. **Templates** are copied when used; editing a template never changes existing cycles. A template containing a peptide that's no longer offered can't be used.
9. **Library:** a draft can't be published without a research summary. A peptide that's no longer offered is hidden from new cycles and templates, but existing references remain.
10. **Support access:** only the researcher can grant or revoke it. Access is read-only, and revoking takes effect immediately. Linking a researcher to a sale grants nothing.
11. **Actual doses are append-only.** Plan edits affect only future doses.

## Design tokens (summary; the full set is in `tokens.css` and `COMPONENTS_AND_THEMING.md`)
- **Light:** paper #F2F2EE · surface #FFFFFF · sunken #E8E8E3 · line #DCDCD5 · ink #0D0E10 · ink-2 #464950 · ink-3 #676B73 · signal #60A5FA (text on it #0A0B0D) · signal-ink #1F5FCC · done #177A4E · missed #B93A26 · low #8A5A00 / fill #E9A93A.
- **Dark:** paper #0C0D0F · surface #16181B · sunken #1F2226 · line #2A2D32 · ink #F3F3F0 · ink-2 #B4B7BE · ink-3 #8C9098 · signal-ink #7DB6FB · done #4CC38A · missed #FF7A61 · low #F0B44C.
- **Type:** Geist 400/500/600 + Geist Mono 400/500/600. Readings 72–104 px at −0.055em; titles 34/600; body 16; minimum 12.
- **Radius:** 8 · 12 · 16 · 20 · 28. **Spacing:** 4-based (4, 8, 12, 16, 20, 24, 28, 32, 56). **Touch:** 44 min, 56 primary.
- **Shadows:** only the sheet `0 -8px 40px rgba(0,0,0,.18)`, the drawer `-12px 0 40px rgba(0,0,0,.18)`, and the segmented selection `0 1px 3px rgba(0,0,0,.1)`.

## Privacy of admin identity
Researcher-facing screens (R1–R17, D1–D3, onboarding, emails, push notifications) **never show admin names**. Refer to them as "Alpha PR Labs" or "Alpha PR Labs admins". Admin names appear only on admin screens, e.g. the seller on a sale, the People list and the sidebar user.

## Accessibility
- Text contrast is at least 4.5:1 in both modes. Every state has a glyph and a word.
- Hit targets are at least 44 px. Focus ring: 2 px `signal`, offset 2.
- Sheets and drawers trap focus and close on Esc. Toggles and segmented controls use proper `role`s (Base UI provides them).
- Live regions: toasts are `role="status"`, errors `role="alert"`, loading uses `aria-busy`.
- Respect safe areas (`env(safe-area-inset-*)`). Honour `prefers-reduced-motion`.

## Assets
- `assets/logo.jpeg`: the brand mark.
- Icons: Lucide (names listed in the components doc, §8).
- No other imagery.

## Open items
1. The final disclaimer wording and library content (company).
2. Cancelling a pending invitation, and voiding recorded sales or purchases. Both are still out of scope; confirm with the owner.
3. The low-stock threshold per item (the mocks use 10 vials) and the vial "low" threshold (the mocks use 3 days).
4. Whether admins should see customer-level sales reports (not designed).
