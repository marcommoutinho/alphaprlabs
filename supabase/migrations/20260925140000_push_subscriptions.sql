-- S3: per-device Web Push subscriptions ("Reminders on this phone").
--
-- Access model (deny by default):
--   * A signed-in researcher reads only their own rows. Nobody else reads
--     them through the API, admins included.
--   * No direct writes through the API. The owner writes through the two
--     functions below, which always bind the row to auth.uid().
--   * The secret key (server-only push sending) may disable a subscription
--     the push service rejected as gone (404/410).
--
-- One row per push endpoint. If a phone is shared, registering the same
-- endpoint under another account moves the row to that account, so a device
-- only ever receives the reminders of the person who last turned them on.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique
    check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  -- Browser-generated keys (base64url) used to encrypt each payload.
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]+={0,2}$' and char_length(p256dh) <= 256),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]+={0,2}$' and char_length(auth) <= 256),
  -- Short label derived from the user agent, e.g. "iPhone" or "Android · Chrome".
  device_label text not null default '' check (char_length(device_label) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text check (disabled_reason in ('turned_off', 'signed_out', 'gone')),
  constraint push_subscriptions_disabled_pair check ((disabled_at is null) = (disabled_reason is null))
);

create index push_subscriptions_active_by_profile
  on public.push_subscriptions (profile_id) where disabled_at is null;

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select on table public.push_subscriptions to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- ── Researcher: register (or refresh) this device ──────────────────────────
-- Upsert by endpoint for the caller's own researcher profile: re-enables a
-- disabled row, refreshes the keys and last_seen_at, and moves an endpoint
-- registered by another account to the caller. Returns the row id, or null
-- when the caller is not a researcher.
create function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_device_label text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'researcher'
  ) then
    return null;
  end if;

  insert into public.push_subscriptions as s (profile_id, endpoint, p256dh, auth, device_label)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, left(coalesce(p_device_label, ''), 80))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        device_label = excluded.device_label,
        -- A device that changed hands counts as newly registered.
        created_at = case when s.profile_id = excluded.profile_id then s.created_at else now() end,
        last_seen_at = now(),
        disabled_at = null,
        disabled_reason = null
  returning s.id into v_id;
  return v_id;
end;
$$;

-- ── Researcher: turn off reminders / sign out on this device ───────────────
-- Disables the caller's own row for this endpoint. Returns whether a row
-- changed; another account's row with the same endpoint is never touched.
create function public.disable_push_subscription(p_endpoint text, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_reason not in ('turned_off', 'signed_out') then
    raise exception 'invalid reason' using errcode = '22023';
  end if;

  update public.push_subscriptions s
  set disabled_at = now(), disabled_reason = p_reason
  where s.endpoint = p_endpoint
    and s.profile_id = (select auth.uid())
    and s.disabled_at is null;
  return found;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.disable_push_subscription(text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.disable_push_subscription(text, text) to authenticated;
