-- S13 heads-up before a dose (Marco, 2026-09-30): a per-person setting on
-- Me › Dose reminders, "Advance heads-up": Off, 15, 30 or 60 minutes before
-- each dose time, on by default at 15 minutes.
--
-- 1. account_preferences.heads_up_minutes: 0 (Off), 15, 30 or 60; default
--    15. An account without a row reads the default too (the dispatcher's
--    planner, plan_reminder_jobs, and src/lib/preferences/rules.ts
--    resolvePreferences), so everyone gets the heads-up at 15 minutes until
--    they choose otherwise. Readable by its owner only, as the other
--    preferences; the service role reads it (the dispatcher).
-- 2. save_account_preferences gains p_heads_up_minutes (null: leave as it
--    is), with the same conventions as the other three: the acknowledged
--    owner only (42501), a value outside its set is 22023, idempotent by
--    request key and hash (account_preference_requests), at least one
--    preference given. The result gains heads_up_minutes. The old
--    five-argument form is replaced (dropped): a page from before this
--    migration calls it by name without the new argument, which the new form
--    accepts (it defaults to null), so nothing breaks across the deploy.
--
-- Lock order and access are otherwise unchanged: no new lock, table or
-- SQLSTATE.

alter table public.account_preferences
  add column heads_up_minutes smallint not null default 15 check (heads_up_minutes in (0, 15, 30, 60));

drop function public.save_account_preferences(uuid, text, integer, text, text);

create function public.save_account_preferences(
  p_request_key uuid,
  p_request_hash text,
  p_default_syringe integer default null,
  p_weight_unit text default null,
  p_appearance text default null,
  p_heads_up_minutes integer default null
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

  if p_default_syringe is null and p_weight_unit is null and p_appearance is null and p_heads_up_minutes is null then
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
  if p_heads_up_minutes is not null and p_heads_up_minutes not in (0, 15, 30, 60) then
    raise exception 'invalid heads-up' using errcode = '22023';
  end if;

  insert into public.account_preferences as ap (owner_id, default_syringe, weight_unit, appearance, heads_up_minutes, updated_at)
  values (v_uid, coalesce(p_default_syringe, 100), coalesce(p_weight_unit, 'lb'), p_appearance, coalesce(p_heads_up_minutes, 15), clock_timestamp())
  on conflict (owner_id) do update
    set default_syringe = coalesce(p_default_syringe, ap.default_syringe),
        weight_unit = coalesce(p_weight_unit, ap.weight_unit),
        appearance = coalesce(p_appearance, ap.appearance),
        heads_up_minutes = coalesce(p_heads_up_minutes, ap.heads_up_minutes),
        updated_at = clock_timestamp()
  returning ap.* into v_row;

  v_result := jsonb_build_object(
    'default_syringe', v_row.default_syringe,
    'weight_unit', v_row.weight_unit,
    'appearance', v_row.appearance,
    'heads_up_minutes', v_row.heads_up_minutes
  );
  insert into public.account_preference_requests (request_key, owner_id, request_hash, result)
  values (p_request_key, v_uid, p_request_hash, v_result);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.save_account_preferences(uuid, text, integer, text, text, integer) from public, anon;
grant execute on function public.save_account_preferences(uuid, text, integer, text, text, integer) to authenticated;
