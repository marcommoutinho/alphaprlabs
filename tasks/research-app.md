# Alpha PR Labs — Research App MVP

Status: Product scope, operating defaults and the final interface are approved. The build plan was reconciled with the interface on 2026-09-25 and awaits Marco's approval.

Approved by Marco on 2026-09-09, including the support-access default.

This file is the canonical product contract for the app. Future implementation
planning must map back to these commitments and stories. It belongs to Alpha PR
Labs and is separate from the Dibbly roadmap. IDs are append-only.

Approved technology stack: [Research app technology decision](research-app-stack.md).

Implementation plan: [Phases, dependencies, parallel groups and verification](research-app-plan.md). Operating defaults approved by Marco on 2026-09-09. The build map, reconciled with the approved interface on 2026-09-25, awaits approval.

Planning requirement: [Identify and document safe parallel development](research-app-stack.md#parallel-development-requirement), approved by Marco on 2026-09-09.

Beacon initiative: [Alpha PR Labs](../../../development/docs/features/active/alpha-pr-labs.md),
registered on 2026-09-25. Marco requested an initiative only, without a Beacon
Project. Concept selection remains the next step; build approval is unchanged.

## Interface design before implementation

Marco directed on 2026-09-11 that the interface be designed in Claude Design
before any application implementation. The [UI/UX requirements brief](../../../development/docs/design/alpha-pr-labs/research-app-brief.md)
contains workflows, functional areas, data, permissions and states without
prescribing design choices. It is derived from this contract; it does not
replace product authority.

Marco confirmed on 2026-09-25 that the design is complete and ready to
implement. The approved handoff is in [`docs/design/research-app/`](../docs/design/research-app/README.md).
The implementation plan has been reconciled with it; application
implementation starts when Marco approves that build map.

## Vision

### Outcome

Help researchers follow changing peptide cycles, record what they actually took,
and review their progress, while admins maintain the library and manage stock,
sales, and gross profit.

### User and present problem

Several invited researchers need to manage cycles involving one or more peptides,
each with its own schedule and requirements. They need reminders, saved vial
calculations, an accurate history, and a simple way to record results. Admins need
separate business inventory and sales records, plus permission-based access for
researcher support. These needs come from Marco's product-definition interview;
no separate user research was supplied.

### Finished experience

A researcher accepts an invitation, confirms the researcher disclaimer, and
installs the web app on their phone. They create a cycle from an admin template or
build their own using the supplied peptide library. Each peptide has independent
dates, phases, amounts, schedules, and breaks.

The researcher saves their vial strength and the amount of liquid added. A phone
notification shows the planned dose in mg and the corresponding syringe units.
They tap Taken, optionally recording the actual amount, time, injection site, or
observations. They can record an earlier injection date and time when logging
late. Their history and progress view brings together actual doses, cycle dates,
simple check-ins, and optional measurements and supplement records.

Researchers can optionally track their own supplies. Admins maintain a separate
inventory, manually record purchases and sales, and review costs, revenue, and
gross profit. An admin can view a researcher's full profile history for support
only after that researcher explicitly grants access.

### Commitments

- **V1 — Access and privacy.** Invitation-only accounts with a researcher
  confirmation disclaimer. Profile history is private by default. Researchers can
  explicitly grant an admin view-only access to their full profile history.
  Access remains active until the researcher revokes it. It does not permit the
  admin to edit the researcher's history.
- **V2 — Flexible cycles.** Researchers select peptides from the admin-maintained
  library and create custom cycles or customize admin templates. Each peptide in
  a cycle has independent start and end dates, phases, dose changes, frequencies,
  and breaks. Plan edits update future doses while preserving recorded history.
- **V3 — Reminders and logging.** The browser-installable web app provides phone
  push notifications. Interval schedules follow the actual confirmed injection
  time; fixed weekday schedules retain their weekdays. An unconfirmed dose can
  receive one or two follow-up reminders and stays unconfirmed until the
  researcher confirms it, even after later scheduled events. Taken is a one-tap
  action. Actual amount, date/time, injection site, and observations are optional
  details. Researchers can override the recorded date/time when logging late.
- **V4 — Saved vial calculator.** Use saved vial strength, liquid added, and the
  researcher's intended dose to calculate volume and syringe units. Support
  U-100 syringes with 100-, 50-, and 30-unit capacities. Reminders show planned mg
  and corresponding syringe units. Each vial contains one peptide only.
- **V5 — Optional personal inventory.** Researchers can list their own vials.
  Confirmed usage deducts from estimated remaining vial contents, with low-stock
  alerts. Personal inventory stays separate from admin stock and sales records.
- **V6 — Simple progress tracking.** Record a cycle goal and starting baseline,
  one simple daily check-in across active peptides with overall feeling from 1–5,
  unwanted effects, and optional notes. Allow an optional goal-related
  measurement. Show results alongside actual doses and cycle dates. Unwanted
  effects are recorded; a separate numerical rating was not specified.
- **V7 — Guidance and supplements.** Admins maintain internal cycling-off and
  supplement guidance. Researchers may optionally track supplements with
  schedules, reminders, and Taken logging.
- **V8 — Admin inventory and finances.** Track individual vial stock separately
  for each peptide and vial strength. Manually record purchases and purchase
  costs, sales and quantities sold, revenue, and gross profit (sale revenue minus
  the cost of stock sold). A buyer may be a linked researcher account or an
  outside buyer. A sale does not add stock to personal inventory or grant access
  to private researcher history.

### Admins are researchers (Marco, 2026-09-26)

Every admin is also a researcher and uses the app the same way: cycles,
reminders, confirmations, calculator, supplies, progress and supplements, plus
the admin back office. An admin's own records are private like any researcher's;
viewing another researcher's history still requires that researcher's grant.
The app opens on the research side; an "Admin" item in the account menu
switches to the back office and back.

### Library and account-data decisions (Marco, 2026-09-26)

- Researchers never see peptides the admin has marked "Not offered" when
  browsing the library. A researcher whose own cycles already use such a
  peptide still sees it in those cycles.
- Library peptide names are unique (ignoring case and surrounding spaces).
- The library's "referenced by N" count is admin-only and shows a number,
  never whose cycles.
- Accounts are never fully erased. Closing an account is a soft delete: the
  account and its history are hidden, no admin can access them (existing
  support grants stop working), and personally identifying details (name,
  email and any other identifying fields or attachments) are removed or
  replaced. How an account is closed is not yet designed; it is not part of
  the approved MVP screens.

### Schedule, calculator and inventory decisions (Marco, 2026-09-26)

- Doses and reminders follow the phone's clock: an 8:05 PM dose stays at
  8:05 PM across a daylight-saving change, including every-N-days routines.
- One dose time per day per peptide phase; twice-a-day routines are not needed.
- A reminder more than 15 minutes late (for example after a reminder outage)
  is skipped; the 30-minute and 2-hour follow-ups still go out.
- Changing the dose partway through an every-N-days phase keeps the rhythm
  from the last dose; it does not restart the count.
- Calculator numbers accept a comma as the decimal point ("1,5" = 1.5).
  Forms that look like thousands ("1,000", "2,500") are refused rather than
  guessed; the researcher retypes.
- The business is local: its time zone is America/Toronto. "Today" for
  purchase and sale dates is today in Toronto.
- Purchases and sales cannot be dated in the future. A sale may be dated
  before the purchase whose stock it uses (stock is sometimes entered late).
- Zero-price sales (free samples) and zero-cost purchases are allowed.
- The buyer list for a sale includes admins, since admins are researchers.
  It starts blank (no account preselected) and can be searched by name or
  email.
- With no stock items yet, "Record sale" shows "No stock items yet. Record a
  purchase to create one." instead of the form.
- On phones, the Sales page drops the "CAD" label from money columns (all
  amounts are CAD).
- Entry limits (typo guards): 100,000 vials per entry, CAD 1,000,000.00 per
  vial, 100,000 mg vial strength.

### Template and cycle decisions (Marco, 2026-09-26)

- A template that includes a peptide later marked "Not offered" can still be
  edited and saved; it keeps showing a warning. A peptide that is not offered
  still cannot be newly added to a template.
- A researcher starting a cycle from such a template gets the withdrawn peptide
  in their copy, as the template has it. (Browsing the library still hides
  withdrawn peptides; a custom cycle still cannot newly add one.)
- Each peptide appears once per template; dose changes over time are phases
  within that one entry.
- A new cycle may start in the past, to log a cycle already under way.
- Changing the dose time partway through an every-N-days phase keeps the
  rhythm: doses stay on the same every-N-days days and only the clock time
  moves. (Dose changes already keep the rhythm.)
- A peptide that has started in a cycle cannot be deleted from it; the
  researcher ends it by shortening its phase, keeping history intact.
- An edit applies from today if today's dose time has not passed, otherwise
  from tomorrow.
- The business is strictly local. Rare time zones with two-hour clock changes
  (e.g. Antarctica/Troll) are not supported by the database's due-time check;
  accepted, since the app will never operate there.

### Library views and mixtures decisions (Marco, 2026-09-26)

- A template page shows a notice at the top when it includes a peptide that is
  no longer offered ("Your copy will include {name}, which is no longer
  offered"), in addition to the per-peptide label.
- A researcher whose own cycle uses a withdrawn peptide can open that peptide's
  library page from their cycle; it stays hidden when browsing.
- A saved mixture is linked to cycle peptides in the calculator (a picker in the
  cycle builder may come later).
- A confirmed dose records the mixture setup in effect at the time the
  researcher says they actually took it.
- Kept as built: "Scheduled vs actual" lists past and today's doses (future
  doses are on the timeline); liquid added is capped at 1,000 mL as a typo
  guard; a mixture's vial strength cannot change while a tracked open vial uses
  it.

### Today and confirmation decisions (Marco, 2026-09-26)

- An actual time more than one day before the planned time is refused as a
  likely typo; future times are refused.
- Only today's and earlier doses can be confirmed; tomorrow's dose becomes
  confirmable on its day (with the earlier actual time if taken early).
- The app icon badge counts unconfirmed doses from cycles that are still
  running; ended cycles keep their open doses in history with a Confirm link.
- Today lists the next dose of every peptide in the researcher's cycles.
- A confirmed dose deducts the full amount from the open personal vial of the
  mixture in effect at the actual time, only while supply tracking is on.

### Personal supplies decisions (Marco, 2026-09-26)

- Low stock compares the estimated remaining with the next planned dose from
  today onward; unconfirmed doses from earlier days are not counted.
- A finished vial whose mixture was deleted, changed strength or already has
  another open vial reopens as "Not mixed yet" with a message, not refused.
- Today shows the low-stock line on the main dose card, today's doses and each
  peptide's next dose; not on older unconfirmed doses.
- A vial added without a label is named "Vial N". Tracking off hides the vial
  list; adding or reopening a vial needs tracking on.

### Progress decisions (Marco, 2026-09-26)

- Check-ins are for today only; past days cannot be added or edited ("gaps
  stay gaps").
- One optional measurement per daily check-in, edited with it.
- Check-ins do not require a cycle: a researcher between cycles can still
  check in, and Progress shows those check-ins without a cycle.
- A check-in's day is always the America/Toronto calendar day (the app is
  strictly local), so there is exactly one check-in per researcher per day.
- No delete; notes and measurement units are free text and must be cleared by
  any future account-closure design.

### Supplements decisions (Marco, 2026-09-27)

- Supplement tracking has its own toggle, off by default; while off,
  supplements are hidden and changes are refused, and records are kept.
- Today lists only today's supplement occurrences; missed ones stay unmarked.
- The app badge counts peptide doses only, not supplements.
- Editing a routine applies from now on (including today's occurrence if not
  yet taken); past Taken records keep what was recorded. Routines are ended,
  never deleted. Supplement times use America/Toronto.

### Support access decisions (Marco, 2026-09-27)

- Simplified sharing: a researcher shares read-only history with the Alpha PR
  Labs team (every current and future admin) in one step; there is no choosing
  an individual admin. Stopping sharing applies to all admins.
- Revoking (stop sharing) asks for confirmation first.
- The admin Support screen lists only researchers who currently share.
- The grant history on Me shows when sharing started and stopped.
- Researchers never see which admin it is: anywhere a researcher-facing screen
  would name an admin it shows "Admin", and researcher-callable reads never
  return admin names or emails.
- The invitation email and invite page are anonymous too ("You've been invited
  to Alpha PR Labs Research"; "An Alpha PR Labs admin invited you").

### Purchase currency decisions (Marco, 2026-09-27)

- Supplier purchases are often in USD. The Inventory purchase form accepts a
  USD cost and the purchase date, converts with the Bank of Canada daily
  USD→CAD rate for that date, and stores the USD amount, the rate and the CAD
  cost. Gross profit stays in CAD. Sales are always in CAD (Marco,
  2026-09-27); only purchases can be entered in USD.
- Bank of Canada rates are stored in the app's own database: a daily sync
  after publication, a one-off backfill from 2025-01-01, and a single on-demand
  fetch only when a date's window is missing. Saving a purchase does not depend
  on the Bank of Canada being reachable (Marco, 2026-09-27).
- The opening-stock import uses each order's real CAD total where known
  (shipping and fees included) and the Bank of Canada rate for that date
  otherwise.

### Sellers, admin invitations and buyer linking (Marco, 2026-09-27)

- Every new sale records its seller, which is required and must be an admin
  account. The sales screen shows revenue, cost and gross profit per seller
  for the chosen period.
- Admins can invite a new admin from the Invitations screen (a Researcher /
  Admin choice with a confirm step); the invitee sets their own password.
- Outside-buyer sales can later be linked by an admin to that person's account
  once they join; the link never grants access to history and adds nothing to
  personal supplies.
- The Sep 15–24, 2026 sales (sellers Brian and Natasha) are imported after
  these exist: the vials they used are added back as opening stock dated
  Sep 14 at the same cost, so the final count stays at today's.

### Design v3 rebuild decisions (Marco, 2026-09-28)

- The app is rebuilt to the v3 design in `docs/design/research-app-v3/`
  (replaces the earlier visual spec; light by default, dark follows the OS).
- Where the v3 design contradicts a rule already decided in this document, the
  earlier rule wins. Known cases: USD purchases use only the stored Bank of
  Canada rate (no override); a personal vial is low when its remaining is less
  than the next planned dose; Today keeps its current rules for which open
  doses appear (the design's 72-hour window is not applied); researchers see admins as
  "Admin" / "Alpha PR Labs admins", never by name; sign-up keeps the existing
  password and invitation flow.
- Everything else the v3 design shows is built, including features the app did
  not have: Skip a dose (counts as skipped, not missed), Undo after Taken,
  8 injection sites with rotation, Appearance / default syringe / weight-unit
  preferences, adherence with missed and skipped counts, supplier on purchases,
  per-item low-stock threshold (default 10 vials), the Business period views
  (week, month, custom range, 12 months with month-over-month on matching
  days), revenue by day, the Ledger grouped by day or month, CSV exports, the
  library draft / publish state, and the laptop layouts.
- Check-in weight defaults to pounds (Marco, 2026-09-28: "For check in
  weight, lbs should be default but also allow users to get kgs"): an account
  that has not chosen a weight unit enters and sees weights in lb, and Me's
  Weight unit offers lb and kg. Stored measurements keep the unit they were
  entered in and are converted exactly for display (1 lb = 0.45359237 kg).
- Marco is away during the rebuild; Main decides review escalations on the
  safer option and records each one for him.
- Installing the app gets very explicit instructions (Marco, 2026-09-29,
  approving Main's proposal): one install guide that detects the phone and
  browser and opens on those steps, with tabs for the others (iPhone ·
  Safari, iPhone · Chrome, Android; the detected one marked "This phone").
  Each step is one short sentence with the button's name in bold, beside a
  drawing in the app's style (not screenshots) with the button to tap
  highlighted. Safari's steps follow iOS 26's layout (Share behind •••) when
  Safari's version says so, and cover both layouts when it can't be told.
  Android Chrome gets a one-tap Install app button when the browser offers
  one, and the manual steps always. Inside another app's browser the guide
  first says to open the page in Safari or Chrome, with a Copy link to
  Today (never the current URL). On a laptop it is "Get the app on your
  phone": a QR code for Today, generated locally, plus the tabs. It shows at
  joining (step 3, now for everyone not already in the installed app, not
  only iPhone Safari; "I'll do it later" still goes on to Today) and as an
  item in Me and the account menu for researchers and admins, hidden inside
  the installed app. The reminders screens link to it.

### Launch exclusions

- Blended or multi-peptide vials. A cycle may still contain several separately
  tracked peptides.
- Online ordering and payments; sales entry is manual.
- Automatic transfer from a sale into researcher inventory.
- Photos, lab uploads, wearable integrations, and detailed questionnaires.

### Assumptions and remaining detail

The approved support-access default is view-only access until revoked, not an
unresolved decision. No product-scope decisions remain open from this interview.

The [implementation plan](research-app-plan.md#approved-operating-defaults)
records the approved CAD/FIFO, reminder, scheduling and syringe-marking defaults.
Detailed implementation refinements remain proposals. The interface brief
identifies the content and interaction details still needing resolution. Examples
of peptide amounts and schedules used in the interview are illustrative user
inputs, not validated protocols or approved library content.

## Stories

These are the user capabilities approved in the MVP playback, with acceptance
criteria drawn from the agreed scope. The implementation citations below map to
the [draft implementation plan](research-app-plan.md); they are proposed delivery
boundaries, not evidence of implementation or approval to start building.

### Story ST-1: Join and control support access

A researcher can join by invitation and control admin access to private history.

**Commitments:** V1

**Delivers:** P1-H2, P1-H3, P5-H5

**Enables:** P1-H1

**Acceptance:**
- Joining requires an invitation and researcher confirmation disclaimer.
- An admin cannot view private history without the researcher's explicit grant.
- A grant covers the full profile history, is view-only, and lasts until revoked.
- The researcher can revoke the grant.

### Story ST-2: Build and adjust a cycle

A researcher can create or customize a cycle with several independently planned
peptides from the supplied library.

**Commitments:** V2

**Delivers:** P3-H1, P3-H3, P4-H1, P5-H4

**Enables:** P1-H4, P2-H2

**Acceptance:**
- A researcher can build a custom cycle or start from an admin template.
- Each peptide can have its own dates, dose and frequency phases, and breaks.
- Editing the plan changes future doses without rewriting what was recorded as
  actually taken.

### Story ST-3: Follow reminders and record actual doses

A researcher can receive phone reminders and confirm what they actually took.

**Commitments:** V3, V4

**Delivers:** P2-H3, P3-H3, P3-H4, P4-H1

**Enables:** P1-H2, P1-H3, P2-H2, P3-H1, P3-H2

**Acceptance:**
- The web app can be installed from a phone browser and supports push reminders.
- A reminder shows planned mg and calculated syringe units from saved vial data.
- Taken can be logged with one tap; actual amount, time, site, and observations
  are optional details.
- A late entry can use the actual injection date/time. Interval reminders follow
  that time, while fixed weekday schedules retain their weekdays.
- One or two follow-ups can remind the researcher about an unconfirmed entry.
  The entry remains open for later confirmation and is not assumed taken.

### Story ST-4: Calculate from a saved vial mixture

A researcher can calculate their intended dose using saved vial information and
their selected U-100 syringe capacity.

**Commitments:** V4

**Delivers:** P2-H1, P3-H2, P4-H2

**Enables:** P1-H4

**Acceptance:**
- Save vial strength and liquid added rather than re-entering them each time.
- Calculate volume and syringe units for the intended dose using a 100-, 50-, or
  30-unit U-100 syringe.
- Only single-peptide vials are supported.

### Story ST-5: Review cycle progress

A researcher can record a small set of observations and review them beside the
actual cycle history.

**Commitments:** V6

**Delivers:** P4-H3

**Enables:** P3-H1, P3-H3

**Acceptance:**
- Record a cycle goal and baseline.
- Record a daily overall feeling from 1–5, unwanted effects, and optional notes
  across active peptides, with an optional goal-related measurement.
- Review these records alongside actual doses and cycle dates.

### Story ST-6: Track personal supplies and supplements

A researcher can optionally track personal vials and scheduled supplements.

**Commitments:** V5, V7

**Delivers:** P3-H2, P3-H3, P4-H2, P4-H4

**Enables:** P2-H1, P2-H2, P3-H4

**Acceptance:**
- Personal vial tracking is optional and separate from admin inventory.
- Confirmed vial usage reduces estimated remaining contents and supports
  low-stock alerts.
- Supplement tracking is optional and supports schedules, reminders, and Taken
  logging.

### Story ST-7: Maintain the library and guidance

An admin can maintain the peptide library, cycle templates, and internal guidance
available to researchers.

**Commitments:** V2, V7

**Delivers:** P1-H4, P5-H4

**Enables:** P3-H1

**Acceptance:**
- Researchers choose peptides from the library supplied by admins.
- Admin templates provide a starting point for researcher cycles.
- Admins can provide cycling-off and supplement guidance as internal data.

### Story ST-8: Manage business stock and manual sales

An admin can account for vial inventory, purchases, sales, revenue, and gross
profit without exposing business stock to researchers.

**Commitments:** V8

**Delivers:** P5-H1, P5-H2, P5-H3

**Enables:** P1-H4

**Acceptance:**
- Each peptide and vial strength has a separate count of individual vials.
- Admins can record purchases and costs, quantities sold, revenue, and gross
  profit.
- Manual sales can reference a researcher account or an outside buyer.
- Recording a sale neither changes personal inventory nor grants support access.

## Approval and source

Source: Marco's Alpha PR Labs product-definition conversation.

Approved by Marco on 2026-09-09 after the consolidated MVP playback, including
view-only support access lasting until revoked: “yes, this is approved.”

This approval covers the product scope. It does not record an implementation,
deployment, or launch as completed.
