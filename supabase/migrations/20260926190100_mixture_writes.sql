-- S11: saving mixtures and personal vials, the only write paths
-- (tables in 20260926190000_mixtures.sql).
--
-- Every function applies public.can_write_researcher(owner): only the owner,
-- with the disclaimer acknowledged. A support grant never writes. Changing a
-- record the caller does not own returns null, like a missing record.
-- Decimals are strings with a dot and no sign or exponent (the app
-- normalises "1,5" first); they are stored without trailing zeros.
--
-- Refusal SQLSTATEs (see also 20260926180100_cycle_writes.sql):
--   42501 not an acknowledged researcher      22023 invalid input
--   AP003 unknown peptide     AP007 peptide no longer offered (and not in
--   one of the caller's own cycles or mixtures)
--   AP011 the mixture changed since it was opened (stale version)
--   AP012 a cycle plan that is not the caller's, or not for this peptide
--   AP013 the mixture is linked to a cycle plan (delete refused)
--   AP014 a vial's strength differs from its mixture's
--   AP015 the mixture already has an open tracked vial
--   AP016 personal supply tracking is off

-- A decimal argument as an exact numeric, or null when it is not a plain
-- positive-form decimal of at most 30 characters. Internal.
create function public.mixture_decimal(p_text text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_text ~ '^[0-9]*\.?[0-9]+$' and char_length(p_text) <= 30
              then trim_scale(p_text::numeric) end;
$$;

revoke all on function public.mixture_decimal(text) from public, anon, authenticated;

-- May p_owner newly refer to p_peptide_id? An offered entry, or one their own
-- cycles or mixtures already use. Raises AP003 / AP007 otherwise, holding a
-- shared lock so a concurrent withdrawal waits for this save. Internal.
create function public.mixture_check_peptide(p_owner uuid, p_peptide_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_available boolean;
begin
  select p.available into v_available from public.peptides p where p.id = p_peptide_id for share;
  if not found then
    raise exception 'unknown peptide' using errcode = 'AP003';
  end if;
  if not v_available
     and not exists (select 1 from public.cycle_plans cp where cp.owner_id = p_owner and cp.peptide_id = p_peptide_id)
     and not exists (select 1 from public.mixtures m where m.owner_id = p_owner and m.peptide_id = p_peptide_id) then
    raise exception 'peptide no longer offered' using errcode = 'AP007';
  end if;
end;
$$;

revoke all on function public.mixture_check_peptide(uuid, uuid) from public, anon, authenticated;

-- ── Save a mixture (R7 "Save mixture" / "Update saved mixture") ────────────
-- Creates a mixture (p_mixture_id null) with version 1, or saves one: a
-- changed setup is stored as the NEXT version (earlier ones stay as they
-- were); an unchanged setup adds none. p_version must be the mixture's
-- version (else AP011). The peptide is fixed for a mixture's life.
--
-- p_plan_ids: every cycle peptide plan that should use this mixture after the
-- save, all the caller's own and for this peptide (else AP012). A plan
-- linked to another mixture moves to this one, and that mixture's version
-- advances too; a plan linked to this one and not listed is unlinked.
-- Earlier links are closed, never rewritten, so the mixture each plan used
-- at any past instant stays known.
-- p_line_spacing: '0.5', '1', '2' (units between printed lines) or 'unknown'.
-- Returns the mixture id, or null (not the caller's, or deleted).
create function public.save_mixture(
  p_peptide_id uuid,
  p_vial_mg text,
  p_liquid_ml text,
  p_syringe_units integer,
  p_line_spacing text,
  p_plan_ids uuid[] default '{}',
  p_mixture_id uuid default null,
  p_version integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_vial numeric := public.mixture_decimal(p_vial_mg);
  v_liquid numeric := public.mixture_decimal(p_liquid_ml);
  v_spacing numeric;
  v_plans uuid[];
  v_others uuid[];
  v_mixture public.mixtures%rowtype;
  v_current public.mixture_versions%rowtype;
  v_now timestamptz;
  v_changed boolean := true;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_vial is null or v_vial <= 0 or v_vial > 100000
     or v_liquid is null or v_liquid <= 0 or v_liquid > 1000
     or p_syringe_units is null or p_syringe_units not in (30, 50, 100)
     or p_line_spacing is null or p_line_spacing not in ('0.5', '1', '2', 'unknown')
     or p_peptide_id is null or p_plan_ids is null or array_position(p_plan_ids, null) is not null
     or cardinality(p_plan_ids) > 100 then
    raise exception 'invalid mixture' using errcode = '22023';
  end if;
  v_spacing := case when p_line_spacing = 'unknown' then null else p_line_spacing::numeric end;
  v_plans := array(select distinct x from unnest(p_plan_ids) x);

  if p_mixture_id is null and p_version is not null then
    raise exception 'a new mixture has no version' using errcode = '22023';
  end if;

  -- Lock order, so concurrent saves never deadlock: the plans (by id), then
  -- every mixture whose links this save changes (by id).
  -- The plans: the caller's own, for this peptide. A concurrent save for the
  -- same plan waits here (no key update is compatible with cycle saves).
  if cardinality(v_plans) <> (
    select count(*) from (
      select 1 from public.cycle_plans cp
      where cp.id = any (v_plans) and cp.owner_id = v_uid and cp.peptide_id = p_peptide_id
      order by cp.id
      for no key update
    ) own
  ) then
    raise exception 'unknown cycle plan' using errcode = 'AP012';
  end if;

  -- The mixtures: this one, and those the plans move from. With the plans
  -- locked, their current links can only end (another mixture's save or
  -- delete), never begin, so the set read here covers every change below.
  v_others := array(
    select distinct l.mixture_id from public.cycle_plan_mixtures l
    where l.plan_id = any (v_plans) and l.unlinked_at is null and l.mixture_id is distinct from p_mixture_id);
  perform 1 from public.mixtures m
  where m.id = any (array_append(v_others, p_mixture_id))
  order by m.id
  for update;

  if p_mixture_id is null then
    perform public.mixture_check_peptide(v_uid, p_peptide_id);
    insert into public.mixtures (owner_id, peptide_id)
    values (v_uid, p_peptide_id)
    returning * into v_mixture;
  else
    select m.* into v_mixture from public.mixtures m where m.id = p_mixture_id;
    if not found or not public.can_write_researcher(v_mixture.owner_id) or v_mixture.deleted_at is not null then
      return null;
    end if;
    if p_peptide_id <> v_mixture.peptide_id then
      raise exception 'a mixture keeps its peptide' using errcode = '22023';
    end if;
    if p_version is distinct from v_mixture.version then
      raise exception 'the mixture changed since it was opened' using errcode = 'AP011';
    end if;
    select v.* into v_current from public.mixture_versions v
    where v.mixture_id = v_mixture.id and v.number = v_mixture.current_version;
    v_changed := (v_current.vial_mg, v_current.liquid_ml, v_current.syringe_units::integer, v_current.line_spacing)
      is distinct from (v_vial, v_liquid, p_syringe_units, v_spacing);
    -- A tracked vial's strength matches its mixture's (finish it first).
    if v_current.vial_mg <> v_vial and exists (
      select 1 from public.personal_vials pv
      where pv.mixture_id = v_mixture.id and pv.finished_at is null and pv.strength_mg <> v_vial
    ) then
      raise exception 'an open tracked vial has another strength' using errcode = 'AP014';
    end if;
  end if;

  -- One instant for this save's version and links, taken after the locks.
  v_now := clock_timestamp();

  -- The mixtures the plans actually move from (read again under the locks).
  v_others := array(
    select distinct l.mixture_id from public.cycle_plan_mixtures l
    where l.plan_id = any (v_plans) and l.unlinked_at is null and l.mixture_id <> v_mixture.id);

  if v_changed then
    insert into public.mixture_versions (mixture_id, owner_id, number, vial_mg, liquid_ml, syringe_units, line_spacing, created_at)
    values (v_mixture.id, v_uid, case when p_mixture_id is null then 1 else v_mixture.current_version + 1 end,
            v_vial, v_liquid, p_syringe_units, v_spacing, v_now);
  end if;

  update public.cycle_plan_mixtures l
  set unlinked_at = v_now
  where l.unlinked_at is null
    and l.owner_id = v_uid
    and ((l.mixture_id = v_mixture.id and l.plan_id <> all (v_plans))
      or (l.plan_id = any (v_plans) and l.mixture_id <> v_mixture.id));

  insert into public.cycle_plan_mixtures (plan_id, owner_id, peptide_id, mixture_id, linked_at)
  select p, v_uid, v_mixture.peptide_id, v_mixture.id, v_now
  from unnest(v_plans) p
  where not exists (
    select 1 from public.cycle_plan_mixtures l
    where l.plan_id = p and l.unlinked_at is null and l.mixture_id = v_mixture.id
  );

  if p_mixture_id is not null then
    update public.mixtures m
    set version = m.version + 1,
        current_version = case when v_changed then m.current_version + 1 else m.current_version end,
        updated_at = case when v_changed then v_now else m.updated_at end
    where m.id = v_mixture.id;
  else
    update public.mixtures m set created_at = v_now, updated_at = v_now where m.id = v_mixture.id;
  end if;
  -- A mixture that lost a plan changed too: a tab still holding its old
  -- version can't save it and silently move the plan back (AP011).
  update public.mixtures m set version = m.version + 1 where m.id = any (v_others);

  return v_mixture.id;
end;
$$;

revoke all on function public.save_mixture(uuid, text, text, integer, text, uuid[], uuid, integer) from public, anon;
grant execute on function public.save_mixture(uuid, text, text, integer, text, uuid[], uuid, integer) to authenticated;

-- ── Delete a mixture (R7 "Delete") ─────────────────────────────────────────
-- Hides it from the researcher's lists; its versions and past links stay for
-- recorded doses. Refused while a plan in its cycle's current revision uses
-- it (AP013); a link to a plan an edit removed is closed instead. A stale
-- p_version is AP011. Returns true, or null (not the caller's, or deleted).
create function public.delete_mixture(p_mixture_id uuid, p_version integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mixture public.mixtures%rowtype;
begin
  if not public.can_write_researcher((select auth.uid())) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select m.* into v_mixture from public.mixtures m where m.id = p_mixture_id for update;
  if not found or not public.can_write_researcher(v_mixture.owner_id) or v_mixture.deleted_at is not null then
    return null;
  end if;
  if p_version is distinct from v_mixture.version then
    raise exception 'the mixture changed since it was opened' using errcode = 'AP011';
  end if;
  -- Linked to a plan its cycle still has (in the current revision).
  if exists (
    select 1
    from public.cycle_plan_mixtures l
    join public.cycle_plans cp on cp.id = l.plan_id
    join public.cycles c on c.id = cp.cycle_id
    join public.cycle_revisions r on r.cycle_id = c.id and r.number = c.current_revision
    join public.cycle_revision_plans rp on rp.revision_id = r.id and rp.plan_id = l.plan_id
    where l.mixture_id = v_mixture.id and l.unlinked_at is null
  ) then
    raise exception 'the mixture is linked to a cycle plan' using errcode = 'AP013';
  end if;
  -- Links to plans an edit has since removed from their cycle end now.
  update public.cycle_plan_mixtures l set unlinked_at = clock_timestamp()
  where l.mixture_id = v_mixture.id and l.unlinked_at is null;
  update public.mixtures m set deleted_at = clock_timestamp(), version = m.version + 1 where m.id = v_mixture.id;
  return true;
end;
$$;

revoke all on function public.delete_mixture(uuid, integer) from public, anon;
grant execute on function public.delete_mixture(uuid, integer) to authenticated;

-- ── Personal supplies (R8, optional; screens in S14) ───────────────────────

-- "Track supplies" on or off for the caller. Returns the new setting.
-- Turning it off keeps every vial; S12 deducts only while it is on.
create function public.set_supply_tracking(p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid setting' using errcode = '22023';
  end if;
  insert into public.personal_supply_settings (owner_id, tracking_enabled, updated_at)
  values (v_uid, p_enabled, now())
  on conflict (owner_id) do update
    set tracking_enabled = excluded.tracking_enabled,
        updated_at = case when personal_supply_settings.tracking_enabled = excluded.tracking_enabled
                          then personal_supply_settings.updated_at else excluded.updated_at end;
  return p_enabled;
end;
$$;

revoke all on function public.set_supply_tracking(boolean) from public, anon;
grant execute on function public.set_supply_tracking(boolean) to authenticated;

-- Adds a vial (p_vial_id null) or changes one's label and mixture. Needs
-- tracking on (AP016). The peptide and strength are fixed once added (a
-- different vial is another vial). A mixture must be the caller's, not
-- deleted, for the same peptide (else 22023), for the same vial strength
-- (AP014), and without another open vial (AP015). Returns the vial id, or
-- null (not the caller's).
create function public.save_personal_vial(
  p_label text,
  p_peptide_id uuid,
  p_strength_mg text,
  p_mixture_id uuid default null,
  p_vial_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_label text := public.trim_whitespace(coalesce(p_label, ''));
  v_strength numeric := public.mixture_decimal(p_strength_mg);
  v_vial public.personal_vials%rowtype;
  v_mixture public.mixtures%rowtype;
  v_vial_mg numeric;
  v_id uuid;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not coalesce((select s.tracking_enabled from public.personal_supply_settings s where s.owner_id = v_uid), false) then
    raise exception 'supply tracking is off' using errcode = 'AP016';
  end if;
  if char_length(v_label) not between 1 and 40 or p_peptide_id is null
     or v_strength is null or v_strength <= 0 or v_strength > 100000 then
    raise exception 'invalid vial' using errcode = '22023';
  end if;

  if p_vial_id is not null then
    select pv.* into v_vial from public.personal_vials pv where pv.id = p_vial_id for update;
    if not found or not public.can_write_researcher(v_vial.owner_id) then
      return null;
    end if;
    if v_vial.peptide_id <> p_peptide_id or v_vial.strength_mg <> v_strength or v_vial.finished_at is not null then
      raise exception 'a vial keeps its peptide and strength; a finished vial is closed' using errcode = '22023';
    end if;
  else
    perform public.mixture_check_peptide(v_uid, p_peptide_id);
  end if;

  if p_mixture_id is not null then
    select m.* into v_mixture from public.mixtures m where m.id = p_mixture_id for update;
    if not found or v_mixture.owner_id <> v_uid or v_mixture.deleted_at is not null
       or v_mixture.peptide_id <> p_peptide_id then
      raise exception 'unknown mixture' using errcode = '22023';
    end if;
    select v.vial_mg into v_vial_mg from public.mixture_versions v
    where v.mixture_id = v_mixture.id and v.number = v_mixture.current_version;
    if v_vial_mg <> v_strength then
      raise exception 'the vial strength differs from the mixture' using errcode = 'AP014';
    end if;
    if exists (
      select 1 from public.personal_vials pv
      where pv.mixture_id = v_mixture.id and pv.finished_at is null and pv.id is distinct from p_vial_id
    ) then
      raise exception 'the mixture already has a tracked vial' using errcode = 'AP015';
    end if;
  end if;

  if p_vial_id is null then
    insert into public.personal_vials (owner_id, peptide_id, label, strength_mg, mixture_id)
    values (v_uid, p_peptide_id, v_label, v_strength, p_mixture_id)
    returning id into v_id;
  else
    update public.personal_vials pv
    set label = v_label, mixture_id = p_mixture_id,
        updated_at = case when (pv.label, pv.mixture_id) is distinct from (v_label, p_mixture_id) then now() else pv.updated_at end
    where pv.id = p_vial_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_personal_vial(text, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.save_personal_vial(text, uuid, text, uuid, uuid) to authenticated;

-- Marks a vial finished (kept for history; its mixture may get a new vial).
-- Returns true, or null (not the caller's, or already finished).
create function public.finish_personal_vial(p_vial_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_vial public.personal_vials%rowtype;
begin
  if not public.can_write_researcher((select auth.uid())) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select pv.* into v_vial from public.personal_vials pv where pv.id = p_vial_id for update;
  if not found or not public.can_write_researcher(v_vial.owner_id) or v_vial.finished_at is not null then
    return null;
  end if;
  update public.personal_vials pv set finished_at = now(), updated_at = now() where pv.id = v_vial.id;
  return true;
end;
$$;

revoke all on function public.finish_personal_vial(uuid) from public, anon;
grant execute on function public.finish_personal_vial(uuid) to authenticated;
