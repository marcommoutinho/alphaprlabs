-- S11: saved mixtures (R7) and the optional personal-vial records (R8 data).
--
-- Plan "Routine implementation rules": a saved calculation setup is distinct
-- from opting into personal stock tracking. A setup records one peptide, the
-- vial strength, the liquid added, and the selected U-100 syringe capacity
-- and line spacing (marking increment), or that the spacing is unknown. The
-- capacity alone does not establish the spacing, so it is stored explicitly.
-- Changing a mixture changes future calculations, never recorded doses.
--
-- Records:
--   mixtures               one saved mixture: its owner and its peptide (fixed
--                          for its life; another peptide is another mixture).
--                          current_version names its setup in effect now;
--                          version is the concurrency token (+ 1 on every
--                          successful save, links included). deleted_at hides
--                          it ("Delete" in R7) while keeping its history for
--                          recorded doses; a deleted mixture is never linked
--                          or changed again.
--   mixture_versions       the setup, numbered 1, 2, ... per mixture. Never
--                          edited or deleted: a change adds the next version.
--                          created_at is when it took effect.
--   cycle_plan_mixtures    which mixture a cycle peptide plan uses for syringe
--                          units, from linked_at until unlinked_at (half-open;
--                          null while current). At most one current link per
--                          plan. Composite keys keep plan, mixture and link on
--                          the same owner and the same peptide.
--   personal_vials         R8 (optional): a researcher's own vial, labelled,
--                          of one peptide and strength, optionally linked to a
--                          saved mixture ("Not mixed yet" when not). At most
--                          one open (unfinished) vial per mixture. Separate
--                          from business inventory; nothing is added here
--                          automatically. S12 records deductions; S14 builds
--                          the screens.
--   personal_supply_settings  R8 "Track supplies": the opt-in, per researcher.
--                          No row means off.
--
-- The mixture in effect for a plan at an instant (S12 snapshots it on each
-- recorded dose): the link whose [linked_at, unlinked_at) holds the instant,
-- and that mixture's latest version created at or before it
-- (plan_mixture_version_at below).
--
-- Amounts are exact numerics stored without trailing zeros; the app reads
-- them as text (::text) so no amount passes through binary floating point.
-- Entry limits (typo guards): vial strength up to 100,000 mg (Marco,
-- 2026-09-26, as for inventory), liquid up to 1,000 mL.
--
-- Access (deny by default), per the S4 grant rules
-- (20260926150000_support_grants.sql), as for cycles:
--   * Reads: public.can_read_researcher(owner_id) on every table: the owner,
--     or an admin holding that owner's active support grant.
--   * Writes: none through the API, for anyone. The functions in the next
--     migration write, and apply public.can_write_researcher(owner): only the
--     acknowledged owner, never a grant.
--   * Peptides: a researcher may also read an entry no longer offered when
--     one of THEIR OWN mixtures or vials refers to it (policy below), so a
--     saved mixture keeps its name.

-- A plan's owner and peptide travel with a link to it.
alter table public.cycle_plans
  add constraint cycle_plans_owner_peptide unique (id, owner_id, peptide_id);

-- ── Tables ─────────────────────────────────────────────────────────────────

create table public.mixtures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  peptide_id uuid not null references public.peptides (id),
  current_version integer not null default 1 check (current_version >= 1),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint mixtures_owner unique (id, owner_id),
  constraint mixtures_owner_peptide unique (id, owner_id, peptide_id)
);

create index mixtures_by_owner on public.mixtures (owner_id, created_at, id);
create index mixtures_by_peptide on public.mixtures (peptide_id, owner_id);

create table public.mixture_versions (
  id uuid primary key default gen_random_uuid(),
  mixture_id uuid not null,
  owner_id uuid not null,
  number integer not null check (number >= 1),
  -- mg per vial.
  vial_mg numeric not null check (vial_mg > 0 and vial_mg <= 100000 and vial_mg = trim_scale(vial_mg)),
  -- mL of liquid added.
  liquid_ml numeric not null check (liquid_ml > 0 and liquid_ml <= 1000 and liquid_ml = trim_scale(liquid_ml)),
  -- U-100 syringe capacity in units: 1 mL = 100, 0.5 mL = 50, 0.3 mL = 30.
  syringe_units smallint not null check (syringe_units in (30, 50, 100)),
  -- Printed line spacing in units; null when the researcher marked it unknown.
  line_spacing numeric check (line_spacing in (0.5, 1, 2) and line_spacing = trim_scale(line_spacing)),
  created_at timestamptz not null default now(),
  constraint mixture_versions_mixture foreign key (mixture_id, owner_id)
    references public.mixtures (id, owner_id) on delete cascade,
  constraint mixture_versions_number unique (mixture_id, number)
);

create table public.cycle_plan_mixtures (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  owner_id uuid not null,
  peptide_id uuid not null,
  mixture_id uuid not null,
  linked_at timestamptz not null,
  unlinked_at timestamptz,
  constraint cycle_plan_mixtures_plan foreign key (plan_id, owner_id, peptide_id)
    references public.cycle_plans (id, owner_id, peptide_id) on delete cascade,
  constraint cycle_plan_mixtures_mixture foreign key (mixture_id, owner_id, peptide_id)
    references public.mixtures (id, owner_id, peptide_id) on delete cascade,
  constraint cycle_plan_mixtures_span check (unlinked_at is null or unlinked_at >= linked_at)
);

create unique index cycle_plan_mixtures_current on public.cycle_plan_mixtures (plan_id) where unlinked_at is null;
create index cycle_plan_mixtures_by_mixture on public.cycle_plan_mixtures (mixture_id) where unlinked_at is null;
create index cycle_plan_mixtures_by_plan on public.cycle_plan_mixtures (plan_id, linked_at);
create index cycle_plan_mixtures_by_owner on public.cycle_plan_mixtures (owner_id) where unlinked_at is null;

create table public.personal_vials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  peptide_id uuid not null references public.peptides (id),
  -- "Your label", e.g. "A-02".
  label text not null check (label = public.trim_whitespace(label) and char_length(label) between 1 and 40),
  strength_mg numeric not null check (strength_mg > 0 and strength_mg <= 100000 and strength_mg = trim_scale(strength_mg)),
  -- The saved mixture it was mixed to; null while "Not mixed yet".
  mixture_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when the researcher finishes the vial; it stays for history.
  finished_at timestamptz,
  constraint personal_vials_mixture foreign key (mixture_id, owner_id, peptide_id)
    references public.mixtures (id, owner_id, peptide_id) on delete cascade,
  constraint personal_vials_owner unique (id, owner_id)
);

create index personal_vials_by_owner on public.personal_vials (owner_id, created_at, id);
create unique index personal_vials_open_per_mixture on public.personal_vials (mixture_id)
  where finished_at is null and mixture_id is not null;

create table public.personal_supply_settings (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  tracking_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ── Access ─────────────────────────────────────────────────────────────────

alter table public.mixtures enable row level security;
alter table public.mixture_versions enable row level security;
alter table public.cycle_plan_mixtures enable row level security;
alter table public.personal_vials enable row level security;
alter table public.personal_supply_settings enable row level security;

revoke all on table public.mixtures, public.mixture_versions, public.cycle_plan_mixtures,
  public.personal_vials, public.personal_supply_settings
  from public, anon, authenticated, service_role;
grant select on table public.mixtures, public.mixture_versions, public.cycle_plan_mixtures,
  public.personal_vials, public.personal_supply_settings
  to authenticated, service_role;

create policy mixtures_select on public.mixtures
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy mixture_versions_select on public.mixture_versions
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy cycle_plan_mixtures_select on public.cycle_plan_mixtures
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy personal_vials_select on public.personal_vials
  for select to authenticated using (public.can_read_researcher(owner_id));
create policy personal_supply_settings_select on public.personal_supply_settings
  for select to authenticated using (public.can_read_researcher(owner_id));

-- As peptides_research_select_own_cycles: a researcher still sees an entry
-- that is no longer offered when one of their OWN mixtures or vials refers to
-- it. Nothing wider. Permissive, so ORed with the other peptide rules.
create policy peptides_research_select_own_mixtures on public.peptides
  for select to authenticated
  using (
    (select public.is_acknowledged_researcher())
    and (
      exists (
        select 1 from public.mixtures m
        where m.peptide_id = peptides.id and m.owner_id = (select auth.uid())
      )
      or exists (
        select 1 from public.personal_vials v
        where v.peptide_id = peptides.id and v.owner_id = (select auth.uid())
      )
    )
  );

-- ── The mixture in effect, for recorded doses (S12) ────────────────────────
-- The mixture version a plan used for syringe units at p_at: the link in
-- effect then (linked_at <= p_at < unlinked_at), and that mixture's latest
-- version created at or before p_at. Null when the plan had no mixture then.
-- Internal: for S12's confirmation function, which checks access itself,
-- and server-only (secret key) checks; never for signed-in callers.
create function public.plan_mixture_version_at(p_plan_id uuid, p_at timestamptz)
returns uuid
language sql
stable
set search_path = ''
as $$
  select v.id
  from public.cycle_plan_mixtures l
  join public.mixture_versions v on v.mixture_id = l.mixture_id and v.created_at <= p_at
  where l.plan_id = p_plan_id
    and l.linked_at <= p_at
    and (l.unlinked_at is null or l.unlinked_at > p_at)
  order by v.number desc
  limit 1;
$$;

revoke all on function public.plan_mixture_version_at(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.plan_mixture_version_at(uuid, timestamptz) to service_role;
