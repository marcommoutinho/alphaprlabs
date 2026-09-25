-- S2: accounts, roles, researcher acknowledgement and app-managed invitations.
--
-- Access model (deny by default):
--   * profiles: a signed-in user can read only their own row. Nobody can
--     insert/update/delete through the API; role changes happen only with
--     database or secret-key credentials (npm run admin:create).
--   * invitations: admins only, and only through the functions below.
--     Anonymous users and researchers have no access. The invitation page
--     looks a token up server-side with the secret key.
--   * Every function is SECURITY DEFINER with an empty search_path and checks
--     the caller itself; EXECUTE is granted explicitly per function.

create type public.app_role as enum ('admin', 'researcher');
create type public.invitation_state as enum ('pending', 'accepted', 'failed');

-- ── Profiles (1:1 with auth.users) ─────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text not null unique check (email = lower(email)),
  role public.app_role not null,
  -- Researcher disclaimer: which version was accepted and when.
  acknowledgement_version text check (char_length(acknowledgement_version) between 1 and 40),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  constraint profiles_acknowledgement_pair
    check ((acknowledgement_version is null) = (acknowledged_at is null))
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- ── Invitations ────────────────────────────────────────────────────────────
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  -- Optional in the form (A1 shows — when blank); prefills account setup.
  name text not null default '' check (char_length(name) <= 120),
  email text not null check (email = lower(email) and char_length(email) <= 254),
  -- SHA-256 (hex) of a 32-byte random token. The raw token is only ever in
  -- the emailed link.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  state public.invitation_state not null default 'pending',
  sent_at timestamptz not null default now(),
  -- A pending invitation past this instant is shown and treated as Expired.
  expires_at timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  invited_by uuid references public.profiles (id) on delete set null,
  last_send_error text,
  created_at timestamptz not null default now(),
  constraint invitations_accepted_pair check ((state = 'accepted') = (accepted_at is not null))
);

-- At most one open (pending or failed) invitation per email. Inviting an email
-- whose open invitation expired or failed refreshes that row instead.
create unique index invitations_one_open_per_email
  on public.invitations (email) where state in ('pending', 'failed');

alter table public.invitations enable row level security;
revoke all on table public.invitations from public, anon, authenticated;

-- The secret key (server-only code, the admin bootstrap command and tests)
-- bypasses RLS but still needs table privileges.
grant select, insert, update, delete on table public.profiles, public.invitations to service_role;

-- ── Helpers ────────────────────────────────────────────────────────────────
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Admins read the invitation list through RLS. No write grants: writes go
-- through the functions below.
grant select on table public.invitations to authenticated;

create policy invitations_admin_select on public.invitations
  for select to authenticated
  using ((select public.is_admin()));

-- ── Admin: invite / resend / record a failed send ──────────────────────────
-- Returns outcome 'ok' (with the row id), 'account_exists' or 'pending_exists'.
create function public.invite_researcher(p_name text, p_email text, p_token_hash text)
returns table (outcome text, invitation_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_open public.invitations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Serialize concurrent invitations for the same address.
  perform pg_advisory_xact_lock(hashtext('invitation:' || v_email));

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return query select 'account_exists'::text, null::uuid;
    return;
  end if;

  select * into v_open from public.invitations i
  where i.email = v_email and i.state in ('pending', 'failed')
  for update;

  if found and v_open.state = 'pending' and v_open.expires_at > now() then
    return query select 'pending_exists'::text, v_open.id;
    return;
  end if;

  if found then
    update public.invitations i
    set name = btrim(coalesce(p_name, '')), token_hash = p_token_hash, state = 'pending',
        sent_at = now(), expires_at = now() + interval '30 days',
        last_send_error = null, invited_by = (select auth.uid())
    where i.id = v_open.id;
    return query select 'ok'::text, v_open.id;
    return;
  end if;

  return query
    insert into public.invitations (name, email, token_hash, invited_by)
    values (btrim(coalesce(p_name, '')), v_email, p_token_hash, (select auth.uid()))
    returning 'ok'::text, id;
end;
$$;

-- Resend an expired or failed invitation: fresh token, sent now, 30 more days.
-- Returns the row's name and email, or no row if it cannot be resent.
create function public.resend_invitation(p_id uuid, p_token_hash text)
returns table (name text, email text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    update public.invitations i
    set token_hash = p_token_hash, state = 'pending', sent_at = now(),
        expires_at = now() + interval '30 days', last_send_error = null,
        invited_by = (select auth.uid())
    where i.id = p_id
      and (i.state = 'failed' or (i.state = 'pending' and i.expires_at <= now()))
      and not exists (select 1 from auth.users u where lower(u.email) = i.email)
    returning i.name, i.email;
end;
$$;

create function public.mark_invitation_send_failed(p_id uuid, p_error text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.invitations i
  set state = 'failed', last_send_error = left(coalesce(p_error, 'unknown error'), 500)
  where i.id = p_id and i.state = 'pending';
end;
$$;

revoke all on function public.invite_researcher(text, text, text) from public, anon;
revoke all on function public.resend_invitation(uuid, text) from public, anon;
revoke all on function public.mark_invitation_send_failed(uuid, text) from public, anon;
grant execute on function public.invite_researcher(text, text, text) to authenticated;
grant execute on function public.resend_invitation(uuid, text) to authenticated;
grant execute on function public.mark_invitation_send_failed(uuid, text) to authenticated;

-- ── Server only (secret key): accepting an invitation ──────────────────────
-- Claim a valid invitation for acceptance: unexpired, and pending (or marked
-- failed, in case the email arrived anyway). Row locking makes this single
-- use: of two concurrent claims only one gets the row back.
create function public.claim_invitation(p_token_hash text)
returns table (id uuid, name text, email text)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.invitations i
  set state = 'accepted', accepted_at = now()
  where i.token_hash = p_token_hash and i.state in ('pending', 'failed') and i.expires_at > now()
  returning i.id, i.name, i.email;
$$;

-- Undo a claim whose account could not be created.
create function public.release_invitation(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.invitations i
  set state = 'pending', accepted_at = null
  where i.id = p_id and i.state = 'accepted' and i.accepted_user_id is null;
$$;

-- Create the researcher profile for the account made from a claimed invitation.
-- The role is always researcher and the email always the invitation's.
create function public.complete_invitation(p_id uuid, p_user_id uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  update public.invitations i
  set accepted_user_id = p_user_id
  where i.id = p_id and i.state = 'accepted' and i.accepted_user_id is null
  returning i.email into v_email;

  if v_email is null then
    raise exception 'invitation is not claimed' using errcode = 'P0002';
  end if;

  insert into public.profiles (id, name, email, role)
  values (p_user_id, btrim(p_name), v_email, 'researcher');
end;
$$;

revoke all on function public.claim_invitation(text) from public, anon, authenticated;
revoke all on function public.release_invitation(uuid) from public, anon, authenticated;
revoke all on function public.complete_invitation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_invitation(text) to service_role;
grant execute on function public.release_invitation(uuid) to service_role;
grant execute on function public.complete_invitation(uuid, uuid, text) to service_role;

-- ── Researcher: record the disclaimer acknowledgement ──────────────────────
-- Only for the caller's own researcher profile; the time is the server's.
create function public.record_acknowledgement(p_version text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set acknowledgement_version = p_version, acknowledged_at = now()
  where p.id = (select auth.uid()) and p.role = 'researcher';
  return found;
end;
$$;

revoke all on function public.record_acknowledgement(text) from public, anon;
grant execute on function public.record_acknowledgement(text) to authenticated;
