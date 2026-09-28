# Alpha PR Labs app: redesign brief

You are the lead product designer. Design the complete visual language and the key
screens for a phone-first app. You decide the look: layout, type, colour, surfaces,
iconography and components. The goal is the best-designed app a researcher has on
their phone, not a restyle of what exists.

## The product

Alpha PR Labs is a small peptide research company. Its private app (invite-only,
installed from the browser to the phone's home screen, used like a native app) has
two sides:

**Researchers** (a handful of invited people, mostly on iPhone) use it daily to:
- follow one or more peptide cycles, each peptide with its own schedule, dose
  changes and breaks;
- see today's doses and log each one with one tap ("Taken"), optionally adding
  the actual amount, time, injection site and notes;
- know exactly what to draw: dose in mg or mcg and the matching units on a U-100
  syringe (100, 50 or 30-unit), calculated from their saved vial mixture;
- do one quick daily check-in (overall feeling 1–5, unwanted effects, a note,
  one optional measurement such as weight) and see progress over time next to
  their doses;
- optionally track their own vials (what's left after each dose, low-stock
  warnings) and supplements (routines with Taken logging);
- browse the peptide library (research summaries maintained by the company);
- choose to let an admin view their history for support.

**Admins** (the owner and two sellers; admins are also researchers) use it to:
- see gross profit, revenue and cost at a glance;
- manage stock by peptide and vial strength (count on hand, value, low stock);
- record purchases (CAD or USD at the Bank of Canada rate) and sales (always CAD,
  with seller and buyer);
- maintain the peptide library and cycle templates, and invite people.

## How it should feel

- Native and modern: something that sits naturally next to the best apps on an
  iPhone in 2026, not a website in a phone frame.
- The owner's reference is **Whoop**, which he finds phenomenal: data-first,
  confident numbers, the key metric of the day given real presence, calm but
  premium, serious about health. Use it as a bar for quality and feel, not
  something to copy. Do not reuse Whoop's branding, colours or layouts.
- Credible and scientific rather than bro-fitness or crypto. Researchers trust
  this app with what they put in their bodies.
- Fast to use one-handed: the daily job (see today, log a dose, check in) takes
  seconds.

## What was rejected and why

Two earlier directions were rejected by the owner:
1. Flat near-black cards, condensed ALL-CAPS labels, a single progress ring:
   "weird, flat, lifeless, non modern", "extremely dated".
2. The same layout with glassy translucent cards, blue glows, gradient rings and
   a floating frosted tab bar: still not liked.

Don't just add effects to a basic layout. Rethink the structure, hierarchy and
visual system from first principles.

## Brand

- Logo: a bold, geometric, angular "A". The company's public site is black and
  white with a light blue accent (#60A5FA). You may evolve the palette. Dark mode,
  light mode or both is your call; justify it.
- Tone: modern, bold, professional, authoritative but approachable.
- The app is for research use only. The disclaimer is shown at sign-up, not on
  every screen.

## Deliverables

1. **Design system:** colour (including semantic colours for done, due, missed
   and low stock), typography scale, spacing, radii, surfaces and elevation,
   iconography, and core components (buttons, inputs, segmented controls, list
   rows, cards, stat tiles, charts, rings or gauges, bottom sheets, tab bar,
   toasts, empty states).
2. **Researcher screens** (iPhone, 390×844):
   - Today: today's doses per peptide (done, due, upcoming, overdue), today's
     supplements, low-stock notes, the check-in prompt.
   - Log a dose (bottom sheet): syringe units front and centre, dose, mix,
     vial remaining, injection site, time taken (defaults to now, editable for
     late logging), Taken and Skip.
   - Cycle detail: peptides with their schedules, where you are in the cycle,
     adherence, history.
   - Build or edit a cycle (a multi-step flow: pick peptides, set dose,
     schedule and dates per peptide).
   - Progress: check-in trend, measurement chart, adherence, alongside doses.
   - Daily check-in (sheet).
   - My vials / supplies, and the Me tab (settings, support access, sign out).
3. **Admin screens** (phone first; also show how Overview works on a laptop):
   Overview (gross profit, revenue, cost, stock value, low stock), Stock, Record
   a sale, Record a purchase.
4. Empty, loading and error states for Today and Stock.

## Realistic content to design with

- Peptides and strengths: Retatrutide 10 mg and 20 mg, BPC-157 10 mg, TB-500
  10 mg, GHK-Cu 100 mg, MOTS-c 10 mg, Tesamorelin 5 mg, Ipamorelin 5 mg,
  CJC-1295 5 mg and 10 mg, Epithalon 10 mg, KPV 10 mg, SS-31 10 mg, NAD+ 500 mg,
  Thymosin Alpha-1 10 mg, Kisspeptin-10 5 mg, Selank 5 mg, Semax 5 mg,
  Glutathione 1500 mg, PT-141 10 mg, Cerebrolysin 60 mg, BAC water 10 mL.
- A researcher's day: BPC-157 250 mcg twice a day (7:30 AM, 8:00 PM); TB-500
  2.5 mg Monday and Thursday. BPC-157 mixed 10 mg in 2 mL, so 5 mg/mL, 250 mcg is
  0.05 mL, which is 5 units. TB-500 10 mg in 2 mL, so 2.5 mg is 50 units.
- Business, Sep 15–24: revenue $3,925, cost of stock sold $428.27, gross profit
  $3,496.73, 32 vials sold. 655 vials in stock worth $7,656.31. Low: CJC-1295
  10 mg (4), Kisspeptin-10 (8), Selank (9).

## Constraints for the build

- Built as a Next.js web app with Tailwind CSS 4 and shadcn/ui (on Base UI),
  installed to the home screen. Anything you design must be buildable with web
  technology. Standard fonts from Google Fonts or system fonts are fine.
- Respect iPhone safe areas (notch, home indicator). Touch targets at least 44 px.
- Accessible: text contrast at least 4.5:1, and states that differ by more than
  colour alone.
- Numbers matter: mg, mcg, mL, syringe units and money must be unmistakable and
  easy to read at a glance.

Start with the design system and the Today and Log-a-dose screens, explain your
direction in a few sentences, then complete the rest.
