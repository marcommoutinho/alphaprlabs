-- S3.1: only an explicit "Turn on reminders" can switch a device back on.
--
-- A background re-registration (sync) still pending in another tab or window
-- of the same browser could otherwise re-enable a device the researcher just
-- turned off or signed out of. The rule is enforced here, not in the browser:
--
--   * Every browser has a random device id (a uuid in localStorage, shared by
--     all its tabs). Saves record it on the row.
--   * Turn off and sign out disable the caller's rows for the endpoint AND for
--     the device id, and remember "this device is off for this account" in
--     push_device_off, even when the endpoint is unknown or has rotated.
--   * save_push_subscription now takes a mode:
--       turn_on  explicit button: clears the off mark, then upserts, re-enables
--                and takes over a shared endpoint (the previous behaviour);
--       sync     background refresh: refused ('refused_off') while the device
--                is marked off for the caller, and otherwise only refreshes a
--                row that is active and already the caller's, or registers an
--                endpoint nobody has. It never re-enables or takes over a row.
--   * Both functions take a per-(account, device) transaction lock, so a sync
--     and a turn off for the same device never interleave.

alter table public.push_subscriptions add column device_id uuid;
create index push_subscriptions_by_device on public.push_subscriptions (profile_id, device_id)
  where device_id is not null;

-- One row per (account, device) whose reminders were turned off or signed out
-- of, until that account explicitly turns them on again on that device.
create table public.push_device_off (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  device_id uuid not null,
  reason text not null check (reason in ('turned_off', 'signed_out')),
  off_at timestamptz not null default now(),
  primary key (profile_id, device_id)
);

-- Written and read only by the functions below (security definer).
alter table public.push_device_off enable row level security;
revoke all on table public.push_device_off from public, anon, authenticated;
grant select, insert, update, delete on table public.push_device_off to service_role;

-- Replace the unguarded signatures: no overload without a mode or device id
-- remains callable.
drop function public.save_push_subscription(text, text, text, text);
drop function public.disable_push_subscription(text, text);

-- ── Researcher: register (turn_on) or refresh (sync) this device ────────────
-- Returns 'saved' or 'refused_off' (this device's reminders are off for the
-- caller, or the endpoint is disabled or belongs to another account), or null
-- when the caller is not a researcher.
create function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_device_label text, p_device_id uuid, p_mode text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if p_mode is null or p_mode not in ('turn_on', 'sync') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if not public.is_canonical_push_endpoint(p_endpoint) then
    raise exception 'endpoint is not a canonical push-service URL' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_uid and p.role = 'researcher'
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('push_device:' || v_uid::text || ':' || p_device_id::text, 0));

  if p_mode = 'turn_on' then
    delete from public.push_device_off o where o.profile_id = v_uid and o.device_id = p_device_id;

    insert into public.push_subscriptions as s (profile_id, endpoint, p256dh, auth, device_label, device_id)
    values (v_uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_device_label, ''), 80), p_device_id)
    on conflict (endpoint) do update
      set profile_id = excluded.profile_id,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          device_label = excluded.device_label,
          device_id = excluded.device_id,
          -- A device that changed hands counts as newly registered.
          created_at = case when s.profile_id = excluded.profile_id then s.created_at else now() end,
          last_seen_at = now(),
          disabled_at = null,
          disabled_reason = null;
    return 'saved';
  end if;

  -- sync
  if exists (
    select 1 from public.push_device_off o where o.profile_id = v_uid and o.device_id = p_device_id
  ) then
    return 'refused_off';
  end if;

  -- Insert a new endpoint, or refresh the caller's own active row. The
  -- conflicting row is locked and re-checked, so a disabled row or another
  -- account's row is left untouched and nothing is returned.
  insert into public.push_subscriptions as s (profile_id, endpoint, p256dh, auth, device_label, device_id)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_device_label, ''), 80), p_device_id)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        device_label = excluded.device_label,
        device_id = excluded.device_id,
        last_seen_at = now()
    where s.profile_id = excluded.profile_id and s.disabled_at is null
  returning s.id into v_id;
  return case when v_id is null then 'refused_off' else 'saved' end;
end;
$$;

-- ── Researcher: turn off reminders / sign out on this device ───────────────
-- Marks this device off for the caller and disables the caller's own rows
-- for this device id and for this endpoint (which may be null: unknown), so a
-- later sync from this browser is refused even under a new endpoint. The
-- device id is required: a disable without an off mark would let a pending
-- sync under a rotated endpoint switch the device back on. Returns whether an
-- active row was disabled; another account's rows are never touched.
create function public.disable_push_subscription(
  p_reason text, p_device_id uuid, p_endpoint text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_reason is null or p_reason not in ('turned_off', 'signed_out') then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_uid and p.role = 'researcher'
  ) then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('push_device:' || v_uid::text || ':' || p_device_id::text, 0));
  insert into public.push_device_off as o (profile_id, device_id, reason)
  values (v_uid, p_device_id, p_reason)
  on conflict (profile_id, device_id) do update set reason = excluded.reason, off_at = now();

  update public.push_subscriptions s
  set disabled_at = now(), disabled_reason = p_reason
  where s.profile_id = v_uid
    and s.disabled_at is null
    and (s.endpoint = p_endpoint or s.device_id = p_device_id);
  return found;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text, uuid, text) from public, anon;
revoke all on function public.disable_push_subscription(text, uuid, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text, uuid, text) to authenticated;
grant execute on function public.disable_push_subscription(text, uuid, text) to authenticated;
