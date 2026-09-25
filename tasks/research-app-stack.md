# Alpha PR Labs — Research App Technology Decision

Status: Approved.

Approved by Marco on 2026-09-09: “your recommendation is perfect. Lock this in”.

Product authority: [Research app MVP](research-app.md). This decision records
the approved technology stack; it does not change the product scope.

## Decision

Build on the existing Alpha PR Labs application using one TypeScript codebase,
managed hosting, and PostgreSQL.

| Responsibility | Approved technology | Purpose |
| --- | --- | --- |
| Researcher and admin interface | Next.js, React, TypeScript, Tailwind CSS, shadcn | Extend the existing application and component foundation. |
| Application server | Next.js server functions and API routes | Execute cycle changes, calculations, permission checks, and inventory operations. |
| Database | Supabase-managed PostgreSQL | Store accounts' application data, cycles, dose history, vial records, purchases, and sales with relational integrity. |
| Authentication and data access | Supabase Auth and PostgreSQL row-level security policies | Support invitation-based access and enforce researcher ownership, admin-only business records, and explicit support grants. |
| Phone installation | Progressive Web App (PWA) | Let researchers install the web app from their phone browser. |
| Phone notifications | Standard Web Push with a service worker | Deliver notifications using browser and operating-system push support. |
| Hosting | Vercel Pro | Host the Next.js app and its server endpoints. |
| Reminder scheduling | Vercel Pro Cron and a PostgreSQL-backed reminder queue | Check due reminders every minute, record delivery attempts, and implement retry handling. |
| Account email delivery | Postmark connected to Supabase Auth through SMTP | Send invitations and password-reset emails. Changed from Resend by Marco on 2026-09-25. |
| Numerical integrity | Decimal arithmetic and PostgreSQL exact numeric storage | Handle vial calculations and costs with explicit precision and rounding. |
| Consistent updates | PostgreSQL transactions | Keep related log and stock changes consistent. |

## Why this fits

The repository already uses Next.js, React, TypeScript, Tailwind, and shadcn.
Keeping that foundation lets the public site and the new app share a familiar
codebase. Managed authentication, database services, and hosting reduce routine
server maintenance. PostgreSQL fits the relationships between cycles, events,
vials, purchases, and sales.

The reminder queue and its retry behavior are application work. Vercel Cron
provides a scheduled trigger, not a complete reminder-delivery system. The
database holds durable reminder state so scheduling does not depend on an open
browser tab or a running browser timer.

## Constraints to carry into the implementation plan

- On iPhone, Web Push requires a supported iOS version, Home Screen installation,
  and notification permission. Device settings and connectivity can affect
  delivery. A scheduled send is not proof that a researcher saw a notification.
- The plan must define reminder retry timing, duplicate prevention, invalidated
  reminders after plan edits, and the handling of time zones and daylight-saving
  changes for fixed weekdays and elapsed intervals.
- Researcher privacy and revocable, view-only support grants must be enforced by
  authorization rules, including server operations. Supabase's privileged
  service credentials bypass row-level security and cannot serve as proof that
  a requester has permission to view private records.
- Decimal precision, rounding, syringe markings, and stock-cost accounting rules
  still need concrete definitions. A specific decimal library or costing method
  was not selected by this decision.
- Installation and Web Push are approved. Offline editing and background data
  synchronization have not been added to the MVP scope.

## Cost basis

At the decision date, the starting estimate is US$45/month: Vercel Pro at
US$20/month for one developer seat and Supabase Pro from US$25/month with one
project. Email costs, taxes, additional environments or seats, and usage charges
are additional where applicable. This is a dated estimate, not a spending cap
or a guarantee of the eventual bill.

## Next step

Interface design comes before application implementation, per Marco's
2026-09-11 instruction. Give the [UI/UX requirements brief](../../../development/docs/design/alpha-pr-labs/research-app-brief.md)
to Claude Design. Start with finished design concepts, with no wireframes.
Marco chooses and locks one before it is built out into an interactive app
prototype with realistic sample data, working navigation, main actions and
visible state changes. Review and approve that interface before application
implementation. The approved technology choices remain unchanged; they do not
prescribe visual design or screen composition in the brief.

After interface approval, reconcile the [implementation plan](research-app-plan.md)
and proposed parallel groups with the handoff. The prior local BUILD execution
map is deferred and remains unapproved. The [Alpha PR Labs initiative](../../../development/docs/features/active/alpha-pr-labs.md)
was registered on 2026-09-25 at Marco's request, without a Beacon Project.
Product and technical authority remain here.

## Parallel development requirement

Planning instruction approved by Marco on 2026-09-09: identify what can be built
in parallel to speed up development and document it in the implementation plan.

The plan must show the dependency order, the work that determines the earliest
finish date, and which bounded slices can run at the same time. Each proposed
parallel group must name its agent count, roles, owned files or modules,
prerequisites, shared interfaces, integration order, and acceptance checks.
Separate worktrees should isolate concurrent implementation changes.

Agree shared data structures and interfaces before dependent work starts. Assign
one owner to shared database migrations, authentication and permission rules,
application layout, and shared dependencies. Concurrent tasks must not compete
for the same files or change a shared interface independently.

### Candidate parallel work

These are planning candidates, not an approved build sequence. Validate them
against current code and the eventual slice boundaries.

| Work that may run together | Prerequisites and boundary |
| --- | --- |
| Vial calculator implementation and phone installation/push validation | Agree calculator inputs, units, and rounding separately from the push subscription interface. Full scheduled reminders still depend on the cycle and scheduling rules. |
| Researcher cycle planning/scheduling and admin inventory/sales | Agree the peptide library identifiers, account/role rules, and shared data interfaces first. Keep personal dose history and business stock ownership separate. |
| Progress views and admin library/guidance screens | Establish dose-history and measurement interfaces for progress, and library/template interfaces for admin screens. Coordinate any shared schema changes through their owner. |

Personal vial deductions depend on confirmed-dose behavior. Supplement reminders
depend on the shared scheduling behavior. These dependencies must appear in the
plan instead of treating every screen as independent work.

Integrate in dependency order and check the combined result, including calculator
values reaching reminders, confirmation updating personal stock once, plan edits
updating future reminders, and support-access revocation. Put cumulative checks
at the appropriate integration or release point rather than repeating the entire
application test suite for every parallel slice.

Present the concrete parallel groups with the implementation plan for approval
before launching makers. This instruction authorizes planning for concurrency;
it does not start implementation or change the approved MVP.


## References

Checked during the technology-selection discussion on 2026-09-09:

- [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Apple Web Push and Home Screen requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase authentication configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase invitation API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
- [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel pricing](https://vercel.com/pricing)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Postmark SMTP](https://postmarkapp.com/developer/user-guide/send-email-with-smtp)
- [PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html)

Repository baseline: `package.json` declares Next.js `^16.2.0`, React `^19.2.4`,
Tailwind CSS `^4`, and shadcn `^4.1.0`. These describe the existing foundation;
they are not a permanent requirement to retain those exact dependency versions.
