-- Weight defaults to pounds (tasks/research-app.md "Design v3 rebuild
-- decisions": "For check in weight, lbs should be default but also allow
-- users to get kgs", Marco, 2026-09-28).
--
-- R8's weight unit (20260928140000_me_preferences.sql) defaulted to 'kg'.
-- An account that has not chosen a unit now enters and sees weights in
-- 'lb'; 'kg' stays a choice on Me (Weight unit: lb | kg).
--
-- 1. account_preferences.weight_unit defaults to 'lb'. Its check
--    (weight_unit in ('kg', 'lb')) is unchanged.
-- 2. save_account_preferences(p_request_key, p_request_hash,
--    p_default_syringe, p_weight_unit, p_appearance) is recreated with the
--    same signature, checks, idempotency (account_preference_requests),
--    result shape ({default_syringe, weight_unit, appearance, replayed}) and
--    grants. The only change: the row it creates when p_weight_unit is null
--    takes 'lb' (coalesce(p_weight_unit, 'lb')). An existing row keeps its
--    unit, as before, and a replayed request returns its recorded result.
--
-- No data update: production has no account_preferences rows (every account
-- there reads the defaults, now lb), so nothing needs changing. Stored
-- check-in measurements (progress_check_ins value and unit) are untouched:
-- each keeps the unit it was entered in and is converted exactly for display
-- (1 lb = 0.45359237 kg; src/lib/preferences/rules.ts).
--
-- Lock order and access are unchanged: no new lock, table, grant or
-- SQLSTATE. The app's own default is src/lib/preferences/rules.ts
-- DEFAULT_PREFERENCES, which reads lb too.

alter table public.account_preferences alter column weight_unit set default 'lb';

create or replace function public.save_account_preferences(
  p_request_key uuid,
  p_request_hash text,
  p_default_syringe integer default null,
  p_weight_unit text default null,
  p_appearance text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claim public.account_preference_requests%rowtype;
  v_row public.account_preferences%rowtype;
  v_result jsonb;
begin
  if not public.can_write_researcher(v_uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null or coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid request key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account_preferences:' || p_request_key::text, 0));
  select c.* into v_claim from public.account_preference_requests c where c.request_key = p_request_key;
  if found then
    if v_claim.owner_id <> v_uid or v_claim.request_hash <> p_request_hash then
      raise exception 'request key already used' using errcode = '22023';
    end if;
    return v_claim.result || jsonb_build_object('replayed', true);
  end if;

  if p_default_syringe is null and p_weight_unit is null and p_appearance is null then
    raise exception 'no preference given' using errcode = '22023';
  end if;
  if p_default_syringe is not null and p_default_syringe not in (100, 50, 30) then
    raise exception 'invalid default syringe' using errcode = '22023';
  end if;
  if p_weight_unit is not null and p_weight_unit not in ('kg', 'lb') then
    raise exception 'invalid weight unit' using errcode = '22023';
  end if;
  if p_appearance is not null and p_appearance not in ('system', 'light', 'dark') then
    raise exception 'invalid appearance' using errcode = '22023';
  end if;

  insert into public.account_preferences as ap (owner_id, default_syringe, weight_unit, appearance, updated_at)
  values (v_uid, coalesce(p_default_syringe, 100), coalesce(p_weight_unit, 'lb'), p_appearance, clock_timestamp())
  on conflict (owner_id) do update
    set default_syringe = coalesce(p_default_syringe, ap.default_syringe),
        weight_unit = coalesce(p_weight_unit, ap.weight_unit),
        appearance = coalesce(p_appearance, ap.appearance),
        updated_at = clock_timestamp()
  returning ap.* into v_row;

  v_result := jsonb_build_object(
    'default_syringe', v_row.default_syringe,
    'weight_unit', v_row.weight_unit,
    'appearance', v_row.appearance
  );
  insert into public.account_preference_requests (request_key, owner_id, request_hash, result)
  values (p_request_key, v_uid, p_request_hash, v_result);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

-- The grants, as 20260928140000_me_preferences.sql set them (create or
-- replace keeps them; restated so this file reads on its own).
revoke all on function public.save_account_preferences(uuid, text, integer, text, text) from public, anon;
grant execute on function public.save_account_preferences(uuid, text, integer, text, text) to authenticated;
