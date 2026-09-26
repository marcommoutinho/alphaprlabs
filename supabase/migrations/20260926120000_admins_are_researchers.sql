-- S3.2: admins are researchers.
--
-- Every admin is also a researcher: the admin role adds the back office to a
-- full researcher account. The functions that act on the CALLER'S OWN records
-- and accepted only the researcher role now accept "researcher or admin":
--
--   * record_acknowledgement     the disclaimer on the caller's own profile
--   * save_push_subscription     register / refresh the caller's own device
--   * disable_push_subscription  turn off / sign out the caller's own device
--
-- Nothing else changes. Every rule stays owner-bound (auth.uid()), so the
-- admin role is never a way past ownership: an admin still cannot read or
-- change another account's profile, acknowledgement or push subscriptions.
-- Admin-only rules (is_admin(), invitations) are unchanged, and researchers
-- gain nothing. Bodies are otherwise identical to 20260925120000 and
-- 20260925160000; CREATE OR REPLACE keeps each function's owner and grants,
-- which are restated below anyway.

-- True when the caller has a profile that may use the research side
-- (researchers and admins).
create function public.has_research_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('researcher', 'admin')
  );
$$;

revoke all on function public.has_research_access() from public, anon;
grant execute on function public.has_research_access() to authenticated;

-- ── Researcher or admin: record the disclaimer acknowledgement ──────────────
-- Only for the caller's own profile; the time is the server's.
create or replace function public.record_acknowledgement(p_version text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set acknowledgement_version = p_version, acknowledged_at = now()
  where p.id = (select auth.uid()) and p.role in ('researcher', 'admin');
  return found;
end;
$$;

revoke all on function public.record_acknowledgement(text) from public, anon;
grant execute on function public.record_acknowledgement(text) to authenticated;

-- ── Researcher or admin: register (turn_on) or refresh (sync) this device ────
-- Returns 'saved' or 'refused_off' (this device's reminders are off for the
-- caller, or the endpoint is disabled or belongs to another account), or null
-- when the caller has no research access.
create or replace function public.save_push_subscription(
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
  if not public.has_research_access() then
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

-- ── Researcher or admin: turn off reminders / sign out on this device ────────
-- Marks this device off for the caller and disables the caller's own rows
-- for this device id and for this endpoint (which may be null: unknown).
-- Returns whether an active row was disabled; another account's rows are
-- never touched.
create or replace function public.disable_push_subscription(
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
  if not public.has_research_access() then
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
