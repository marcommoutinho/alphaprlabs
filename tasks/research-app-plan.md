# Alpha PR Labs — Research App Implementation Plan

Status: Product scope, technology stack and operating defaults are approved.
Interface design is now the next stage, before any application implementation.
The local BUILD map below is a deferred, unapproved proposal that must be
reconciled with the approved interface. Implementation and deployment remain
unstarted.

Prepared on 2026-09-09.

## Interface-first instruction — 2026-09-11

Marco requires the UI/UX to be designed in Claude Design before application
implementation. The [requirements-only brief](../../../development/docs/design/alpha-pr-labs/research-app-brief.md) is
the next handoff. It supplies requirements, workflows, functional areas, data,
permissions and states, leaving design decisions to Claude Design.

Start with finished design concepts, with no wireframes. Marco chooses and
locks one concept before building out the interactive app prototype. That
prototype must let him navigate researcher and admin workflows, enter data,
perform main actions and see state changes as if the app were live. Use
realistic sample data and identify simulated backend/notification behavior in
the handoff. Static screens or disconnected mockups are insufficient. This
design prototype is separate from production application implementation.

Review and approve the resulting interactive interface. Then reconcile the proposed
slices, screen responsibilities, shared UI boundaries and parallel groups with
the approved handoff. The existing route/layout/component proposals below are
provisional implementation ideas, not constraints for the designer. Do not
start backend, frontend, schema, tooling or other application implementation
under the earlier build-approval request. No build map has been approved.

The approved product scope and stack remain in force. This instruction changes
the order of work and supersedes earlier statements that build-map approval is
the immediate next action. Continue with design preparation only until that
stage is complete.

## Authority and outcome

- [Approved product contract and stories](research-app.md)
- [Approved stack and parallel-development requirement](research-app-stack.md)

Deliver the complete invite-only research app described by that contract:
independent peptide timelines within a cycle, saved vial calculations, phone
reminders and confirmation, optional supplies and supplements, simple progress,
permission-based support, and separate admin stock and manual accounting.

This document defines implementation boundaries and acceptance evidence. It
does not introduce recommended peptide protocols or expand the approved MVP.
The project remains outside the Dibbly product roadmap.

## Current code and readiness

Baseline: `main`, commit `b4e375098979adfd547aa90d998bb84dd72d36a1`, at
`/home/marcomoutinho/personal/alphaprlabs`. One Git worktree was visible. The
approved `tasks/` documents were untracked; tracked source was clean.

The existing application is a public Next.js reference site. Its React,
TypeScript, Tailwind and shadcn foundation remains the approved stack. The new
interface and its visual decisions will come from the design handoff. The root
layout currently applies the public header and footer to every page. There is
no established private app, authentication, database migration set, reminder
worker, or app test harness to extend.

Known likely shared boundaries: root layout (37 lines), home page (232 lines),
global CSS (159 lines), package files, and routing. `src/lib/peptides.ts` is a
3,209-line static content file. Keep new operational records and behavior in
separate modules; do not grow that file into the app's database or protocol
engine. Import reviewed peptide identities for the private catalog, not
unvalidated schedules or dosing guidance extracted from public prose.

The existing npm scripts provide development, build, start and lint commands.
Node and npm are present. Local database verification is not established:
Docker socket access was denied in this sandbox, and the global `supabase`
command failed while trying to write telemetry outside its writable area.
Use a project-pinned supported CLI during setup; do not infer that an installed
command name proves a working database environment. No app tests, migration
tests, production build, hosted checks, or real-device push tests were run for
this planning task.

One fresh read-only mapper independently returned **DECISION NEEDED**: the stack
and implementation shape are viable, but operating rules and proof prerequisites
need resolution before an executable map. The current code findings above were
confirmed by that inspection. There was no existing map to reuse. Marco has
now approved D1–D5 below. The remaining environment checks belong to the first
setup slice and hosted proof; they have not been reported as passed.

Current parallel readiness is **serial only**: the shared contracts do not yet
exist in code. The groups below become candidates only after their named common
base and interfaces exist and have passed review. Do not launch parallel makers
from this greenfield baseline.

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

## Proposed phases

Every slice below is proposed **local BUILD only** in the Alpha PR Labs repo,
using Slipstream with one maker and an independent review. None authorizes a
push, hosted resource creation, deployment, real invitations, or customer
exposure. Product defaults are approved; the complete execution map needs approval first.

Each slice must keep one bounded outcome. The likely path families below are
ownership proposals, not instructions to build every possible file in a folder.
Inventory actual file growth before review. Reslice before starting if a scope
cannot remain independently reviewable. Avoid introducing production files over
500 lines or growing an already-large file with a new responsibility without
the workspace's required boundary justification.

Targeted proof estimates assume tools and local services are ready. Tests named
below are planned additions, not existing or completed tests. One-time package,
browser and local database setup may take 15–30 minutes and is budgeted
separately from repeated slice proof.

### Phase 1: Private app foundation — proposed

#### P1-H1: Establish application boundaries and local proof tools

**Outcome:** The public site and private app/auth/admin shells have separate
layouts without changing public URLs; a reproducible local verification setup
can run. **Vision:** enables V1–V8. **Depends on:** plan approval and local tool
access. **Risk:** STANDARD.

**Owns:** root/public/private layouts, route moves, npm files, test configuration,
shared minimal contracts, Supabase local configuration, environment-variable
names (never credentials), and common UI/navigation slots. Install and pin
compatible Supabase client/SSR/CLI, Web Push, decimal, time-zone, validation and
test dependencies once. Use `decimal.js`, `@js-temporal/polyfill`, Zod, Vitest
and Playwright as proposed supporting libraries, validating compatibility first.

**Acceptance/proof:** Public home/library/detail URLs still render; isolated app
and admin shells resolve; a pure unit check, one browser route check and a local
DB connection work. No fake auth or private-data endpoints are exposed.
**Proof cost:** 5–10 minutes after the one-time setup budget. No future domain
schemas or general-purpose test framework are included.

#### P1-H2: Invitation, account and researcher acknowledgement flow

**Outcome:** An invited person can accept, acknowledge the disclaimer, sign in,
recover access and sign out; an admin can issue an invitation through the app.
**Vision:** V1. **Depends on:** P1-H1. **Risk:** GUARDED (authentication).

**Owns:** `src/features/auth/`, `src/app/auth/`, identity migrations and
`src/lib/supabase/`/session helpers. Account creation is invitation-only; local
email capture substitutes for real Postmark sends during BUILD. Record disclaimer
version and acceptance time. Initial admin creation is a controlled setup step,
not a public role-selection form.

**Acceptance/proof:** Valid/invalid invite and recovery journeys, direct signup
rejection, and inability to assign oneself an admin role. Browser plus local
Auth/database checks, **5–10 minutes**. Final hosted email delivery is release
proof, not simulated as complete here.

#### P1-H3: Researcher ownership and revocable support permission

**Outcome:** Personal records have one reusable permission boundary; researchers
can grant/revoke named admin read access through a settings screen.
**Vision:** V1. **Depends on:** P1-H2. **Risk:** GUARDED (private records).

**Owns:** `src/features/access/`, support-grant migrations/policies,
`src/app/app/settings/`, reusable subject authorization and access fixtures.
Future personal tables must adopt these checked ownership/grant rules.

**Acceptance/proof:** Two researchers and two admins demonstrate isolation,
explicit grant, read-only access, denial to the other admin, and denial on a new
read after revocation. Direct database and server requests must agree.
**Proof cost:** 5–10 minutes. Full support-history presentation comes in P5-H5.

#### P1-H4: Admin peptide catalog and internal guidance

**Outcome:** Admins maintain the supplied peptide identities and guidance;
researchers can choose/read the available entries. **Vision:** V2, V7.
**Depends on:** P1-H3. **Risk:** GUARDED (schema and access policies).

**Owns:** `src/features/library/`, library migrations,
`src/app/admin/library/`, and researcher library selection/read components.
Keep public static reference content separate and preserve stable identity
mapping. Templates are implemented after the cycle schema exists.

**Acceptance/proof:** Admin create/update/archive and researcher read-only
selection; referenced archived identities still resolve in history. An edited
guidance record has a durable version. **Proof cost:** 5–8 minutes.

### Phase 2: Calculation, scheduling and push primitives — proposed

#### P2-H1: Vial calculation and syringe display

**Outcome:** Given one peptide's vial strength, liquid added and intended dose,
the researcher can see exact volume and syringe units with capacity and marking
validation. **Vision:** V4. **Depends on:** P1-H1, P1-H2, P1-H4 and the agreed
calculation interface and approved D5. **Risk:** GUARDED (actionable calculation).

**Owns:** `src/features/calculator/`, `src/app/app/calculator/`, calculator unit
and browser tests. Reads shared decimal input contracts; owns no migrations,
package files, global UI or scheduling code.

**Acceptance/proof:** Independent arithmetic examples, invalid/zero/non-finite
inputs, unit conversion, capacity overflow and unrepresentable markings; the
display and server calculation agree. Saved-mixture use comes in P4-H2.
**Proof cost:** 3–6 minutes. **Candidate pair:** P2-H2.

#### P2-H2: Independent peptide timelines and occurrence calculation

**Outcome:** A deterministic engine resolves phases, breaks, fixed weekdays and
elapsed intervals from supplied plans and actual history. **Vision:** V2, V3.
**Depends on:** P1-H1 and approved D4. **Risk:** GUARDED (timing).

**Owns:** `src/features/scheduling/`, scheduling contracts specific to this
module and isolated clock/time-zone fixtures. No migrations, calculator imports,
package edits or shared fixture changes.

**Acceptance/proof:** A fixed-weekday plan, a rolling plan after late logging,
a planned increase, a break, DST transitions and an older confirmation after a
newer one produce the agreed future schedule without rewriting actual history.
Use a small explicit set of clock cases, not an exhaustive calendar harness.
**Proof cost:** 3–6 minutes. **Candidate pair:** P2-H1.

#### P2-H3: Installable app and owner-bound push subscription

**Outcome:** A signed-in researcher can install the app, enable/disable push and
receive a test notification through a registered device subscription.
**Vision:** V1, V3. **Depends on:** P1-H3. **Risk:** GUARDED (private push data).

**Owns:** `src/features/push/`, `src/app/api/push/`, manifest, icons/service worker,
push-subscription migration and generated types. This is serial shared-state
work. Scope service-worker control to the app where practical.

**Acceptance/proof:** Ownership of subscribe/unsubscribe operations; private
content absent from offline caches; notification opens an authenticated app
route. Local transport mock and browser registration proof: **5–8 minutes**.
Physical iPhone/Android delivery requires the separate early hosted proof below.

### Phase 3: Durable cycles, vials and reminders — proposed

#### P3-H1: Store versioned cycles and template snapshots

**Outcome:** Authorized server commands save custom cycles and admin templates,
copy templates, and revise future phases without altering prior plan versions.
**Vision:** V2. **Depends on:** P1-H4, P2-H2. **Risk:** GUARDED (plan integrity).

**Owns:** `src/features/cycles/server/`, `src/features/templates/server/`, their
schema/RPC migrations, generated types and direct contract tests. Freeze cycle
read/write and template-copy interfaces for later screens.

**Acceptance/proof:** Save a multi-peptide cycle with independent phases; copy a
template, change the source and retain the copy; reject another researcher's
write. Verify the persistence contract against local Postgres.
**Proof cost:** 5–10 minutes. Builder UI comes in P4-H1; template UI in P5-H4.

#### P3-H2: Save mixture profiles and optional personal vial stock

**Outcome:** The researcher can persist a mixture independently of opting into
personal stock; a cycle peptide can reference the appropriate setup.
**Vision:** V4, V5. **Depends on:** P2-H1, P3-H1. **Risk:** GUARDED (calculation
and private data).

**Owns:** `src/features/vials/server/`, vial/mixture migrations and generated
types. Freeze read/save/selection interfaces and the transaction helper used by
confirmation. No business inventory mutation path.

**Acceptance/proof:** Save/reload a mixture and reproduce its calculation; reject
a foreign or incompatible peptide vial; changing a mixture retains its earlier
version. Optional stock tracking can remain disabled. **Proof cost:** 5–8 minutes.

#### P3-H3: Confirm actual administrations and update derived state once

**Outcome:** One transaction records an actual dose, optional vial consumption,
and the resulting next occurrence and reminder invalidations. Plan edits retain
actual history while reconciling affected future occurrences. **Vision:** V2–V5.
**Depends on:** P3-H1, P3-H2, P2-H2. **Risk:** GUARDED (history and stock integrity).

**Owns:** `src/features/administrations/server/`, occurrence/event/queue schema,
the confirmation and reconciliation routines, and related generated types.
This slice owns the shared transaction and invalidation contract; later UIs and
the dispatcher consume it without duplicating these rules.

**Acceptance/proof:** Concurrent/retried confirmation produces one event and one
deduction; actual amount/time overrides affect the result; stale or unauthorized
requests fail; a new plan preserves old actual/unconfirmed history and cancels
only affected future reminders. Include the defined stock-discrepancy path.
**Proof cost:** 7–10 minutes. Keep dispatcher/network delivery out of this slice.

#### P3-H4: Dispatch due reminders and bounded follow-ups

**Outcome:** The server processes due work with retry tracking and sends current
mg/syringe-unit reminders without interpreting sends as Taken confirmations.
**Vision:** V3, V4. **Depends on:** P2-H3, P3-H3 and approved D3.
**Risk:** GUARDED (wrong/stale reminder consequences).

**Owns:** `src/features/reminders/`, `src/app/api/internal/reminders/route.ts`,
`vercel.json`, queue lease/attempt additions and targeted dispatcher fixtures.

**Acceptance/proof:** Duplicate cron calls, interrupted claims, a transient send
failure and invalid subscription are handled within the stated budget; plan
edits/confirmation suppress pending obsolete work; follow-ups stop at their
boundary while old occurrences remain unconfirmed. Use a controllable transport
and clock with real local Postgres. **Proof cost:** 7–10 minutes.

### Phase 4: Researcher daily experience — proposed

#### P4-H1: Build cycles and act on today's schedule

**Outcome:** Researchers build/customize multi-peptide cycles, change future
phases, see current planned amounts, and confirm now or log an earlier actual
time. **Vision:** V2, V3, V4. **Depends on:** P3-H3, P3-H4 and the frozen server
interfaces. **Risk:** GUARDED (displayed dose and confirmation).

**Owns:** `src/features/cycles/ui/`, `src/features/administrations/ui/`,
`src/app/app/cycles/`, `src/app/app/today/` and their browser tests.

**Acceptance/proof:** Browser journey from template/custom plan to Today to a
backdated confirmation, then verify the revised future interval and unchanged
fixed weekdays. Historical unconfirmed entries remain actionable; stale
notification links refresh current state. **Proof cost:** 6–10 minutes.
**Candidate pair:** P4-H2. No server/schema or shared navigation edits.

#### P4-H2: Personal supplies and saved calculator workflow

**Outcome:** Researchers can manage optional vial supply, reuse saved mixtures
in the calculator, and see estimated remaining amounts and low-stock alerts.
**Vision:** V4, V5. **Depends on:** P3-H2, P3-H3, P2-H1 and frozen interfaces.
**Risk:** GUARDED (displayed calculation).

**Owns:** `src/features/vials/ui/`, saved-setup adapters inside
`src/features/calculator/`, `src/app/app/supplies/` and its browser tests.

**Acceptance/proof:** Save/select mixture and syringe markings, reload accurate
results, enable optional stock and observe confirmation-derived balance and
low-stock indication. A sale is not present in personal supplies automatically.
**Proof cost:** 5–8 minutes. **Candidate pair:** P4-H1. No server/schema changes.

#### P4-H3: Goals, check-ins and progress history

**Outcome:** Researchers record cycle baselines, a quick daily check-in and an
optional measurement, then review them beside actual events. **Vision:** V6.
**Depends on:** P3-H3, P1-H3. **Risk:** GUARDED (private observations).

**Owns:** `src/features/progress/`, `src/app/app/progress/`, results schema and
RLS migrations, and generated types. This slice is serial because it introduces
shared data and support-visible read interfaces.

**Acceptance/proof:** One daily check-in across overlapping cycles, 1–5 feeling,
unwanted effects/notes and a measurement with units appear against real recorded
dates; other researchers and ungranted admins cannot read them.
**Proof cost:** 5–10 minutes.

#### P4-H4: Optional supplement routines

**Outcome:** Researchers optionally schedule supplements and confirm them using
the established schedule/reminder flow. **Vision:** V7.
**Depends on:** P3-H4, P4-H1. **Risk:** GUARDED (schema and outbound reminders).

**Owns:** `src/features/supplements/`, `src/app/app/supplements/`, supplement
schema and the narrowly scoped shared schedule/dispatcher adapters. Serial
integration; avoid a second scheduling engine.

**Acceptance/proof:** A supplement appears when due, has bounded reminders and
can be confirmed; no peptide syringe conversion or vial deduction occurs.
Verify actual independent researcher ownership. **Proof cost:** 5–8 minutes.

### Phase 5: Admin operations and support — proposed

#### P5-H1: Stock by peptide strength and purchase entries

**Outcome:** Admins record received vials and their purchase costs, with separate
stock by peptide and strength. **Vision:** V8.
**Depends on:** P1-H4 and approved D1. **Risk:** GUARDED (financial data).

**Owns:** `src/features/inventory/server/`, business stock/purchase schema and
RLS migrations, generated types and inventory database tests.

**Acceptance/proof:** Two strengths remain separate; purchase quantity and cost
are retained; researchers cannot read or change stock/cost records. Reject
invalid quantities and currency mismatches. **Proof cost:** 5–8 minutes.

#### P5-H2: Atomic manual sales and historical gross profit

**Outcome:** An admin command records a sale to an account-linked or outside
buyer and atomically allocates stock/costs. **Vision:** V8.
**Depends on:** P5-H1 and approved D2. **Risk:** GUARDED (money/stock).

**Owns:** `src/features/sales/server/`, sale/allocation routines and migrations,
minimum buyer-identity lookup, generated types and financial fixtures.

**Acceptance/proof:** Changing purchase costs produce the agreed cost allocation;
concurrent sales cannot oversell; retrying a sale does not sell twice; historical
profit survives new purchases. A linked sale neither creates personal stock
nor grants support access. **Proof cost:** 7–10 minutes.

#### P5-H3: Admin purchase, sales and profit screens

**Outcome:** Admins can perform manual stock/purchase/sale entry and view quantities,
revenue and gross profit through the app. **Vision:** V8.
**Depends on:** P5-H2 and frozen inventory/sales APIs. **Risk:** GUARDED (money).

**Owns:** `src/features/inventory/ui/`, `src/features/sales/ui/`,
`src/app/admin/inventory/`, `src/app/admin/sales/` and their browser tests.

**Acceptance/proof:** Enter a purchase and both buyer types, verify the strength's
stock and stated cost/revenue/profit, and show failed oversell without reporting
a completed sale. **Proof cost:** 5–8 minutes. **Candidate pair:** P5-H4.
No migrations, shared types, accounting routines or global layout edits.

#### P5-H4: Admin cycle-template editor

**Outcome:** Admins maintain reusable templates with independent peptide phases,
amounts, schedules, breaks and guidance references. **Vision:** V2, V7.
**Depends on:** P3-H1, P1-H4 and frozen template APIs. **Risk:** STANDARD.

**Owns:** `src/features/templates/ui/`, `src/app/admin/templates/` and isolated
template browser tests. Read common schedule/calculation contracts; do not
change researcher cycle UI or shared components while paired.

**Acceptance/proof:** Create/edit a template, copy it to a researcher cycle via
the stable server contract, and verify a later template edit leaves that copy
unchanged. **Proof cost:** 5–8 minutes. **Candidate pair:** P5-H3.

#### P5-H5: Permission-based support history view

**Outcome:** A permitted admin can view the researcher's complete in-scope
profile history, including cycles, actual events, progress, personal supplies
and supplements, without editing it. **Vision:** V1.
**Depends on:** P1-H3, P4-H1–P4-H4. **Risk:** GUARDED (private records).

**Owns:** `src/features/support/`, `src/app/admin/support/` and access/browser
tests. Consume existing subject-scoped read interfaces; shared authorization
changes are serial and require the same access tests.

**Acceptance/proof:** Grant gives the named admin complete in-scope read access,
write attempts remain denied, another admin remains denied, and revocation
denies subsequent reads including direct API/database paths. Financial records
and push-subscription secrets are not part of researcher support history.
**Proof cost:** 6–10 minutes.

## Parallel schedule and ownership

Maximum two implementation makers at once, one per independent worktree based
on the same reviewed cumulative commit. Main conducts integration. Reviews use
fresh independent contexts and are scheduled within available agent capacity;
the two-maker limit is not a request for unlimited reviewer fan-out.

| Group | Concurrent work | Common-base prerequisite | Read-only shared contracts | Rejoin and proof |
| --- | --- | --- | --- | --- |
| A | P2-H1 calculator maker + P2-H2 scheduling maker | P1-H1 through P1-H4 complete; D4/D5 approved; decimal/date primitives, toolchain and test entry points committed | Package/lockfiles, base value types, auth/layout/library, common fixtures | Integrate calculator then scheduling. Targeted module proofs remain independent; P3-H3 and the cumulative journey prove their later combined behavior. |
| B | P4-H1 cycle/Today UI maker + P4-H2 personal-supplies UI maker | P3-H1 through P3-H4 complete, plus calculator and push primitives | Cycle, confirmation, mixture and stock APIs; generated types; navigation slots; schemas; common components | Integrate supplies then cycle screens. Run one connected browser check: saved mixture → Today amount → confirmation → updated stock and next due time. Budget 5–8 minutes. |
| C | P5-H3 inventory/sales UI maker + P5-H4 template UI maker | P5-H2 and P3-H1 complete; admin navigation and form primitives committed | Sales/purchase/template APIs, generated types, library identity, auth/layout and common components | Integrate templates then sales screens. Check both admin routes and role boundaries at cumulative feature close; neither branch edits the other's backend. |

All migrations, generated database outputs, shared layout/auth changes and npm
dependency changes are serialized under the active shared-foundation owner.
Their ownership transfers between serial slices, never concurrently. Parallel
makers cannot add a package or silently edit a frozen shared contract to finish
their lane. A need to do so returns that work to serial integration or requires
a revised group before continuing.

No pair can activate just because its slice names appear here. First verify that
its actual common-base interfaces are implemented, independently testable and
unchanged; that owned paths are disjoint; and that no other active run owns them.
If those conditions do not hold, use serial execution or revise the proposed
pair. Do not manufacture mock interfaces as proof that the production contracts
are settled. Main integrates exact reviewed commits and records the cumulative
base before dependent work starts.

The local BUILD execution map below names all 20 slices, their proof budgets
and the three groups together for approval. No dependent stage may skip its
prerequisites. D1–D5 are approved; execution-map approval is still pending.

The proposed critical dependency chain is foundation → schedule/calculation →
cycle/vial persistence → confirmation transaction → reminder dispatch → daily
researcher experience → connected proof. Admin stock/sales can be brought forward
after P1-H4 because D1/D2 are now approved, but data migrations must remain
serial and any change to the execution order below needs an updated map.
Groups A–C are the three explicitly proposed fan-outs; additional overlapping
slices need a revised approved schedule. No calendar completion date is promised
before the first slices establish actual implementation and review throughput.

Before creating implementation worktrees, commit the approved scope/stack and
the eventual approved plan together on the intended feature branch. Confirm
current Git ownership first. The untracked planning documents alone would not
be inherited by newly created worktrees.

## Reference BUILD execution map — deferred until interface design

Feature: Alpha PR Labs research app MVP. Mode: BUILD (local only).
Repository: `/home/marcomoutinho/personal/alphaprlabs`.
All slices use Slipstream and receive independent review. Guarded means the
slice handles authentication, privacy, actionable calculations, outbound
messages, schemas or financial/transaction integrity; it does not activate
Smith/Crucible. Standard applies to the shell/tooling and template-editor slices.

Execution follows the numbered waves. The parallel groups are two-maker pairs,
with one pair active at a time and the shared-base checks defined above.

| Order | Slice and outcome | Surface | Dependencies | Risk | Decisive targeted proof | Expected proof |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | P1-H1 — App layouts and local proof setup | Web/tooling | None | STANDARD | Public URLs preserved; local unit/browser/DB checks run | 5–10 min |
| 2 | P1-H2 — Invitations, accounts and acknowledgement | Web/Auth/DB | P1-H1 | GUARDED | Invite/recovery journey; direct signup and self-admin blocked | 5–10 min |
| 3 | P1-H3 — Private ownership and support grants | Web/API/DB | P1-H2 | GUARDED | Cross-user denial, read-only grant and effective revocation | 5–10 min |
| 4 | P1-H4 — Admin peptide library and guidance | Web/API/DB | P1-H3 | GUARDED | Admin CRUD; researcher read-only; history retains identities | 5–8 min |
| 5A | P2-H1 — Vial calculator | Web/domain | P1-H1–P1-H4 | GUARDED | Independent arithmetic, capacity/marking validation | 3–6 min |
| 5B | P2-H2 — Peptide schedule engine | Domain | P1-H1–P1-H4; group A common base | GUARDED | Fixed/rolling phases, late entries and DST cases | 3–6 min |
| 6 | P2-H3 — Installation and push subscriptions | Web/API/DB | P1-H3; after group A integration | GUARDED | Owner-bound subscriptions and local worker/transport checks | 5–8 min |
| 7 | P3-H1 — Versioned cycles and template copies | API/DB | P1-H4, P2-H2 | GUARDED | Independent phases, preserved template copy, ownership | 5–10 min |
| 8 | P3-H2 — Saved mixtures and optional vial stock | API/DB | P2-H1, P3-H1 | GUARDED | Reload identical calculation; foreign/incompatible vial denied | 5–8 min |
| 9 | P3-H3 — Atomic dose confirmation | API/DB | P3-H1, P3-H2, P2-H2 | GUARDED | One event/deduction on retry; preserved actual history | 7–10 min |
| 10 | P3-H4 — Reminder dispatch and follow-ups | API/DB/cron config | P2-H3, P3-H3 | GUARDED | Duplicate/missed work, retries and stale-reminder invalidation | 7–10 min |
| 11A | P4-H1 — Cycle builder and Today screens | Web | P3-H3, P3-H4 | GUARDED | Build cycle, backdate Taken, verify next schedule | 6–10 min |
| 11B | P4-H2 — Supplies and saved calculator screens | Web | P2-H1, P3-H2, P3-H3; group B common base | GUARDED | Reuse mixture; balance and low-stock display | 5–8 min |
| 12 | P4-H3 — Check-ins and progress | Web/API/DB | P3-H3, P1-H3; after group B integration | GUARDED | Goals/check-ins/measurements on history; access isolation | 5–10 min |
| 13 | P4-H4 — Optional supplements | Web/API/DB | P3-H4, P4-H1 | GUARDED | Reminder and Taken without peptide-stock deduction | 5–8 min |
| 14 | P5-H1 — Business stock and purchases | API/DB | P1-H4 | GUARDED | Separate strengths, quantities/costs and admin-only access | 5–8 min |
| 15 | P5-H2 — Sales and FIFO cost allocation | API/DB | P5-H1 | GUARDED | No oversell/double sale; stable historical profit | 7–10 min |
| 16A | P5-H3 — Admin stock and sales screens | Web | P5-H2 | GUARDED | Enter purchase/sale and reconcile balances | 5–8 min |
| 16B | P5-H4 — Admin template editor | Web | P3-H1, P1-H4; group C common base | STANDARD | Edit template without changing a researcher's copy | 5–8 min |
| 17 | P5-H5 — Full permitted support history | Web/API | P1-H3, P4-H1–P4-H4; after group C integration | GUARDED | Complete read-only history; revoked access denied | 6–10 min |

All 20 slices are local-only. The table includes no executable deployment or
customer-exposure slice. One-time tools/browser/local DB setup: 15–30 minutes.
Group B's combined browser rejoin: 5–8 minutes. Feature-close cumulative proof:
20–30 minutes once, on the final assembled candidate, as defined below.

Later delivery requires separate SHIP authority. The early hosted phone proof
is 15–30 minutes of hands-on verification plus provisioning/DNS time, and must
use real devices. It remains outstanding rather than being folded into local
push mocks. Documentation and local build approval do not authorize invitations
or real reminder sends to researchers.

Future approval, after reconciliation with the approved interface: these 20
proposed local BUILD slices (or their revised boundaries), groups A/B/C with their stated
prerequisites and rejoin points, and the stated setup/targeted/cumulative proof
budgets. Standard Slipstream review/correction limits apply. No additional pair,
broader proof program or customer exposure is included.

## Verification envelope and feature close

Use Vitest for calculation and schedule logic; local Supabase/Postgres tests for
real transactions and RLS; and Playwright for the affected user journeys.
Do not use mocked database access as the proof of privacy or stock accounting.
Do not expect Vitest to exercise async Next.js Server Components; use browser
journeys for those integration boundaries. See the installed Next.js testing
guides under `node_modules/next/dist/docs/01-app/02-guides/testing/`.

Keep fixtures small: two researchers, two admins, a minimal peptide catalog,
one fixed-day and one rolling peptide plan, two differently priced purchases,
and just enough vial/syringe data to exercise the named boundaries. Use synthetic
peptide values to test arithmetic, not real-world protocol recommendations.
Budget one shared clock fixture and one mock push transport, one focused unit/DB
file and at most one focused browser spec per slice (at most two when the named
proof spans both access and behavior), and at most two shared setup files. Large
fixture families, custom analyzers or extra harnesses are outside this envelope.
One deterministic clock/transport seam is sufficient; do not build a new testing
platform or large scenario corpus.

Per slice, run its targeted tests and checks relevant to changed paths. At the
assembled feature, run one cumulative gate on the exact final candidate:

1. Invitation/acknowledgement → custom or template cycle → saved mixture → due
   reminder payload → actual confirmation → changed next interval and stock →
   progress history. Include unchanged fixed weekdays and an open old occurrence.
2. Purchase → manual sale → remaining strength-specific stock and historical
   gross profit, without modifying researcher supplies or permissions.
3. Grant → admin reads the assembled profile history → revoke → subsequent
   requests denied. Include the newer results/supplement tables in the boundary.
4. One supplement reminder/confirmation remains separate from peptide stock.
5. Typecheck, lint, production build, and a narrow public-route smoke check to
   cover shared routing/layout changes.

Budget **20–30 minutes** for the cumulative gate once the environment is ready,
including the build. This is an explicit longer feature-level check, not a
per-slice obligation. Group B's rejoin check is run once at that merge; repeat
only the connected journey needed at feature close. A failed candidate-caused
integration gate requires a focused correction decision, not reopening every
finished slice or silently expanding the proof budget.

Actual durations and results must replace estimates as work proceeds. Existing
baseline failures are recorded separately. New unreviewed scripts or tests are
not evidence of successful execution.

## Early hosted proof and later delivery

The approved stack supports the intended PWA approach, but real device behavior
is an early delivery risk. After P2-H3, propose a separate, explicitly authorized
hosted proof using test accounts and real iPhone/Android devices. Verify Home
Screen installation, permission, a notification while the app is closed, and
authenticated opening. Budget **15–30 minutes of hands-on testing**, excluding
account provisioning and DNS propagation. It is not a local BUILD slice and
cannot be reported passed by a desktop browser mock.

Marco decided on 2026-09-25: staging is local only, and real-phone installation
and push testing runs on the production deployment itself while the app is
closed to researchers. No separate hosted staging environment or local tunnel.
Production stays unlaunched until the app is fully ready. Provisioning and
deploying for this proof remain explicitly authorized delivery actions.

Before invitations reach researchers, delivery needs named owners and approved
account/project/domain/environment choices for Vercel Pro, Supabase Pro and
Postmark. Keep production data separate from local/test data. Verify SMTP sender
domain and invite/recovery redirects, production RLS and migrations, secret
configuration, the cron schedule and send-disable control, and database backups.
Use scoped credentials without exposing values in logs or documentation.

Roll out with the app closed to uninvited users and real reminder sending
disabled. Verify the exact assembled candidate with authorized test accounts,
then enable the dispatcher and verify a full connected researcher journey and
the admin purchase/sale path. Rollback must disable sends and explicitly check
cron configuration; rolling back app code alone does not reverse schema changes
or restore previous cron behavior. Preserve recorded history and stock ledgers.

Pushes, resource provisioning, hosted device proof, production migration,
deployment, invitation sends and customer exposure are later delivery actions,
not authorized by approval of the local build plan. Register the linked Beacon
initiative after the implementation decisions and plan are settled. Keep its
scope pointers here instead of duplicating the contract into a second authority.

## Coverage

| Commitment | Implementation disposition |
| --- | --- |
| V1 — Access/privacy/installable app | P1-H2, P1-H3, P2-H3, P5-H5; connected grant/revoke and hosted installation proof |
| V2 — Flexible cycles | P1-H4, P2-H2, P3-H1, P3-H3, P4-H1, P5-H4 |
| V3 — Reminders/logging | P2-H2, P2-H3, P3-H3, P3-H4, P4-H1 |
| V4 — Saved calculator | P2-H1, P3-H2, P3-H3, P3-H4, P4-H1, P4-H2 |
| V5 — Optional personal stock | P3-H2, P3-H3, P4-H2 |
| V6 — Progress | P4-H3 |
| V7 — Guidance/supplements | P1-H4, P4-H4, P5-H4 |
| V8 — Admin accounting | P5-H1, P5-H2, P5-H3 |

Every approved story remains in the product contract, with proposed
`Delivers`/`Enables` links into these phases. No approved capability is silently
deferred. MVP exclusions remain the ones in the product contract.

## Progress and next decision

D1–D5 were approved by Marco on 2026-09-09. On 2026-09-11 he directed that
interface design precede implementation. The requirements brief is prepared;
Finished design concepts, Marco's concept selection and lock, the interactive
app prototype and his interface approval are still outstanding.
No application slice is active, built, reviewed, deployed or live.

Next: present finished concepts (no wireframes), have Marco select and lock one,
build and review its interactive app prototype, then reconcile this plan and
its parallel groups with the approved handoff and present the revised complete
build map. Keep the
[Alpha PR Labs initiative](../../../development/docs/features/active/alpha-pr-labs.md),
registered on 2026-09-25 without a Beacon Project, linked to the repo-local
authorities. The earlier
20-slice proposal is not approval to implement.

## Technical references

- [Supabase tracked migrations and local development](https://supabase.com/docs/guides/local-development/database-migrations)
- [Supabase server-rendered client integration](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [Decimal.js API](https://mikemcl.github.io/decimal.js/)
- [Temporal polyfill](https://github.com/js-temporal/temporal-polyfill)
- [Vercel cron failure, concurrency and rollback behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

The supporting-library selection above is an implementation recommendation
within the approved TypeScript stack. Exact compatible versions are pinned at
setup and must not be changed independently by parallel makers.
