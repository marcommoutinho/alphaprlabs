-- S4: the peptide library (A2), maintained by admins.
--
-- Access model (deny by default):
--   * Ordinary table reads return AVAILABLE entries only, for everyone. The
--     caller must be a researcher (or an admin: admins are researchers and use
--     the research side too) who has acknowledged the disclaimer. Nobody else
--     reads anything; anonymous callers have no access. There is deliberately
--     no admin SELECT policy: permissive policies are ORed, so one would let
--     every admin session see withdrawn entries in research screens (S9 cycle
--     builder, S10 library) unless each caller remembered to filter.
--   * The A2 back office lists every entry, available or not, through
--     admin_library_peptides(), which checks is_admin() itself. It does not
--     require the acknowledgement: the back office never did.
--   * S9 (cycles) will add its own permissive SELECT policy so a researcher
--     can still read an unavailable entry that their own cycles reference. It
--     must be limited to those referenced entries and must not widen the
--     available-only rule for anything else.
--   * No direct writes through the API, for anyone. Admins create and edit
--     through save_library_peptide(), which checks is_admin() itself. There is
--     no delete: templates, cycles and stock refer to entries, and turning
--     "available" off is how an entry is withdrawn from new cycles.
--   * An entry is never incomplete in the database: a name and the
--     information researchers see are required (A2 "incomplete entries can't
--     be published"). Whitespace alone is empty (see trim_whitespace below).
--   * Names are unique, ignoring case and whitespace differences ("BPC-157"
--     and " bpc-157 " are the same peptide): see library_name_key below.

-- Trims the same whitespace as JavaScript's String.prototype.trim (the app's
-- validation, src/lib/library/entry.ts): tab, LF, VT, FF, CR, space, NBSP,
-- U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and the BOM.
-- One-argument btrim() removes spaces only, so a tab or newline would count
-- as content. Stored text must equal its trimmed form, so whitespace-only text
-- is stored as '' and fails the required-field checks.
create function public.trim_whitespace(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    p_text,
    E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005'
      || E'\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'
  );
$$;

revoke all on function public.trim_whitespace(text) from public, anon;
grant execute on function public.trim_whitespace(text) to authenticated, service_role;

-- The key two library names are compared by: trimmed (trim_whitespace), every
-- run of inner whitespace (the same set) as one space, lower-cased. A unique
-- index on it keeps one entry per peptide name.
create function public.library_name_key(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(
    public.trim_whitespace(p_name),
    E'[\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005'
      || E'\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+',
    ' ',
    'g'
  ));
$$;

revoke all on function public.library_name_key(text) from public, anon;
grant execute on function public.library_name_key(text) to authenticated, service_role;

create table public.peptides (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = public.trim_whitespace(name) and char_length(name) between 1 and 120),
  -- "Information researchers see".
  information text not null check (information = public.trim_whitespace(information) and char_length(information) between 1 and 4000),
  -- Optional guidance: '' when not supplied.
  cycling_off_guidance text not null default '' check (cycling_off_guidance = public.trim_whitespace(cycling_off_guidance) and char_length(cycling_off_guidance) <= 4000),
  supplement_guidance text not null default '' check (supplement_guidance = public.trim_whitespace(supplement_guidance) and char_length(supplement_guidance) <= 4000),
  -- "Available for new cycles": off hides the entry from new cycles and
  -- templates; existing references keep it.
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index peptides_list_order on public.peptides (created_at, id);
-- One entry per name (case and whitespace ignored).
create unique index peptides_name_unique on public.peptides (public.library_name_key(name));

alter table public.peptides enable row level security;
revoke all on table public.peptides from public, anon, authenticated, service_role;
grant select on table public.peptides to authenticated;
-- Server-only code and tests (secret key) read and seed entries.
grant select, insert, update on table public.peptides to service_role;

-- Available entries, for acknowledged researchers and admins alike. Never add
-- an admin SELECT policy (see the header); A2 reads through
-- admin_library_peptides(). S9 adds a policy for the unavailable entries the
-- caller's own cycles still reference, and nothing wider.
create policy peptides_research_select_available on public.peptides
  for select to authenticated
  using (available and (select public.is_acknowledged_researcher()));

-- ── Admin: every entry for A2 maintenance ──────────────────────────────────
-- All entries, available or not, oldest first. Admin-only (no acknowledgement
-- needed); researchers and anonymous callers are refused. Research screens
-- must read the table instead, so they only ever see available entries.
create function public.admin_library_peptides()
returns setof public.peptides
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p.* from public.peptides p
    order by p.created_at, p.id;
end;
$$;

revoke all on function public.admin_library_peptides() from public, anon;
grant execute on function public.admin_library_peptides() to authenticated;

-- ── Admin: create or edit an entry ─────────────────────────────────────────
-- p_id null (the default) creates an entry; otherwise edits it. Text is
-- trimmed of all whitespace (trim_whitespace); blank optional guidance is
-- stored as ''. Returns the entry id, or null when p_id names no entry. updated_at moves only when something actually changed.
-- A name another entry already has (library_name_key) is refused with
-- SQLSTATE 23505 (the app shows "A peptide with this name already exists.");
-- an entry keeps, or re-cases, its own name freely.
create function public.save_library_peptide(
  p_name text,
  p_information text,
  p_cycling_off_guidance text,
  p_supplement_guidance text,
  p_available boolean,
  p_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := public.trim_whitespace(coalesce(p_name, ''));
  v_information text := public.trim_whitespace(coalesce(p_information, ''));
  v_cycling_off text := public.trim_whitespace(coalesce(p_cycling_off_guidance, ''));
  v_supplement text := public.trim_whitespace(coalesce(p_supplement_guidance, ''));
  v_id uuid;
  v_constraint text;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_available is null then
    raise exception 'availability required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.peptides (name, information, cycling_off_guidance, supplement_guidance, available)
    values (v_name, v_information, v_cycling_off, v_supplement, p_available)
    returning id into v_id;
    return v_id;
  end if;

  update public.peptides p
  set name = v_name,
      information = v_information,
      cycling_off_guidance = v_cycling_off,
      supplement_guidance = v_supplement,
      available = p_available,
      updated_at = case
        when (p.name, p.information, p.cycling_off_guidance, p.supplement_guidance, p.available)
             is distinct from (v_name, v_information, v_cycling_off, v_supplement, p_available)
        then now() else p.updated_at end
  where p.id = p_id
  returning p.id into v_id;
  return v_id;
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'peptides_name_unique' then
      raise exception 'a peptide with this name already exists'
        using errcode = '23505', constraint = 'peptides_name_unique';
    end if;
    raise;
end;
$$;

revoke all on function public.save_library_peptide(text, text, text, text, boolean, uuid) from public, anon;
grant execute on function public.save_library_peptide(text, text, text, text, boolean, uuid) to authenticated;

-- ── Admin: how many templates and researcher cycles refer to each entry ─────
-- A2 shows "referenced by N" (templates + cycles) per entry, and the editor
-- notes when researcher cycles use it. Counts only: no researcher, cycle or
-- template is identified, so the admin role still reads no private record.
--
-- Contract for later slices: nothing refers to entries yet, so both counts are
-- 0. The slice that adds template plans (S8) and the one that adds researcher
-- cycle plans (S9) each CREATE OR REPLACE this function, keeping its
-- signature, admin check, one row per entry and its grants, to count
-- DISTINCT templates / cycles whose plans name the entry.
create function public.library_reference_counts()
returns table (peptide_id uuid, template_count bigint, cycle_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p.id, 0::bigint, 0::bigint
    from public.peptides p;
end;
$$;

revoke all on function public.library_reference_counts() from public, anon;
grant execute on function public.library_reference_counts() to authenticated;
