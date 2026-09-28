-- V2 (design v3 "Cycles"; tasks/research-app.md "Design v3 rebuild
-- decisions"): the cycle builder's "Dose and mix" step (R4b) saves each
-- peptide's vial mixture with the cycle, in one transaction.
--
-- save_cycle_with_mixtures() is save_cycle() (20260928100000, unchanged: same
-- arguments, checks, locks and refusals) followed, in the same transaction,
-- by the mixes the builder set: each entry names a peptide of the saved
-- cycle and either a new mixture (mixture_id null) or one of the caller's
-- saved mixtures of that peptide (mixture_id + the version the builder
-- showed). For each entry the cycle's plan for that peptide (in the revision
-- just saved) is linked to the mixture:
--   * a new mixture gets version 1 with the given setup;
--   * a saved mixture gets its NEXT version when the setup differs (earlier
--     versions stay, so every recorded dose keeps the setup it was taken
--     with), exactly as save_mixture() does, including its refusal when an
--     open tracked vial of the mixture has another strength (AP014);
--   * the plan's current link to any other mixture ends at the save's
--     instant and the new link starts there (links are closed, never
--     rewritten); a link that already exists is kept. Other plans linked to
--     the same mixture keep their links: unlike save_mixture(), which takes
--     the COMPLETE list of the mixture's plans, this touches only the plans
--     of the cycle being saved, so it never locks another cycle's plans.
-- If any part is refused, nothing is saved (the cycle included): the builder
-- shows why and the researcher's entries stay on screen.
--
-- Entries: a JSON array of at most 20 objects
--   { peptide_id, mixture_id | null, version | null, vial_mg, liquid_ml,
--     syringe_units, line_spacing }
-- with decimals as plain strings (public.mixture_decimal), the same limits
-- as save_mixture() (vial up to 100,000 mg, liquid up to 1,000 mL, syringe
-- 30 / 50 / 100, line spacing '0.5' / '1' / '2' / 'unknown'), each peptide
-- at most once and in the cycle's current revision (22023 otherwise). A
-- saved mixture must be the caller's, of that peptide and not deleted, at
-- the version given: a mixture changed, deleted or unknown since the
-- builder opened is AP011 (reload), as in save_mixture().
--
-- Access: public.can_write_researcher(caller), as save_cycle() and
-- save_mixture(); a support grant never writes. Returns the cycle id, or
-- null when save_cycle() does (an edit of a cycle that is not the caller's).
--
-- Lock order: the global order of 20260926200100_dose_confirmation.sql,
--     cycle -> plans (by id) -> vial -> mixtures (by id),
-- is kept: save_cycle() takes the cycle (for update) and every plan of the
-- cycle (for no key update, by id; plans it inserts are new rows), then this
-- function locks, in one statement ordered by id, every mixture it may
-- change: the ones named and the ones the named plans are linked to now
-- (with the plans locked, those links can only end, never begin). It locks
-- no vial and no other cycle's plan. The AP014 check reads open vials
-- plainly, as save_mixture() does. Implicit foreign-key locks (a link's plan
-- and mixture, a version's mixture) fall on rows already held.
--
-- Refusal SQLSTATEs: those of save_cycle() and save_mixture() (see
-- 20260926180100_cycle_writes.sql and 20260926190100_mixture_writes.sql);
-- no new code.

create function public.save_cycle_with_mixtures(
  p_name text,
  p_goal text,
  p_baseline text,
  p_time_zone text,
  p_plans jsonb,
  p_mixtures jsonb default '[]'::jsonb,
  p_template_id uuid default null,
  p_cycle_id uuid default null,
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
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_entry jsonb;
  v_entries jsonb[] := '{}';
  v_peptides uuid[] := '{}';
  v_named uuid[] := '{}';
  v_plans uuid[] := '{}';
  v_cycle_id uuid;
  v_peptide uuid;
  v_plan uuid;
  v_mixture_id uuid;
  v_version integer;
  v_vial numeric;
  v_liquid numeric;
  v_syringe integer;
  v_spacing numeric;
  v_mixture public.mixtures%rowtype;
  v_current public.mixture_versions%rowtype;
  v_changed boolean;
  v_linked boolean;
  v_others uuid[];
  v_now timestamptz;
  v_i integer;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Every entry's shape, before anything is written.
  if p_mixtures is null or jsonb_typeof(p_mixtures) <> 'array' or jsonb_array_length(p_mixtures) > 20 then
    raise exception 'invalid mixtures' using errcode = '22023';
  end if;
  for v_entry in select e from jsonb_array_elements(p_mixtures) e loop
    if jsonb_typeof(v_entry) <> 'object'
       or coalesce(v_entry ->> 'peptide_id', '') !~ v_uuid
       or (v_entry ->> 'mixture_id' is not null and v_entry ->> 'mixture_id' !~ v_uuid)
       or (v_entry ->> 'mixture_id' is null) <> (v_entry ->> 'version' is null)
       or (v_entry ->> 'version' is not null and (jsonb_typeof(v_entry -> 'version') <> 'number'
           or v_entry ->> 'version' !~ '^[1-9][0-9]{0,8}$'))
       or jsonb_typeof(v_entry -> 'vial_mg') is distinct from 'string'
       or jsonb_typeof(v_entry -> 'liquid_ml') is distinct from 'string'
       or jsonb_typeof(v_entry -> 'syringe_units') is distinct from 'number'
       or coalesce(v_entry ->> 'syringe_units', '') not in ('30', '50', '100')
       or coalesce(v_entry ->> 'line_spacing', '') not in ('0.5', '1', '2', 'unknown') then
      raise exception 'invalid mixture entry' using errcode = '22023';
    end if;
    v_vial := public.mixture_decimal(v_entry ->> 'vial_mg');
    v_liquid := public.mixture_decimal(v_entry ->> 'liquid_ml');
    if v_vial is null or v_vial <= 0 or v_vial > 100000 or v_liquid is null or v_liquid <= 0 or v_liquid > 1000 then
      raise exception 'invalid mixture' using errcode = '22023';
    end if;
    v_peptide := (v_entry ->> 'peptide_id')::uuid;
    if v_peptide = any (v_peptides) then
      raise exception 'one mix per peptide' using errcode = '22023';
    end if;
    v_peptides := v_peptides || v_peptide;
    v_entries := v_entries || v_entry;
    if v_entry ->> 'mixture_id' is not null then
      v_named := v_named || (v_entry ->> 'mixture_id')::uuid;
    end if;
  end loop;

  -- The cycle: every check, lock and refusal of save_cycle().
  v_cycle_id := public.save_cycle(p_name, p_goal, p_baseline, p_time_zone, p_plans, p_template_id, p_cycle_id, p_version);
  if v_cycle_id is null or cardinality(v_entries) = 0 then
    return v_cycle_id;
  end if;

  -- Each entry's plan: the peptide's plan in the cycle's current revision.
  for v_i in 1 .. cardinality(v_entries) loop
    v_plan := null;
    select rp.plan_id into v_plan
    from public.cycles c
    join public.cycle_revisions r on r.cycle_id = c.id and r.number = c.current_revision
    join public.cycle_revision_plans rp on rp.revision_id = r.id
    where c.id = v_cycle_id and rp.peptide_id = v_peptides[v_i];
    if v_plan is null then
      raise exception 'not a peptide of this cycle' using errcode = '22023';
    end if;
    v_plans := v_plans || v_plan;
  end loop;

  -- Every mixture this may change, in id order: the ones named and the ones
  -- the plans use now (see the header).
  perform 1 from public.mixtures m
  where m.id = any (v_named)
     or m.id in (
       select l.mixture_id from public.cycle_plan_mixtures l
       where l.plan_id = any (v_plans) and l.unlinked_at is null)
  order by m.id
  for update;

  -- One instant for every version and link this save makes, after the locks.
  v_now := clock_timestamp();

  for v_i in 1 .. cardinality(v_entries) loop
    v_entry := v_entries[v_i];
    v_peptide := v_peptides[v_i];
    v_plan := v_plans[v_i];
    v_vial := public.mixture_decimal(v_entry ->> 'vial_mg');
    v_liquid := public.mixture_decimal(v_entry ->> 'liquid_ml');
    v_syringe := (v_entry ->> 'syringe_units')::integer;
    v_spacing := case when v_entry ->> 'line_spacing' = 'unknown' then null else (v_entry ->> 'line_spacing')::numeric end;

    if v_entry ->> 'mixture_id' is null then
      -- The plan exists now, so a peptide no longer offered passes (the
      -- caller's own cycle uses it).
      perform public.mixture_check_peptide(v_uid, v_peptide);
      insert into public.mixtures (owner_id, peptide_id, created_at, updated_at)
      values (v_uid, v_peptide, v_now, v_now)
      returning * into v_mixture;
      insert into public.mixture_versions (mixture_id, owner_id, number, vial_mg, liquid_ml, syringe_units, line_spacing, created_at)
      values (v_mixture.id, v_uid, 1, v_vial, v_liquid, v_syringe, v_spacing, v_now);
    else
      v_mixture_id := (v_entry ->> 'mixture_id')::uuid;
      v_version := (v_entry ->> 'version')::integer;
      select m.* into v_mixture from public.mixtures m where m.id = v_mixture_id;
      if not found or v_mixture.owner_id <> v_uid or v_mixture.deleted_at is not null
         or v_mixture.peptide_id <> v_peptide or v_mixture.version <> v_version then
        raise exception 'the mixture changed since it was opened' using errcode = 'AP011';
      end if;
      select v.* into v_current from public.mixture_versions v
      where v.mixture_id = v_mixture.id and v.number = v_mixture.current_version;
      v_changed := (v_current.vial_mg, v_current.liquid_ml, v_current.syringe_units::integer, v_current.line_spacing)
        is distinct from (v_vial, v_liquid, v_syringe, v_spacing);
      -- A tracked vial's strength matches its mixture's (finish it first).
      if v_changed and v_current.vial_mg <> v_vial and exists (
        select 1 from public.personal_vials pv
        where pv.mixture_id = v_mixture.id and pv.finished_at is null and pv.strength_mg <> v_vial
      ) then
        raise exception 'an open tracked vial has another strength' using errcode = 'AP014';
      end if;
      v_linked := exists (
        select 1 from public.cycle_plan_mixtures l
        where l.plan_id = v_plan and l.mixture_id = v_mixture.id and l.unlinked_at is null);
      if v_changed then
        insert into public.mixture_versions (mixture_id, owner_id, number, vial_mg, liquid_ml, syringe_units, line_spacing, created_at)
        values (v_mixture.id, v_uid, v_mixture.current_version + 1, v_vial, v_liquid, v_syringe, v_spacing, v_now);
      end if;
      if v_changed or not v_linked then
        -- Its setup or its plans changed: a tab holding the old version
        -- can't save over it (AP011).
        update public.mixtures m
        set version = m.version + 1,
            current_version = case when v_changed then m.current_version + 1 else m.current_version end,
            updated_at = case when v_changed then v_now else m.updated_at end
        where m.id = v_mixture.id;
      end if;
    end if;

    -- The plan moves to this mixture: its other link ends now.
    v_others := array(
      select l.mixture_id from public.cycle_plan_mixtures l
      where l.plan_id = v_plan and l.unlinked_at is null and l.mixture_id <> v_mixture.id);
    update public.cycle_plan_mixtures l
    set unlinked_at = v_now
    where l.plan_id = v_plan and l.unlinked_at is null and l.mixture_id <> v_mixture.id;
    update public.mixtures m set version = m.version + 1 where m.id = any (v_others);
    insert into public.cycle_plan_mixtures (plan_id, owner_id, peptide_id, mixture_id, linked_at)
    select v_plan, v_uid, v_peptide, v_mixture.id, v_now
    where not exists (
      select 1 from public.cycle_plan_mixtures l
      where l.plan_id = v_plan and l.mixture_id = v_mixture.id and l.unlinked_at is null);
  end loop;

  return v_cycle_id;
end;
$$;

revoke all on function public.save_cycle_with_mixtures(text, text, text, text, jsonb, jsonb, uuid, uuid, integer) from public, anon;
grant execute on function public.save_cycle_with_mixtures(text, text, text, text, jsonb, jsonb, uuid, uuid, integer) to authenticated;
