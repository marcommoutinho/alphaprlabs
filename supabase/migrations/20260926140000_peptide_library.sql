-- S4: the peptide library (A2), maintained by admins.
--
-- Access model (deny by default):
--   * Admins read every entry, available or not (A2 maintenance).
--   * A researcher (or an admin using the research side: admins are
--     researchers) who has acknowledged the disclaimer reads AVAILABLE entries
--     only. Nobody else reads anything; anonymous callers have no access.
--     A later slice that lets a researcher keep an unavailable peptide in an
--     existing cycle (S9) adds its own permissive SELECT policy for the
--     entries the caller's own records reference; it must not widen this one.
--   * No direct writes through the API, for anyone. Admins create and edit
--     through save_library_peptide(), which checks is_admin() itself. There is
--     no delete: templates, cycles and stock refer to entries, and turning
--     "available" off is how an entry is withdrawn from new cycles.
--   * An entry is never incomplete in the database: a name and the
--     information researchers see are required (A2 "incomplete entries can't
--     be published").

create table public.peptides (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  -- "Information researchers see".
  information text not null check (information = btrim(information) and char_length(information) between 1 and 4000),
  -- Optional guidance: '' when not supplied.
  cycling_off_guidance text not null default '' check (cycling_off_guidance = btrim(cycling_off_guidance) and char_length(cycling_off_guidance) <= 4000),
  supplement_guidance text not null default '' check (supplement_guidance = btrim(supplement_guidance) and char_length(supplement_guidance) <= 4000),
  -- "Available for new cycles": off hides the entry from new cycles and
  -- templates; existing references keep it.
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index peptides_list_order on public.peptides (created_at, id);

alter table public.peptides enable row level security;
revoke all on table public.peptides from public, anon, authenticated, service_role;
grant select on table public.peptides to authenticated;
-- Server-only code and tests (secret key) read and seed entries.
grant select, insert, update on table public.peptides to service_role;

create policy peptides_admin_select on public.peptides
  for select to authenticated
  using ((select public.is_admin()));

create policy peptides_research_select_available on public.peptides
  for select to authenticated
  using (available and (select public.is_acknowledged_researcher()));

-- ── Admin: create or edit an entry ─────────────────────────────────────────
-- p_id null (the default) creates an entry; otherwise edits it. Text is trimmed; blank
-- optional guidance is stored as ''. Returns the entry id, or null when p_id
-- names no entry. updated_at moves only when something actually changed.
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
  v_name text := btrim(coalesce(p_name, ''));
  v_information text := btrim(coalesce(p_information, ''));
  v_cycling_off text := btrim(coalesce(p_cycling_off_guidance, ''));
  v_supplement text := btrim(coalesce(p_supplement_guidance, ''));
  v_id uuid;
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
