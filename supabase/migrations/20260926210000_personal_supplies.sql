-- S14: personal supplies (R8). The screens read the S11 and S12 records
-- (personal_vials, personal_supply_settings: 20260926190000_mixtures.sql;
-- personal_vial_deductions: 20260926200000_doses.sql) and write through the
-- S11 functions (set_supply_tracking, save_personal_vial,
-- finish_personal_vial: 20260926190100_mixture_writes.sql) and the one
-- function added here, reopen_personal_vial.
--
-- The estimate (computed by the app, src/lib/supplies/estimate.ts): a vial's
-- strength minus the amounts of its deductions, exact numerics read as text.
-- Only confirm_dose (20260926200100_dose_confirmation.sql) records a
-- deduction: the full amount taken, from the open vial of the mixture in
-- effect at the actual time, while tracking is on. Nothing ever adds to a
-- personal vial: calculating (the calculator, save_mixture) records nothing,
-- and a business sale (record_business_sale) never touches personal vials or
-- their deductions, even when its buyer is the researcher's own account.
--
-- reopen_personal_vial(p_vial_id): R8 "Reopen" for a vial finished by
-- mistake. The acknowledged owner only (can_write_researcher; a support grant
-- never writes), with tracking on (AP016), as for adding a vial. A vial that
-- is not the caller's, or is not finished, returns null. The vial keeps its
-- saved mixture only while that mixture still fits it: not deleted, the same
-- vial strength as its current setup, and without another open vial (one
-- open vial per mixture). Otherwise it reopens "Not mixed yet" and the
-- function says so, so the researcher can link it again; it is never
-- refused for it, and nothing about its recorded deductions changes.
-- Returns 'reopened' (as it was) or 'unlinked' (its mixture no longer fits).
--
-- delete_mixture (replaced here; 20260926190100_mixture_writes.sql): a
-- deleted mixture is never linked again, so deleting one now also unlinks
-- its open vial, which becomes "Not mixed yet" (its deductions stay; a
-- finished vial keeps its link, as history). Everything else is as before.
--
-- Lock order: the global order documented in
-- 20260926200100_dose_confirmation.sql,
--     cycle -> plans (by id) -> vial -> mixtures (by id),
-- gains one writer and changes one, both taking vial, then mixture:
--   * reopen_personal_vial: the vial (for update), then its mixture, if any
--     (for update: a save_mixture changing its strength, a delete_mixture, a
--     save_personal_vial opening another vial on it, and a confirm_dose
--     deducting through it wait, or are waited for). It locks no cycle or
--     plan. Its only implicit foreign-key lock, on the vial's mixture
--     (for key share), falls on a row it already holds for update.
--   * delete_mixture: was the mixture alone (for update); now first the
--     mixture's open vial, if any (for update), then the mixture (for
--     update), resolving the open vial again under both locks and starting
--     over (its subtransaction rolled back, releasing them) if it moved, as
--     confirm_dose does. With the mixture locked no other vial of it can
--     open (every writer that opens one locks the mixture), and with the
--     vial locked it can't be finished or moved, so what it unlinks is the
--     open vial at commit. Unlinking sets a foreign key to null: no
--     implicit lock.
-- confirm_dose never meets a reopened vial half-way: it locks the open vial
-- of the mixture and then the mixture, and re-resolves under those locks;
-- with the mixture locked here, no other vial of it can open meanwhile.
-- Interleavings: tests/integration/supplies-locks.test.ts.

create function public.reopen_personal_vial(p_vial_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_vial public.personal_vials%rowtype;
  v_mixture public.mixtures%rowtype;
  v_vial_mg numeric;
  v_keep boolean := false;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not coalesce((select s.tracking_enabled from public.personal_supply_settings s where s.owner_id = v_uid), false) then
    raise exception 'supply tracking is off' using errcode = 'AP016';
  end if;

  select pv.* into v_vial from public.personal_vials pv where pv.id = p_vial_id for update;
  if not found or not public.can_write_researcher(v_vial.owner_id) or v_vial.finished_at is null then
    return null;
  end if;

  if v_vial.mixture_id is not null then
    select m.* into v_mixture from public.mixtures m where m.id = v_vial.mixture_id for update;
    select v.vial_mg into v_vial_mg from public.mixture_versions v
    where v.mixture_id = v_mixture.id and v.number = v_mixture.current_version;
    v_keep := v_mixture.deleted_at is null
      and v_vial_mg = v_vial.strength_mg
      and not exists (
        select 1 from public.personal_vials pv
        where pv.mixture_id = v_mixture.id and pv.finished_at is null
      );
  end if;

  update public.personal_vials pv
  set finished_at = null,
      mixture_id = case when v_keep then pv.mixture_id end,
      updated_at = now()
  where pv.id = v_vial.id;

  return case when v_vial.mixture_id is null or v_keep then 'reopened' else 'unlinked' end;
end;
$$;

revoke all on function public.reopen_personal_vial(uuid) from public, anon;
grant execute on function public.reopen_personal_vial(uuid) to authenticated;

-- R7 "Delete" (see above): as in 20260926190100_mixture_writes.sql, and the
-- mixture's open vial, if any, is unlinked in the same transaction.
create or replace function public.delete_mixture(p_mixture_id uuid, p_version integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mixture public.mixtures%rowtype;
  v_owner uuid;
  v_vial uuid;
  v_attempt integer;
begin
  if not public.can_write_researcher((select auth.uid())) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Someone else's (or no) mixture: nothing is locked.
  select m.owner_id into v_owner from public.mixtures m where m.id = p_mixture_id;
  if v_owner is null or not public.can_write_researcher(v_owner) then
    return null;
  end if;

  -- Its open vial, then the mixture (the global order), resolved again under both locks.
  for v_attempt in 1..5 loop
    begin
      v_vial := (select pv.id from public.personal_vials pv
                 where pv.mixture_id = p_mixture_id and pv.finished_at is null order by pv.id limit 1);
      perform 1 from public.personal_vials pv where pv.id = v_vial for update;
      select m.* into v_mixture from public.mixtures m where m.id = p_mixture_id for update;
      if (select pv.id from public.personal_vials pv
          where pv.mixture_id = p_mixture_id and pv.finished_at is null order by pv.id limit 1) is distinct from v_vial then
        raise exception 'the open vial moved; resolve again' using errcode = 'AP099';
      end if;
      exit;
    exception
      when sqlstate 'AP099' then
        if v_attempt = 5 then
          raise exception 'the vial kept changing' using errcode = '40001';
        end if;
    end;
  end loop;

  if v_mixture.id is null or v_mixture.deleted_at is not null then
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
  -- Its open vial is "Not mixed yet" from now on; finished ones keep the link.
  update public.personal_vials pv set mixture_id = null, updated_at = now()
  where pv.id = v_vial;
  update public.mixtures m set deleted_at = clock_timestamp(), version = m.version + 1 where m.id = v_mixture.id;
  return true;
end;
$$;

revoke all on function public.delete_mixture(uuid, integer) from public, anon;
grant execute on function public.delete_mixture(uuid, integer) to authenticated;
