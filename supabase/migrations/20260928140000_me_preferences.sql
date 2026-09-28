-- V4 (design v3 "Me, library and joining"; tasks/research-app.md "Design v3
-- rebuild decisions", "Support access decisions"): R8 Me's Preferences, and
-- request keys on R8 / R17's share and stop.
--
-- 1. Account preferences (R8 "Preferences": Default syringe, Weight unit,
--    Appearance). One row per account, created on the first save:
--      * default_syringe: 100, 50 or 30 (U-100 syringe capacities). It
--        preselects the syringe where no saved mixture says otherwise (the
--        cycle builder's new mix, the calculator's new setup, the log
--        sheet). Default 100.
--      * weight_unit: 'kg' or 'lb'. Weights are shown and entered in it;
--        stored check-in measurements keep the unit they were entered in
--        (progress_check_ins stores value and unit) and are converted exactly
--        for display (1 lb = 0.45359237 kg). Default 'kg'.
--      * appearance: 'system', 'light' or 'dark', or null: never chosen on
--        the account, so each device keeps its own choice (the
--        alpha-appearance cookie; System when it has none). Once chosen it
--        follows the account to every device: the private root layout renders
--        it before first paint and the page mirrors it into the cookie.
--    An account without a row reads the defaults (100, kg, the device's
--    appearance): src/lib/preferences/rules.ts resolvePreferences is the rule.
--    Readable only by the owner (RLS; a support share does not include
--    preferences: they are settings, not history). Nobody writes the table
--    through the API.
--
--    save_account_preferences(p_request_key, p_request_hash,
--    p_default_syringe, p_weight_unit, p_appearance): sets the given
--    preferences of the caller (null: leave as it is; at least one must be
--    given), creating the row with the defaults for the others. The
--    acknowledged owner only (can_write_researcher: 42501 otherwise). A value
--    outside its set is 22023. Idempotent, the convention of
--    save_cycle_with_mixtures: p_request_key made once by the app and sent
--    again on a retry, and p_request_hash the app's SHA-256 (hex) of the
--    submission (src/lib/request-hash.ts); the first save that commits with
--    a key claims it in account_preference_requests with its result; the
--    same key and hash again return that result ("replayed") and change
--    nothing, so a retry that arrives after a later change never undoes it;
--    the key with another hash or from another account is 22023. Returns the
--    preferences as saved: {default_syringe, weight_unit, appearance,
--    replayed}.
--
-- 2. Request keys on sharing (R8's switch, R17's "Allow read-only access",
--    and the stop confirmation). share_with_team() and
--    stop_sharing_with_team() were idempotent by state (sharing while
--    sharing returns the active share; stopping while not sharing returns
--    false), but a retried share that reaches the server after the
--    researcher stopped would share again. The keyed forms
--    share_with_team(p_request_key) and stop_sharing_with_team(p_request_key)
--    run the same functions (same checks and results) and claim the key in
--    support_share_requests with the result; the same key again returns that
--    result ({share_id} or {stopped}, with "replayed": true) and changes
--    nothing. The key from another account or for the other kind is 22023.
--    The unkeyed forms stay (a page loaded before a deploy may still call
--    them). The share history (support_shares) is unchanged: every share and
--    stop already keeps its time there, which R8's grant history lists.
--
-- Lock order: nothing here takes a cycle, plan, vial or mixture lock, so the
-- global order of 20260926200100_dose_confirmation.sql (cycle -> plans by id
-- -> vial -> mixtures by id) is untouched. Each writer takes its request
-- key's transaction-scoped advisory lock first (a concurrent retry waits and
-- then replays), then: the preference save, the caller's preference row (an
-- upsert); the keyed share and stop, the caller's 'support_share:' advisory
-- lock inside share_with_team() / stop_sharing_with_team(), as before.
--
-- Access (deny by default): account_preferences is readable by its owner
-- only; account_preference_requests and support_share_requests have no API
-- access at all. No new refusal SQLSTATE (validation is 22023, access 42501).

-- ── 1. Account preferences ─────────────────────────────────────────────────

create table public.account_preferences (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  default_syringe smallint not null default 100 check (default_syringe in (100, 50, 30)),
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  -- Null: never chosen on the account (each device keeps its own).
  appearance text check (appearance in ('system', 'light', 'dark')),
  updated_at timestamptz not null default now()
);

alter table public.account_preferences enable row level security;
revoke all on table public.account_preferences from public, anon, authenticated, service_role;
grant select on table public.account_preferences to authenticated;
-- Server-only code and tests (secret key) read them.
grant select on table public.account_preferences to service_role;

create policy account_preferences_select_own on public.account_preferences
  for select to authenticated
  using (owner_id = (select auth.uid()));

create table public.account_preference_requests (
  request_key uuid primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index account_preference_requests_by_owner on public.account_preference_requests (owner_id);

alter table public.account_preference_requests enable row level security;
revoke all on table public.account_preference_requests from public, anon, authenticated, service_role;

create function public.save_account_preferences(
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
  values (v_uid, coalesce(p_default_syringe, 100), coalesce(p_weight_unit, 'kg'), p_appearance, clock_timestamp())
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

revoke all on function public.save_account_preferences(uuid, text, integer, text, text) from public, anon;
grant execute on function public.save_account_preferences(uuid, text, integer, text, text) to authenticated;

-- ── 2. Request keys on sharing ─────────────────────────────────────────────

create table public.support_share_requests (
  request_key uuid primary key,
  researcher_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('share', 'stop')),
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index support_share_requests_by_researcher on public.support_share_requests (researcher_id);

alter table public.support_share_requests enable row level security;
revoke all on table public.support_share_requests from public, anon, authenticated, service_role;

-- A keyed share or stop's claim: the recorded result when this key already
-- committed for this caller and kind, null when it is unclaimed, 22023 when
-- it belongs to another account or kind. Internal.
create function public.support_share_replay(p_uid uuid, p_request_key uuid, p_kind text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_claim public.support_share_requests%rowtype;
begin
  if p_request_key is null then
    raise exception 'invalid request key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('support_share_request:' || p_request_key::text, 0));
  select c.* into v_claim from public.support_share_requests c where c.request_key = p_request_key;
  if not found then
    return null;
  end if;
  if v_claim.researcher_id <> p_uid or v_claim.kind <> p_kind then
    raise exception 'request key already used' using errcode = '22023';
  end if;
  return v_claim.result || jsonb_build_object('replayed', true);
end;
$$;

revoke all on function public.support_share_replay(uuid, uuid, text) from public, anon, authenticated;

-- share_with_team() with a request key: {share_id, replayed}. The same checks
-- (42501 until the disclaimer is acknowledged) and the same share.
create function public.share_with_team(p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
  v_id uuid;
begin
  if not public.is_acknowledged_researcher() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_result := public.support_share_replay(v_uid, p_request_key, 'share');
  if v_result is not null then
    return v_result;
  end if;
  v_id := public.share_with_team();
  v_result := jsonb_build_object('share_id', v_id);
  insert into public.support_share_requests (request_key, researcher_id, kind, result)
  values (p_request_key, v_uid, 'share', v_result);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

-- stop_sharing_with_team() with a request key: {stopped, replayed}. The same
-- checks (research access; no acknowledgement needed to stop) and the same stop.
create function public.stop_sharing_with_team(p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
  v_stopped boolean;
begin
  if not public.has_research_access() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_result := public.support_share_replay(v_uid, p_request_key, 'stop');
  if v_result is not null then
    return v_result;
  end if;
  v_stopped := public.stop_sharing_with_team();
  v_result := jsonb_build_object('stopped', v_stopped);
  insert into public.support_share_requests (request_key, researcher_id, kind, result)
  values (p_request_key, v_uid, 'stop', v_result);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.share_with_team(uuid) from public, anon;
revoke all on function public.stop_sharing_with_team(uuid) from public, anon;
grant execute on function public.share_with_team(uuid) to authenticated;
grant execute on function public.stop_sharing_with_team(uuid) to authenticated;
