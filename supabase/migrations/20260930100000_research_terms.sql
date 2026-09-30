-- Research terms (Marco, 2026-09-30): the final terms replace the placeholder
-- disclaimer, and "acknowledged" now means "agreed to the CURRENT version".
--
-- 1. The database knows the current version: public.current_terms_version()
--    returns it as a constant ('2026-09-30', the app's ACKNOWLEDGEMENT_VERSION
--    in src/lib/auth/paths.ts; an integration test keeps the two equal).
--    A constant in a function rather than a settings row: the version only
--    changes with new wording, which ships with the app anyway, so a new
--    terms version is one small forward migration that replaces this
--    function, and nothing can drift at runtime. The profiles columns are
--    unchanged: acknowledgement_version and acknowledged_at still hold the
--    version last agreed to and when (the pair check still applies).
--
-- 2. is_acknowledged_researcher() (every database gate on the terms goes
--    through it: can_write_researcher() and so every research write and RLS
--    write policy, the acknowledged-only reads of templates and the library,
--    save_push_subscription, the support-sharing writers) now requires the
--    stored version to be the current one. An agreement to an earlier
--    version ("2026-09-placeholder", everyone in production today) no longer
--    passes, so nobody writes research records until they agree again. What
--    never needed the terms still doesn't: reading one's own records
--    (can_read_researcher), turning a device off, stopping sharing, and the
--    admin back office (is_admin()), which the terms never gated.
--
-- 3. record_acknowledgement(p_version) accepts only the current version
--    (22023 otherwise, nothing written) and, as before, records it on the
--    caller's own profile, researchers and admins, with the server's time.
--    It already accepted a new agreement from someone who had agreed before
--    (an unconditional update), which is how agreeing again stores the new
--    version and time. It returns false, as before, for anyone else.
--
-- Grants are unchanged (CREATE OR REPLACE keeps them; restated below).

-- ── The current research terms version ─────────────────────────────────────
create function public.current_terms_version()
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select '2026-09-30'::text;
$$;

revoke all on function public.current_terms_version() from public, anon;
grant execute on function public.current_terms_version() to authenticated;

-- True when the caller may write research records: a researcher or admin who
-- has agreed to the CURRENT research terms (the app's gate,
-- src/lib/auth/session.ts, checks the same version).
create or replace function public.is_acknowledged_researcher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('researcher', 'admin')
      and p.acknowledged_at is not null
      and p.acknowledgement_version = public.current_terms_version()
  );
$$;

revoke all on function public.is_acknowledged_researcher() from public, anon;
grant execute on function public.is_acknowledged_researcher() to authenticated;

-- ── Researcher or admin: agree to the current research terms ───────────────
-- Only for the caller's own profile; the time is the server's. Agreeing again
-- (after the terms changed) replaces the version and the time.
-- Refusals: 22023 not the current terms version.
create or replace function public.record_acknowledgement(p_version text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_version is distinct from public.current_terms_version() then
    raise exception 'not the current terms version' using errcode = '22023';
  end if;
  update public.profiles p
  set acknowledgement_version = p_version, acknowledged_at = now()
  where p.id = (select auth.uid()) and p.role in ('researcher', 'admin');
  return found;
end;
$$;

revoke all on function public.record_acknowledgement(text) from public, anon;
grant execute on function public.record_acknowledgement(text) to authenticated;
