# Alpha PR Labs — Research App Implementation Plan

Status: Product scope, technology stack, operating defaults and the final
interface are approved. This plan was reconciled with the design handoff on
2026-09-25 and awaits Marco's approval of the build map below. No application
slice has started.

Prepared on 2026-09-09. Reconciled with the approved interface on 2026-09-25.

## Approved interface

Marco confirmed on 2026-09-25 that the Claude Design work is complete and ready
to implement. The handoff lives in [`docs/design/research-app/`](../docs/design/research-app/README.md):
the README (tokens, shell, every screen, copy, validation, business rules, data
model and scenarios) and the interactive prototype `Alpha PR Labs App.dc.html`.

- The handoff is high fidelity. Recreate its colors, type, spacing, copy and
  interactions exactly in this codebase's stack. Do not copy prototype code.
- The prototype's grey PROTOTYPE bar, `localStorage` data, simulated latency,
  clock and notifications are test chrome only.
- Screen IDs used below (A1–A8, C1–C2, R1–R11) are the handoff's.
- The handoff's business rules were written for the prototype. Re-derive them
  against this plan's approved defaults and test them; where they differ, this
  plan's approved rules win unless noted in "Handoff reconciliation".
- Build order follows the handoff: the admin side first, then researchers.
  The installation and notification foundation comes before both so it can be
  proven on real phones in week one.

## Authority and outcome

- [Approved product contract and stories](research-app.md)
- [Approved stack and parallel-development requirement](research-app-stack.md)
- [Approved interface handoff](../docs/design/research-app/README.md)

Deliver the complete invite-only research app described by that contract:
independent peptide timelines within a cycle, saved vial calculations, phone
reminders and confirmation, optional supplies and supplements, simple progress,
permission-based support, and separate admin stock and manual accounting.

This document defines implementation boundaries and acceptance evidence. It
does not introduce recommended peptide protocols or expand the approved MVP.
The project remains outside the Dibbly product roadmap.

## Environments

Marco decided on 2026-09-25:

- **Staging is local only.** Local Supabase (Docker) provides Postgres, Auth and
  a captured-email inbox; a local timer calls the reminder dispatcher every
  minute in place of Vercel Cron.
- **Real-phone testing runs on production** while the app is closed to
  researchers. There is no hosted staging environment and no local tunnel.
- **Production stays unlaunched** until Marco declares the app fully ready.
  Provisioning, deployment, production migrations and real sends remain
  explicitly authorized delivery actions (SHIP), requested at each gate below.

## Current code and readiness

Baseline: branch `feat/research-app` at commit `0cb44ea`, based on `main`
`b4e3750`, in `/home/marcomoutinho/personal/alphaprlabs`. The approved
documents and the design handoff are committed there; tracked source is
unchanged from `main`.

The existing application is the public Next.js reference site (Next.js 16.2,
React 19.2, Tailwind 4, shadcn, `lucide-react`). The root layout applies the
public header and footer to every page. There is no private app, authentication,
migration set, reminder worker or app test harness yet. `src/lib/peptides.ts`
is a 3,209-line static content file; keep operational records elsewhere and do
not import unvalidated dosing guidance from its prose.

On 2026-09-25 the host had Docker 29.1.3, Supabase CLI 2.106.0 and Node 22.11.
A working local Supabase stack has not yet been proven; that is part of S1.
Read the installed Next.js guides in `node_modules/next/dist/docs/` before
writing code (AGENTS.md), including `01-app/02-guides/progressive-web-apps.md`.

Parallel readiness is **serial only** until S1–S4 establish the shared base.

## Approved operating defaults

Approved by Marco on 2026-09-09: “yes this works”, in response to the
plain-language defaults for CAD/FIFO accounting, reminder follow-ups, calendar
behavior and syringe markings. This approval resolves D1–D5; it does not itself
start the implementation slices. Detailed implementation refinements remain
part of the proposed execution map.

| Decision | Approved default | Affected work |
| --- | --- | --- |
| D1 — Sales currency | One currency for launch, CAD. Store the currency explicitly; do not mix currencies in a profit total. | Admin purchases and sales |
| D2 — Cost of stock sold | FIFO: allocate each sale against the oldest remaining purchase quantities of that peptide and strength, retaining its cost allocation. | Admin sales |
| D3 — Follow-up window | Two follow-ups, 30 minutes and 2 hours after an unconfirmed dose becomes due. Unconfirmed entries remain open. | Reminder worker |
| D4 — Calendar behavior | Fixed weekdays retain local clock time; elapsed intervals follow actual confirmed injection time. Missed doses do not automatically extend phases. | Schedule engine and cycle editing |
| D5 — Syringe precision | Researchers select the actual syringe marking increment. Unmeasurable amounts are flagged without automatically rounding the intended dose. | Calculator and saved mixtures |

### Implementation refinements in the proposed execution map

Follow-ups stop on confirmation, at phase end, or when the next fixed-day
occurrence becomes due. Each cycle has a named time zone suggested from the
device and confirmed by the researcher. Syringe markings offered are 0.5, 1 and
2 units; the researcher must select the value from their syringe. Use decimal
arithmetic at 40 significant digits and display up to 6 decimal places with an
approximation indicator when needed.

For D4, use the proposed rule of shifting a nonexistent daylight-saving clock time forward by the
gap, and using the earlier instant when a local clock time occurs twice. Store
the resolved timestamp and time zone. An older backdated entry is retained but
does not move the next interval earlier than a newer confirmed entry. Do not silently adopt the phone's new time
zone when someone travels; a researcher can explicitly update future scheduling.

### Routine implementation rules

- A cycle contains peptide plans, each with non-overlapping dated phases.
  A phase carries a dose, schedule mode and parameters, or a break. Templates
  are copied into a researcher-owned revision; later admin edits do not change
  an active cycle. Planned guidance is versioned or snapshotted with its source.
- Fixed-day schedules create distinct occurrences. A rolling schedule retains
  its due occurrence until confirmation, then calculates the next from actual
  time. A late confirmation must not rewind a newer confirmed administration,
  extend an ended phase, restart a finished cycle, or send a burst of historical
  reminders. Past unconfirmed occurrences remain accessible separately from the
  current due work.
- Plan edits preserve prior versions and actual history. Replace only affected
  future occurrences, and invalidate their pending reminders. At confirmation,
  allow the researcher to supply an earlier actual time and actual amount.
  Reject a future actual time. Post-confirmation correction workflows are not
  assumed by the existing scope and must not silently rewrite recorded facts.
- A saved calculation setup is distinct from opting into personal stock
  tracking. It records one peptide, vial strength, liquid added and selected
  syringe capacity/marking increment. An active syringe-unit reminder needs a
  valid setup; incomplete setups remain explicit instead of guessing a value.
  Changing mixtures changes future calculations, not recorded administrations.
- Store amounts as decimal strings at application boundaries. Calculate with
  `decimal.js` and store amounts and monetary values using PostgreSQL exact
  numeric types. Validate finite positive inputs and supported units. Display
  the exact calculated volume and syringe units at defined precision. If the
  requested amount cannot be represented on the selected syringe markings, show
  that limitation rather than silently changing the intended dose. The capacity
  alone does not establish the marking increment. No automatic second syringe
  or dose split is added to the MVP.
- One confirmation request has a stable unique key. Record the actual event,
  optional personal-vial deduction and schedule/queue changes in one database
  transaction. Retrying it returns the recorded result, not another deduction.
  A stock discrepancy must not erase or prevent recording a real administration:
  retain the actual event and explicitly flag the estimated stock discrepancy.
- Personal stock is an estimate. Low-stock indication is based on the next
  planned amount for that tracked vial; it does not pretend to know future usage
  when the plan is incomplete. Admin quantities are whole vials by peptide and
  strength, with purchase records and sales allocations separate from personal
  consumption.
- The approved financial outcome is gross profit: sale revenue minus the cost
  of stock sold. This is not a net-profit calculation for taxes, shipping and
  operating expenses. The administrator enters the vial acquisition cost used
  for stock accounting.
- Record a manual sale atomically with its stock and cost allocations. Reject
  sales exceeding available business stock. Store the original sale price and
  allocated cost so later purchase prices cannot rewrite historical profit.
  Prevent silent alteration of purchases already allocated to sales. Returns,
  refunds and general accounting adjustments need their own scope if requested.
- A progress check-in is one researcher/day record across active peptides.
  Cycle goals and baselines are per cycle; optional measurements include their
  name, unit and timestamp. Present observations beside actual history without
  attributing a result to a particular compound automatically.
- Supplement records reuse the scheduling and confirmation concepts with their
  own user-entered units. They never use the peptide syringe calculator or
  deduct peptide stock.

## Application and data boundaries

Keep the existing public URLs. Refactor the public header/footer into a public
route-group layout, retaining one minimal document root. Put researcher screens
under `/app`, admin screens under `/admin`, and invitation/login/recovery screens
under `/auth`. These are route conventions within the approved Next.js app,
not separate services or deployments.

Use server functions for authenticated commands and explicit API routes for
push subscriptions and the cron dispatcher. Validate identity and authorization
at the data operation, not just at navigation or a layout redirect. Use the
current local Next.js guides for async server APIs, route groups and proxy
conventions, and Supabase's supported SSR client integration.

| Data family | Suggested records | Ownership and invariant |
| --- | --- | --- |
| Accounts and consent | Profiles, app roles, disclaimer acceptance, support grants | Roles are not user-editable. A grant identifies the researcher and permitted admin and can be revoked. Business buyer lookup exposes only the minimum account identity needed to record a sale. |
| Library | Peptide identities, internal guidance, template versions | Researchers can read available library content; only admins maintain it. Admin content edits do not rewrite copied cycle plans. |
| Cycles | Cycles, peptide plans, plan revisions, dated phases | Researcher-owned, with explicit time zone and preserved historical revisions. |
| Vials | Saved mixtures, optional personal stock and usage entries | Researcher-owned; one peptide per vial and mixture snapshots on actual logs. |
| Activity | Scheduled occurrences and confirmed events | Stable IDs distinguish scheduled time, actual time and recorded time. Optional amount/site/observations belong to the actual event. |
| Reminders | Device subscriptions, pending reminder jobs and attempts | Owner-bound subscriptions; server-only queue processing; no implicit dose confirmation. |
| Results | Goals/baselines, daily check-ins, measurement entries | Researcher-owned and readable through explicit active support grants. |
| Supplements | Researcher supplement plans and events | Optional; reuse schedule contracts without borrowing peptide stock or syringe semantics. |
| Business inventory | Peptide-strength stock items, purchases, manual sales, allocations | Admin-only financial records; whole-vial quantities, historical costs, separate from researcher inventory. |

Use tracked SQL migrations and generated database types, without adding an ORM
or another queue service. Introduce domain schemas when their serial data slice
is ready rather than designing every table in one giant foundation change.
Use Supabase RLS for ownership and active support-grant reads, alongside server
authorization. A generic admin role must not bypass researcher consent. Keep
private responses out of shared caches; after revocation, subsequent reads must
be denied. Previously viewed information cannot be recalled from a person's
memory or screenshots.

App administrators are distinct from infrastructure operators with database
credentials. Keep privileged credentials server-only and out of user-facing
requests. Queue access, invitation administration and any privileged routine
need narrowly checked entry points. Database routines must not create an
alternate path around ownership or grant checks.

## Reminder delivery design

Vercel Pro Cron invokes one authenticated dispatcher every minute. PostgreSQL
stores pending work. Each invocation claims a bounded batch using database
locking and expiring leases, rechecks the occurrence/version, and sends through
standard Web Push. Transient failures receive bounded retry attempts; invalid
subscriptions are disabled. A later invocation can recover expired claims.
Failed sends are separate from the researcher-facing follow-up schedule.

Use stable occurrence/version/follow-up/device keys, payload expiry and
notification replacement identifiers to limit duplicates and stale messages.
Recheck before sending after a plan edit or confirmation. Exactly-once visible
push delivery is not guaranteed across network failures; database confirmation
and stock effects must still be idempotent. Record provider acceptance honestly
as a send result, not proof of delivery, viewing, or administration.

Opening a notification loads the current authenticated occurrence and current
calculation. A stale notification cannot confirm an obsolete plan blindly.
In-app due work remains available even if push permission is denied.

Marco decided on 2026-09-25 that the installed app icon shows a badge for the
number of unconfirmed doses where the platform supports it (a count on iPhone;
Android launchers may show only a dot). Update it when reminders arrive and when
the app opens or a dose is confirmed. The badge is a convenience, not a record.

Marco decided on 2026-09-25 that notifications carry no action buttons on any
platform. Tapping a reminder opens or focuses the installed app on that
occurrence's current details, where the researcher confirms with Taken. This
keeps iPhone and Android identical and shows the current dose and syringe units
before confirmation.

## Phone installation requirements

Marco confirmed on 2026-09-25 that the app is used mainly on phones and must
install and behave like a native app on iOS and Android. Required:

- A web app manifest with name, short name, stable `id`, `start_url` opening
  the signed-in home for the role, standalone display, `#050505` theme and
  background colors, and 192/512 px icons plus maskable variants from the logo.
- iOS home-screen support: a 180 px Apple touch icon, standalone and status-bar
  metadata, and `viewport-fit=cover`. Honor safe-area insets on the header,
  bottom tab bar, bottom sheets and toasts so nothing sits under the notch or
  home indicator.
- Installation detection in C2 and notification settings using standalone
  display mode. On Android and other supporting browsers, offer a one-tap
  install action from the browser install prompt; on iPhone, show the Share →
  Add to Home Screen steps from the design.
- Web Push requires iOS/iPadOS 16.4 or later on a home-screen app. Show the
  designed unsupported state elsewhere.
- Re-check and re-register the device's push subscription each time the app
  opens, because iOS can drop subscriptions without notice. Upsert per device
  endpoint; disable endpoints the push service rejects as gone.
- The service worker handles install, push display, notification clicks and the
  app badge. It does not cache authenticated pages or private history.
- Acceptance happens on real iPhone and Android devices against the closed
  production deployment, not desktop emulation. The PWA
service worker handles installation/push and does not introduce offline writes
or caches of private researcher histories.

Provide a dispatcher enable/disable configuration and observable last successful
run/failure information using the existing host logs and database records. Keep
real push sends disabled in local automated tests. No new operational dashboard
is implied. Vercel documents missed or duplicate cron calls, no automatic retry
of failed invocations, and that rollback does not automatically restore cron
configuration; explicitly reconcile the dispatcher during deployment/rollback.
See [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Handoff reconciliation

The handoff and the approved plan were compared on 2026-09-25. These rulings
apply to the build:

1. **Invitations are app-managed.** The handoff requires 30-day invitations
   with Pending/Accepted/Expired/Send failed states and a Resend button. Supabase's own
   email links are short-lived, so the app stores its own invitation record and
   single-use token, sends the email itself through SMTP (Postmark in
   production, the local captured inbox in staging), and creates the Supabase
   account server-side on acceptance. Password recovery stays with Supabase
   Auth through the same Postmark SMTP.
2. **Unconfirmed every-N-days doses.** Follow the handoff: the next dose falls N
   days after the previous dose's actual time, or its planned time if it was
   never confirmed. The unconfirmed dose stays open (V3). An older backdated
   confirmation does not move the schedule earlier than a newer confirmed dose.
3. **Syringe markings.** The calculator preselects the handoff's default line
   spacing per capacity (100 → 2, 50 → 1, 30 → 0.5 units), which the researcher
   can change or mark unknown. This satisfies D5; nothing is ever rounded.
4. **Installation detection replaces "I've added it".** The prototype simulates
   installation with a link. Production detects the installed app
   automatically, so the link is dropped; all other C2 copy stays.
5. **iPhone sign-in after installing.** An iPhone home-screen app does not share
   Safari's session. After someone installs, first opening the app shows sign-in,
   then routes to C2 if reminders are off on that device.
6. **Tab bar icons** use Lucide at 20 px (already a dependency). Handoff open
   decision 4 resolved.
7. **Open decisions kept out of the MVP**, per the handoff: cancelling a pending
   invitation, and correcting or voiding recorded purchases and sales. Real
   library text is admin-entered content and does not block the build.

8. **Admins are researchers** (Marco, 2026-09-26; supersedes the handoff's
   separate roles). The admin role adds the back office to a full researcher
   account. The app opens on the research side (Today); the account menu gets
   an "Admin" item that switches to the admin navigation, and the admin side's
   menu offers "My research" to switch back. Admins pass the same researcher
   acknowledgement before using research features and can turn on reminders.
   Researcher-only rules in the database and server become "researcher or
   admin" for the caller's own records; admin-only rules are unchanged; support
   grants still apply to other researchers' history. Built as slice S3.2.

## Build phases

Every slice is **local BUILD only** in this repo, using Slipstream with one
maker and an independent review. None authorizes a push, hosted resource
creation, deployment, real invitations, or customer exposure. Gates G1–G3 are
separate SHIP actions that need Marco's explicit authorization when reached.

Each slice keeps one bounded outcome. Paths named are ownership proposals, not
instructions to fill every folder. Inventory file growth before review and
reslice before starting if a slice cannot stay independently reviewable. Avoid
production files over 500 lines. Proof estimates assume the tools are ready;
one-time package, browser and local database setup is budgeted at 15–30 minutes
inside S1.

GUARDED means the slice handles authentication, privacy, actionable
calculations, outbound messages, schemas or financial integrity. It does not
activate Smith/Crucible.

### Phase 1 — Foundation and phone proof

#### S1: App shell, design system and local tooling

**Outcome:** The public site keeps its URLs and look; private `/auth`, `/app`
and `/admin` areas render the handoff's app shell on desktop and phone.
**Screens:** shell only (desktop header and account menu, phone header and
bottom tab bar with Lucide icons, toasts, bottom sheets, saving and error
patterns). **Risk:** STANDARD.

**Owns:** layouts and route groups, design tokens and Inter, shared shell and
form primitives, safe-area handling, npm files and pinned supporting libraries
(Supabase client/SSR, `web-push`, `decimal.js`, `@js-temporal/polyfill`, Zod,
Vitest, Playwright), local Supabase configuration, environment-variable names
(never values), and the test entry points.

**Proof:** public routes still render; both shells match the handoff at phone
and desktop widths, including safe areas; one unit check, one browser check and
a local database connection pass. **5–10 min.**

#### S2: Accounts, invitations and sign-in (C1, A1)

**Outcome:** The admin invites a researcher; the researcher accepts within 30
days, sets a password, acknowledges the disclaimer, signs in, recovers access
and signs out. **Risk:** GUARDED.

**Owns:** roles and profiles, the invitation table and token flow, SMTP sending
(captured locally), controlled admin bootstrap, C1 screens (invitation states,
account setup, acknowledgement, sign in with session-expired notice, uniform
recovery confirmation) and the A1 Invitations screen with its Resend button.

**Proof:** valid, expired and used invitations; duplicate and existing-account
errors; send failure then resending; direct signup and self-assigned admin role
rejected; recovery never reveals whether an email exists. **5–10 min.**

#### S3: Installable app and notifications (C2)

**Outcome:** A signed-in person can install the app and turn on reminders for
this phone; a test notification arrives, sets the icon badge and opens the app
when tapped. **Risk:** GUARDED.

**Owns:** everything in "Phone installation requirements": manifest and icons,
iOS metadata, service worker (push display, notification click, badge), install
detection and the Android install action, C2 step 3 and the Notifications
settings screen, the per-device subscription table and API, re-registration on
every open, VAPID configuration, and an admin-only "send test notification"
action to the signed-in person's own devices.

**Proof:** subscribe/unsubscribe are owner-bound; re-registration updates the
device row; the denied, unsupported and iPhone-not-installed states match the
design; private pages are not cached by the service worker. Local browser proof
**5–8 min.** Real delivery is proven at G1, not claimed locally.

#### S3.2: Admins are researchers

**Outcome:** An admin account has every researcher capability plus the back
office, per Handoff reconciliation item 8. **Risk:** GUARDED (authorization).
**Owns:** role checks in routes, server actions and database functions for the
caller's own records; role-aware home and account-menu switch between the
research and admin navigations. **Proof:** an admin can acknowledge, open
`/app`, turn on reminders and use the test notification; an admin still cannot
read another researcher's private records without a grant; researchers still
cannot reach `/admin`. **5–10 min.**

#### Gate G1: Closed production phone proof (SHIP, needs authorization)

Provision production (Vercel Pro, Supabase Pro, Postmark with a verified sending
domain, the app domain), apply migrations, deploy the S1–S3 candidate closed to
everyone except Marco's test accounts, and disable real reminder dispatch.

Marco, on a real iPhone (iOS 16.4+) and a real Android phone: receive an
invitation email, accept, install to the home screen, sign in inside the
installed app, turn on reminders, receive a test notification with the app
closed, see the badge, and tap through into the app. **15–30 minutes hands-on**,
excluding account approval and DNS time. Postmark account approval may take
time; start it before G1. Failures here reopen S3 before admin work continues.

### Phase 2 — Admin side

#### S4: Peptide library (A2) and support-grant foundation

**Outcome:** The admin maintains library entries with availability and
guidance; the private-data ownership and revocable-grant rules exist for all
later researcher tables. **Risk:** GUARDED.

**Owns:** library schema and A2 two-pane editor; grant schema with history,
reusable ownership/grant access rules and their database tests. Researcher
library screens (R6) come in S10.

**Proof:** admin create/edit, availability toggle and reference count; the
incomplete-information error; researchers read only available entries; two
researchers and a non-granted admin are isolated at the database and server.
**5–10 min.**

#### Group A (two makers in parallel)

**Lane A — S5: Business inventory and FIFO sales, then S6: screens.**

- *S5 outcome:* stock items per peptide and strength, purchases, and sales that
  atomically freeze their FIFO allocation, revenue and cost. Rejects oversell
  and duplicate submission. Admin-only. **Risk:** GUARDED (money/stock).
  **Owns:** inventory and sales schema, transactions and database tests.
  **Proof:** the handoff FIFO scenario (10 × 20, 10 × 25, sell 12 × 40 → revenue
  480, cost 250, gross profit 230, 8 left; outside buyer for 9 → blocked),
  concurrent sales cannot oversell, later purchases never change past profit,
  researchers cannot read any of it. **7–10 min.**
- *S6 outcome:* A4 Inventory and Stock item, A5 Record purchase, A6 Record sale
  with live preview, A7 Sales & gross profit with filters, exactly as designed.
  **Risk:** GUARDED (money). **Owns:** those routes and UI only; no schema.
  **Proof:** browser journey through the FIFO scenario and every empty state.
  **5–8 min.**

**Lane B — S7: Schedule engine and calculator math.** Pure domain modules with
unit tests and no schema, UI or package changes. **Risk:** GUARDED (timing and
actionable calculation). **Proof:** fixed weekdays, every-N-days after late and
missed doses, breaks, dose changes, DST gaps and repeats, older backdated
confirmations; calculator concentration, volume and units, between-line and
over-capacity flags, unknown marking, dose over whole vial, invalid inputs.
**5–8 min.**

Common base: S1–S4 reviewed and integrated. Lane A owns all schema changes in
this group; Lane B touches no shared files. Integrate S7, then S5 and S6.

#### S8: Cycle templates (A3)

**Outcome:** The admin creates and edits templates with per-peptide active
phases and breaks in relative days, validated as designed. **Risk:** STANDARD.
**Owns:** template schema (relative offsets) and the A3 editor. Uses S7 for
validation of schedules. Copying into researcher cycles comes in S9.
**Proof:** every validation message in order with `(+N more)`; unavailable
peptides blocked; edits bump "updated". **5–8 min.**

### Phase 3 — Researcher side

#### S9: Cycles and the cycle builder (R2, R3, R4 data)

**Outcome:** Researchers create custom cycles or copy a template, with a named
time zone, goal, optional baseline and independent dated phases per peptide;
editing a cycle with history changes future doses only. **Risk:** GUARDED.
**Owns:** cycle schema with preserved plan revisions, template copy, R3 builder.
**Proof:** multi-peptide cycle saved; template edited later leaves the copy
unchanged (handoff scenario); another researcher's cycle is unreachable.
**5–10 min.**

#### Group B (two makers in parallel)

- **Lane A — S10: Cycle views and library reading (R2, R4, R6).** Cycles list
  with statuses, cycle detail with the per-peptide timeline and dose markers,
  library and template detail with "Use as starting point" (blocked for
  unavailable peptides). No schema. **5–8 min.**
- **Lane B — S11: Calculator and saved mixtures (R7).** Mixture and optional
  personal-vial schema, the calculator screen on S7's math, and Save mixture
  linked to cycle peptides.
  Owns all schema changes in this group. **5–8 min.**

Common base: S9 integrated. Integrate S11, then S10.

#### S12: Today and dose confirmation (R1, R5)

**Outcome:** Today shows the due dose with mg and syringe units, unconfirmed
past doses and upcoming doses; one tap confirms Taken, or the sheet records
amount, earlier time, site and notes. **Risk:** GUARDED (history and stock).
**Owns:** occurrence and actual-dose schema, the single confirmation
transaction (idempotent, next-dose recalculation, optional personal-vial
deduction, reminder invalidation), and the R1 and R5 screens.
**Proof:** retrying a confirmation records one dose and one deduction; a future
time is rejected; a backdated every-N-days dose moves the next due time; fixed
weekdays stay put; old unconfirmed doses remain actionable. **7–10 min.**

#### Group C (two makers in parallel)

- **Lane A — S13: Reminder dispatcher and follow-ups.** Queue with leases and
  attempts, the authenticated dispatcher route, `vercel.json` cron, the local
  timer script, follow-ups at 30 minutes and 2 hours with the approved stop
  rules, payloads naming the peptide, mg and syringe units, stale-reminder
  suppression, badge count of unconfirmed doses, and the send on/off control.
  Owns all schema changes in this group. **Risk:** GUARDED. **Proof:**
  duplicate and missed timer calls, an interrupted claim, a transient failure
  and a gone subscription, with a controllable clock and transport against
  local Postgres. **7–10 min.**
- **Lane B — S14: Personal supplies (R8).** Optional vials linked to mixtures,
  estimated remaining from confirmed doses, low-stock indication. Uses the
  personal-vial table created in S11; no schema. **5–8 min.**

Common base: S12 integrated. Integrate S14, then S13.

#### S15: Progress (R9)

**Outcome:** One daily check-in (feeling 1–5, side effects, note) and an
optional measurement, shown beside doses and phases. **Risk:** GUARDED.
**Owns:** results schema under the S4 access rules and the R9 screens.
**5–10 min.**

#### S16: Supplements (R10)

**Outcome:** Optional supplement routines with reminders and Taken, reusing the
schedule engine, confirmation pattern and dispatcher; no syringe conversion or
peptide stock. **Risk:** GUARDED. **5–8 min.**

#### S17: Me, support access and the full support history (R11, A8)

**Outcome:** Researchers see their profile, grant or revoke read-only access
with confirmation and grant history, and sign out; the admin's A8 Support list
and read-only researcher history show every in-scope record when granted and
the designed denied states otherwise. **Risk:** GUARDED (private records).
**Proof:** handoff support scenario end to end; write attempts denied; revoke
denies the next request at server and database; financial records and push
secrets never appear. **6–10 min.**

### Phase 4 — Delivery

#### Gate G2: Closed production full proof (SHIP, needs authorization)

Deploy the assembled, reviewed candidate closed to researchers, apply
migrations, enable the dispatcher, and verify on Marco's real phones: a real
cycle produces a reminder at the due minute with the app closed, follow-ups
arrive if unconfirmed, tapping opens the dose, Taken stops follow-ups and
updates the badge, and a supplement reminder works. Also verify invitation and
recovery emails, and the admin purchase and sale path. **30–45 minutes
hands-on.**

#### Gate G3: Launch (SHIP, needs authorization)

Only when Marco declares the app fully ready: open invitations to researchers.
Rollback disables sends first and checks cron configuration explicitly.

## Parallel schedule and ownership

At most two makers at once, each in its own worktree based on the same
reviewed, integrated commit. Main integrates in the stated order. Reviews use
fresh independent contexts.

| Group | Concurrent lanes | Common base | Schema owner | Rejoin proof |
| --- | --- | --- | --- | --- |
| A | S5→S6 inventory and sales / S7 domain engines | S1–S4 | Lane A | Admin routes and role boundaries still pass after integrating both |
| B | S10 cycle views / S11 calculator and mixtures | S9 | Lane B | Build cycle → save mixture → cycle detail shows the saved mixture |
| C | S13 dispatcher / S14 personal supplies | S12 | Lane A | Due reminder → tap → Taken → supply balance drops once, follow-ups stop, badge updates |

In every pair only the named schema owner may add migrations or regenerate
database types. Neither lane may add packages or change a shared contract to
finish its work; that returns the work to serial integration. A pair starts
only after Main confirms its common base is integrated, its owned paths are
disjoint and nothing else owns them.

The critical path is S1 → S2 → S3 → G1 → S4 → S5/S6 → S8 → S9 → S11 → S12 → S13
→ S15 → S16 → S17 → G2. S7 finishes well inside Group A's window and is needed
before S8. No calendar date is promised until the first slices establish real
throughput.

## Build execution map

Feature: Alpha PR Labs research app MVP. Mode: BUILD (local only), with SHIP
gates requested separately. Repository: `/home/marcomoutinho/personal/alphaprlabs`,
branch `feat/research-app`.

| Order | Slice | Screens | Depends on | Risk | Decisive proof | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | S1 App shell, design system, tooling | Shell | Plan approval | STANDARD | Public routes intact; shell matches design; local DB works | 5–10 min |
| 2 | S2 Accounts and invitations | C1, A1 | S1 | GUARDED | 30-day invite states; signup and self-admin blocked | 5–10 min |
| 3 | S3 Install and notifications | C2 | S2 | GUARDED | Owner-bound device subscriptions; install/permission states | 5–8 min |
| G1 | Closed production phone proof | — | S3 | SHIP | Real iPhone and Android: install, notify closed, badge, tap opens | 15–30 min |
| 3b | S3.2 Admins are researchers | Shell, C1, C2 | S3 | GUARDED | Admin uses research side and reminders; grants still required for others | 5–10 min |
| 4 | S4 Library and grant foundation | A2 | G1 | GUARDED | Admin library; cross-user isolation | 5–10 min |
| 5A | S5 → S6 Inventory, FIFO sales, screens | A4–A7 | S4 | GUARDED | Handoff FIFO scenario; no oversell | 12–18 min |
| 5B | S7 Schedule engine and calculator math | — | S4 | GUARDED | Schedule and calculation cases | 5–8 min |
| 6 | S8 Cycle templates | A3 | S7 | STANDARD | Validation order; unavailable peptides blocked | 5–8 min |
| 7 | S9 Cycles and builder | R3 | S8 | GUARDED | Template copy unchanged by later edit; ownership | 5–10 min |
| 8A | S10 Cycle views and library | R2, R4, R6 | S9 | GUARDED | Statuses, timeline, starting-point rules | 5–8 min |
| 8B | S11 Calculator and mixtures | R7 | S9 | GUARDED | Saved mixture reproduces calculation | 5–8 min |
| 9 | S12 Today and confirmation | R1, R5 | S10, S11 | GUARDED | One dose, one deduction on retry; schedule rules | 7–10 min |
| 10A | S13 Reminder dispatcher | — | S12 | GUARDED | Duplicate/missed calls, retries, stale suppression | 7–10 min |
| 10B | S14 Personal supplies | R8 | S12 | GUARDED | Estimated balance and low stock | 5–8 min |
| 11 | S15 Progress | R9 | S12 | GUARDED | Check-ins beside doses; isolation | 5–10 min |
| 12 | S16 Supplements | R10 | S13 | GUARDED | Reminder and Taken without peptide stock | 5–8 min |
| 13 | S17 Me and support history | R11, A8 | S14–S16 | GUARDED | Grant, read-only history, revoke denies | 6–10 min |
| G2 | Closed production full proof | — | S17, cumulative gate | SHIP | Real reminders on real phones end to end | 30–45 min |
| G3 | Launch | — | G2, Marco's go | SHIP | Invitations open | — |

Seventeen local slices, three parallel pairs, three delivery gates.

## Verification envelope and feature close

Use Vitest for calculation and schedule logic, local Supabase/Postgres tests
for transactions and access rules, and Playwright for user journeys at phone
and desktop widths. Do not use mocked database access as proof of privacy or
stock accounting. Vitest does not exercise async Server Components; use browser
journeys there (see `node_modules/next/dist/docs/01-app/02-guides/testing/`).

Keep fixtures small: two researchers, two admins, a minimal catalog, one
fixed-weekday and one every-N-days plan, two differently priced purchases, and
the handoff's scenario data. Use synthetic values, not protocol
recommendations. One shared clock seam and one mock push transport; at most one
focused unit/DB file and one or two browser specs per slice.

Before G2, run one cumulative gate on the exact assembled candidate:

1. Invitation → acknowledgement → template or custom cycle → saved mixture →
   due reminder payload → confirmation → next interval, supply balance and badge
   → progress history, with unchanged fixed weekdays and an open old dose.
2. Purchase → sale → strength-specific stock and historical gross profit,
   without touching researcher supplies or access.
3. Grant → admin reads the full history → revoke → next request denied,
   including results and supplement tables.
4. A supplement reminder and confirmation stay separate from peptide stock.
5. Typecheck, lint, production build and a public-route smoke check.

Budget **20–30 minutes** once the environment is ready. Desktop emulation never
counts as phone proof; G1 and G2 do.

## Production readiness

The app's production address is `app.alphaprlabs.com` (Marco, 2026-09-25).
The public reference site stays on its own domain. One codebase serves both:
on the app host, `/` routes to the signed-in home and public pages redirect to
the public site; the manifest, service worker and cookies belong to the app
host only, so installation and notifications never involve the public site.
S1 sets up this host routing locally.

Hosting plans (Marco, 2026-09-26): G1 runs on the free Supabase and Vercel
plans. Before G2 and launch, upgrade Marco's personal Vercel account to Pro
(US$20/month; the app records sales and profit, which Vercel's Hobby terms treat
as commercial, and Pro runs the reminder cron every minute) and the Supabase
project to Pro (US$25/month; no pausing, daily backups). The public reference
site sells nothing and may stay alongside the app in the same account. Postmark
is set up on `alphaprlabs.com` with DKIM, Return-Path and a monitor-only DMARC
record.

Before G1, Marco provides or approves: DNS for `app.alphaprlabs.com`,
Vercel Pro and Supabase Pro projects, and a Postmark account with a verified
sending domain (Postmark reviews new accounts before they can send to outside
recipients). Keep production data separate from local data, keep privileged
credentials server-only and out of logs, and confirm invite/recovery redirects,
backups, the cron schedule and the send on/off control.

Vercel documents missed or duplicate cron calls, no automatic retry of failed
invocations, and that rollback does not restore cron configuration; reconcile
the dispatcher explicitly on every deploy and rollback. Rolling back app code
does not reverse schema changes. Preserve recorded history and stock ledgers.

## Coverage

| Commitment | Slices |
| --- | --- |
| V1 — Access, privacy, installable app | S2, S3, S4, S17, G1, G2 |
| V2 — Flexible cycles | S7, S8, S9, S10, S12 |
| V3 — Reminders and logging | S3, S7, S12, S13, G1, G2 |
| V4 — Saved calculator | S7, S11, S12, S13 |
| V5 — Optional personal stock | S11, S12, S14 |
| V6 — Progress | S15 |
| V7 — Guidance and supplements | S4, S8, S16 |
| V8 — Admin inventory and finances | S5, S6 |

Every approved story remains in the product contract. Nothing approved is
silently deferred. MVP exclusions remain those in the product contract plus the
two handoff open decisions kept out above.

## Progress and next decision

D1–D5 approved 2026-09-09. Interface approved 2026-09-25 with the environment,
Postmark, badge and notification-tap decisions recorded above. No application
slice is active, built, reviewed, deployed or live.

Next: Marco approves this build map (seventeen local slices, groups A–C, and
the proof budgets). Approval starts S1 locally. Gates G1–G3 each need their own
authorization when reached.

## Technical references

- [Supabase tracked migrations and local development](https://supabase.com/docs/guides/local-development/database-migrations)
- [Supabase server-rendered client integration](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [Decimal.js API](https://mikemcl.github.io/decimal.js/)
- [Temporal polyfill](https://github.com/js-temporal/temporal-polyfill)
- [Vercel cron failure, concurrency and rollback behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

The supporting-library selection above is an implementation recommendation
within the approved TypeScript stack. Exact compatible versions are pinned at
setup and must not be changed independently by parallel makers.
