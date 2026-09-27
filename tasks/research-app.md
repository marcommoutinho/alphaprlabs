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
