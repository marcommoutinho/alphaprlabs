-- V7 Admin content (design v3 A8 / A9 / D6 Library, A10 / D7 Templates,
-- A11 / D8 People, A12 Researcher history).
--
-- 1. The library's draft / publish state (Marco, 2026-09-28, "Design v3
--    rebuild decisions": "the library draft / publish state") and the fields
--    the v3 editor has that the library did not store:
--      * published_at: null while the entry is a draft; set once, when it is
--        first published, and never cleared (a published entry never goes
--        back to draft; "Offered for new cycles" off is how it is withdrawn).
--        Every existing entry is live in production, so each one is recorded
--        as published at its creation.
--      * offered: the "Offered for new cycles" switch as the admin set it,
--        kept while the entry is a draft so publishing applies it.
--      * available (existing) is now exactly "published and offered"
--        (peptides_available_rule). Every researcher read path already asks
--        for available entries (peptides_research_select_available) or for
--        entries their own cycles and mixtures reference, and every writer
--        that adds a peptide to a cycle, a template or a mixture already
--        refuses one that is not available (AP007 and the others). A draft is
--        never available, and nothing can reference an entry until it is
--        available, so a draft stays invisible to researchers everywhere
--        (library, peptide page, builder pickers, search, direct REST or RPC)
--        and cannot be added anywhere, with no research-side change.
--      * short_description ("Short description", up to 160 characters) and
--        vial_strengths_mg (the "Vial strengths" chips: up to 12 distinct mg
--        amounts above 0 and up to the 100,000 mg entry limit, at most three
--        decimals, stored ascending without trailing zeros).
--      * information (the "Research summary") may be empty on a draft only:
--        publishing requires it.
--      * version: moves by one or more whenever the entry's content changes
--        (a trigger, so every writer counts), the compare-and-set token below.
--    Templates gain the same version column, moved when the template's name,
--    guidance or content change (save_cycle_template moves updated_at then).
--
-- 2. Idempotent, compare-and-set admin writers (the V5 pattern of
--    set_business_stock_threshold):
--      admin_save_peptide(p_request_key, p_request_hash, p_id,
--        p_expected_version, p_name, p_short_description, p_vial_strengths_mg,
--        p_information, p_cycling_off_guidance, p_supplement_guidance,
--        p_offered, p_publish)
--      admin_save_template(p_request_key, p_request_hash, p_id,
--        p_expected_version, p_name, p_guidance, p_plans)
--    Admins only (is_admin(), 42501). p_id null creates, otherwise edits
--    only over p_expected_version, the version the admin opened: under the
--    row's lock a different version is refused with AP038 ("changed since it
--    was opened"; the app reads who changed it) and nothing is written, so no
--    retry, stale tab or second admin silently overwrites a newer save.
--    p_publish publishes a draft (refused with 22023 without a research
--    summary); false leaves the state as it is (a published entry stays
--    published). The request key is claimed in admin_content_changes and
--    checked first: the same key with the same request hash (the app's
--    SHA-256 of the whole submission, src/lib/request-hash.ts) returns the
--    first answer (replayed) and writes nothing, even after later changes;
--    the same key with another hash is refused with AP005 (the admin
--    writers' "request key reused for other details"). An entry being edited
--    that does not exist is refused with P0002. admin_save_template runs
--    every template rule through save_cycle_template (20260926180200): a
--    peptide not offered, or a draft, can never be newly added (AP007); one
--    the template already names stays (Marco, 2026-09-26).
--    The older writers save_library_peptide and save_cycle_template keep
--    their signatures for existing callers (test fixtures): the library one
--    now creates published entries and sets "offered"; the app uses the new
--    writers only.
--
-- 3. admin_content_changes: one row per committed admin_save_* request (who,
--    when, which entry or template, the version it left, whether it changed
--    anything). Admin screens read the latest change's author ("Changed by
--    Priya since you opened it") through admin_content_last_change(). No one
--    reads or writes the table through the API; it is append-only. Who
--    edited library content is never stored on the peptides or
--    cycle_templates rows, which researchers read: researchers never see
--    admin names or ids.
--
-- 4. Admin reads (each checks is_admin() itself, 42501):
--      * admin_library_entries(): every entry, drafts and not offered ones
--        included, with its strengths as exact text, state, version and the
--        admin-only reference counts (numbers only, never whose cycles).
--      * admin_content_last_change(p_kind, p_id): the current version and the
--        latest recorded change (when, by which admin).
--      * admin_people(): every account's name, email, role and team-share
--        state (shared since, last stopped), and nothing else: a researcher
--        who does not share shows no count, cycle or record here. Histories
--        are still read only through can_read_researcher (the existing share
--        functions, 20260927120000), checked on every request.
--
-- Lock order: each admin_save_* takes its request key's transaction advisory
-- lock first (a concurrent retry waits and then replays), then the row it
-- edits (for update); admin_save_template then takes the peptides it names
-- for share (save_cycle_template). None of them takes a cycle, plan, vial or
-- mixture lock, so the global order of 20260926200100_dose_confirmation.sql
-- (cycle -> plans by id -> vial -> mixtures by id) is untouched; cycle and
-- mixture writers only share-lock peptides, as before.
--
-- Refusal SQLSTATEs: 42501 not an admin; 22023 invalid input (including a
-- publish without a research summary); 23505 a name another entry has;
-- P0002 no such entry or template; AP003 unknown peptide in a template;
-- AP005 request key reused for other details; AP007 a peptide not offered
-- newly added to a template; AP038 (new) changed since it was opened.

-- ── 1. Library columns ─────────────────────────────────────────────────────

-- A canonical strength list: at most 12 distinct amounts above 0 and up to
-- 100,000 mg, at most three decimals, without trailing zeros, ascending.
create function public.is_strength_list(p_strengths numeric[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_strengths is not null
    and cardinality(p_strengths) <= 12
    and array_position(p_strengths, null) is null
    and not exists (
      select 1 from unnest(p_strengths) s
      where s <= 0 or s > 100000 or s <> round(s, 3) or s::text <> trim_scale(s)::text
    )
    and p_strengths = array(select distinct s from unnest(p_strengths) s order by s);
$$;

revoke all on function public.is_strength_list(numeric[]) from public, anon;
grant execute on function public.is_strength_list(numeric[]) to authenticated, service_role;

alter table public.peptides
  add column short_description text not null default ''
    constraint peptides_short_description check (
      short_description = public.trim_whitespace(short_description) and char_length(short_description) <= 160
    ),
  add column vial_strengths_mg numeric[] not null default '{}'
    constraint peptides_vial_strengths check (public.is_strength_list(vial_strengths_mg)),
  add column offered boolean not null default true,
  add column published_at timestamptz,
  add column version bigint not null default 1 constraint peptides_version check (version >= 1);

-- Existing entries are live: published at creation, offered as they were.
update public.peptides set published_at = created_at, offered = available;

-- New rows written without these columns (the older writer, fixtures) are
-- published entries.
alter table public.peptides alter column published_at set default now();

alter table public.peptides
  add constraint peptides_available_rule check (available = (published_at is not null and offered));

-- The research summary may be empty on a draft only.
alter table public.peptides drop constraint peptides_information_check;
alter table public.peptides
  add constraint peptides_information check (
    information = public.trim_whitespace(information)
    and char_length(information) <= 4000
    and (published_at is null or char_length(information) >= 1)
  );

alter table public.cycle_templates
  add column version bigint not null default 1 constraint cycle_templates_version check (version >= 1);

-- Every write, whichever writer: "available" is recomputed as published and
-- offered (a writer that sets only "available", as the older writer and
-- server-side fixtures did, is setting the switch: offered follows it), a
-- published entry never goes back to draft, and the version moves with the
-- content.
create function public.peptides_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.published_at is not null and new.published_at is null then
      raise exception 'a published peptide cannot become a draft' using errcode = '22023';
    end if;
    if new.available is distinct from old.available and new.offered is not distinct from old.offered then
      new.offered := new.available;
    end if;
  elsif new.published_at is not null and not new.available then
    new.offered := false;
  end if;
  new.available := (new.published_at is not null and new.offered);

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'version' - 'updated_at') is distinct from (to_jsonb(old) - 'version' - 'updated_at') then
      new.version := old.version + 1;
      new.updated_at := now();
    else
      new.version := old.version;
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.peptides_before_write() from public, anon, authenticated, service_role;

create trigger peptides_before_write before insert or update on public.peptides
  for each row execute function public.peptides_before_write();

create function public.cycle_templates_track_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.name, new.guidance, new.updated_at) is distinct from (old.name, old.guidance, old.updated_at) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

revoke all on function public.cycle_templates_track_version() from public, anon, authenticated, service_role;

create trigger cycle_templates_track_version before update on public.cycle_templates
  for each row execute function public.cycle_templates_track_version();

-- The older library writer, same signature and grants: it now records the
-- switch as "offered" and creates published entries (a draft it edits stays a
-- draft). The app saves through admin_save_peptide.
create or replace function public.save_library_peptide(
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
  if v_information = '' then
    raise exception 'information required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.peptides (name, information, cycling_off_guidance, supplement_guidance, offered, available, published_at)
    values (v_name, v_information, v_cycling_off, v_supplement, p_available, p_available, now())
    returning id into v_id;
    return v_id;
  end if;

  update public.peptides p
  set name = v_name,
      information = v_information,
      cycling_off_guidance = v_cycling_off,
      supplement_guidance = v_supplement,
      offered = p_available,
      available = (p.published_at is not null and p_available)
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

-- ── 3. Change log and request keys ─────────────────────────────────────────
create table public.admin_content_changes (
  request_key uuid primary key,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('peptide', 'template')),
  target_id uuid not null,
  -- The version the save left (the same as before when nothing changed).
  version bigint not null check (version >= 1),
  -- The entry was published after this save (peptides; false for templates).
  published boolean not null default false,
  changed boolean not null,
  changed_by uuid not null references public.profiles (id) on delete restrict,
  changed_at timestamptz not null default clock_timestamp()
);

create index admin_content_changes_by_target on public.admin_content_changes (kind, target_id, version desc);

alter table public.admin_content_changes enable row level security;
revoke all on table public.admin_content_changes from public, anon, authenticated, service_role;
grant select on table public.admin_content_changes to service_role;

create function public.admin_content_changes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'recorded changes cannot be changed' using errcode = '42501';
end;
$$;

revoke all on function public.admin_content_changes_guard() from public, anon, authenticated, service_role;

create trigger admin_content_changes_append_only before update or delete on public.admin_content_changes
  for each row execute function public.admin_content_changes_guard();
create trigger admin_content_changes_no_truncate before truncate on public.admin_content_changes
  for each statement execute function public.admin_content_changes_guard();

-- ── 2. Writers ─────────────────────────────────────────────────────────────

create function public.admin_save_peptide(
  p_request_key uuid,
  p_request_hash text,
  p_id uuid,
  p_expected_version bigint,
  p_name text,
  p_short_description text,
  p_vial_strengths_mg text[],
  p_information text,
  p_cycling_off_guidance text,
  p_supplement_guidance text,
  p_offered boolean,
  p_publish boolean
)
returns table (peptide_id uuid, version bigint, published boolean, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := public.trim_whitespace(coalesce(p_name, ''));
  v_short text := public.trim_whitespace(coalesce(p_short_description, ''));
  v_information text := public.trim_whitespace(coalesce(p_information, ''));
  v_cycling_off text := public.trim_whitespace(coalesce(p_cycling_off_guidance, ''));
  v_supplement text := public.trim_whitespace(coalesce(p_supplement_guidance, ''));
  v_strengths numeric[];
  v_claim public.admin_content_changes;
  v_row public.peptides;
  v_before bigint;
  v_published timestamptz;
  v_constraint text;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'request key and hash required' using errcode = '22023';
  end if;
  if p_offered is null or p_publish is null then
    raise exception 'offered and publish required' using errcode = '22023';
  end if;
  if p_id is not null and (p_expected_version is null or p_expected_version < 1) then
    raise exception 'the version the entry was opened at is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin_content:' || p_request_key::text, 0));

  select c.* into v_claim from public.admin_content_changes c where c.request_key = p_request_key;
  if found then
    if v_claim.kind = 'peptide' and v_claim.request_hash = p_request_hash then
      return query select v_claim.target_id, v_claim.version, v_claim.published, true;
      return;
    end if;
    raise exception 'request key already used for other details' using errcode = 'AP005';
  end if;

  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'a name of 1 to 120 characters is required' using errcode = '22023';
  end if;
  if p_vial_strengths_mg is null or cardinality(p_vial_strengths_mg) > 12
     or exists (select 1 from unnest(p_vial_strengths_mg) s where s is null or s !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$') then
    raise exception 'invalid vial strengths' using errcode = '22023';
  end if;
  v_strengths := array(select distinct trim_scale(s::numeric) from unnest(p_vial_strengths_mg) s order by 1);
  if cardinality(v_strengths) <> cardinality(p_vial_strengths_mg) or not public.is_strength_list(v_strengths) then
    raise exception 'invalid vial strengths' using errcode = '22023';
  end if;

  if p_id is null then
    if p_publish and v_information = '' then
      raise exception 'a research summary is required to publish' using errcode = '22023';
    end if;
    v_published := case when p_publish then now() end;
    insert into public.peptides (
      name, short_description, vial_strengths_mg, information, cycling_off_guidance, supplement_guidance,
      offered, available, published_at
    ) values (
      v_name, v_short, v_strengths, v_information, v_cycling_off, v_supplement,
      p_offered, (v_published is not null and p_offered), v_published
    )
    returning * into v_row;
    insert into public.admin_content_changes (request_key, request_hash, kind, target_id, version, published, changed, changed_by)
    values (p_request_key, p_request_hash, 'peptide', v_row.id, v_row.version, v_row.published_at is not null, true, (select auth.uid()));
    return query select v_row.id, v_row.version, v_row.published_at is not null, false;
    return;
  end if;

  select p.* into v_row from public.peptides p where p.id = p_id for update;
  if not found then
    raise exception 'no such library entry' using errcode = 'P0002';
  end if;
  -- Compare-and-set, under the entry's lock: only over the version the admin opened.
  if v_row.version <> p_expected_version then
    raise exception 'the entry changed since it was opened' using errcode = 'AP038';
  end if;
  v_published := coalesce(v_row.published_at, case when p_publish then now() end);
  if v_published is not null and v_information = '' then
    raise exception 'a research summary is required to publish' using errcode = '22023';
  end if;
  v_before := v_row.version;

  update public.peptides p
  set name = v_name,
      short_description = v_short,
      vial_strengths_mg = v_strengths,
      information = v_information,
      cycling_off_guidance = v_cycling_off,
      supplement_guidance = v_supplement,
      offered = p_offered,
      published_at = v_published,
      available = (v_published is not null and p_offered)
  where p.id = p_id
  returning * into v_row;

  insert into public.admin_content_changes (request_key, request_hash, kind, target_id, version, published, changed, changed_by)
  values (p_request_key, p_request_hash, 'peptide', v_row.id, v_row.version, v_row.published_at is not null,
          v_row.version <> v_before, (select auth.uid()));
  return query select v_row.id, v_row.version, v_row.published_at is not null, false;
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'peptides_name_unique' then
      raise exception 'a peptide with this name already exists'
        using errcode = '23505', constraint = 'peptides_name_unique';
    end if;
    raise;
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid library entry: %', sqlerrm using errcode = '22023';
end;
$$;

revoke all on function public.admin_save_peptide(uuid, text, uuid, bigint, text, text, text[], text, text, text, boolean, boolean)
  from public, anon;
grant execute on function public.admin_save_peptide(uuid, text, uuid, bigint, text, text, text[], text, text, text, boolean, boolean)
  to authenticated;

create function public.admin_save_template(
  p_request_key uuid,
  p_request_hash text,
  p_id uuid,
  p_expected_version bigint,
  p_name text,
  p_guidance text,
  p_plans jsonb
)
returns table (template_id uuid, version bigint, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claim public.admin_content_changes;
  v_before bigint;
  v_after bigint;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'request key and hash required' using errcode = '22023';
  end if;
  if p_id is not null and (p_expected_version is null or p_expected_version < 1) then
    raise exception 'the version the template was opened at is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin_content:' || p_request_key::text, 0));

  select c.* into v_claim from public.admin_content_changes c where c.request_key = p_request_key;
  if found then
    if v_claim.kind = 'template' and v_claim.request_hash = p_request_hash then
      return query select v_claim.target_id, v_claim.version, true;
      return;
    end if;
    raise exception 'request key already used for other details' using errcode = 'AP005';
  end if;

  if p_id is not null then
    select t.version into v_before from public.cycle_templates t where t.id = p_id for update;
    if not found then
      raise exception 'no such template' using errcode = 'P0002';
    end if;
    if v_before <> p_expected_version then
      raise exception 'the template changed since it was opened' using errcode = 'AP038';
    end if;
  end if;

  -- Every template rule, including "a peptide not offered (or a draft) is
  -- never newly added; one the template names already stays".
  v_id := public.save_cycle_template(p_name, p_guidance, p_plans, p_id);
  if v_id is null then
    raise exception 'no such template' using errcode = 'P0002';
  end if;
  select t.version into v_after from public.cycle_templates t where t.id = v_id;

  insert into public.admin_content_changes (request_key, request_hash, kind, target_id, version, changed, changed_by)
  values (p_request_key, p_request_hash, 'template', v_id, v_after, v_before is null or v_after <> v_before, (select auth.uid()));
  return query select v_id, v_after, false;
end;
$$;

revoke all on function public.admin_save_template(uuid, text, uuid, bigint, text, text, jsonb) from public, anon;
grant execute on function public.admin_save_template(uuid, text, uuid, bigint, text, text, jsonb) to authenticated;

-- ── 4. Admin reads ─────────────────────────────────────────────────────────

-- Every library entry with its state, exact strengths and reference counts.
create function public.admin_library_entries()
returns table (
  id uuid,
  name text,
  short_description text,
  vial_strengths_mg text[],
  information text,
  cycling_off_guidance text,
  supplement_guidance text,
  offered boolean,
  published_at timestamptz,
  available boolean,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz,
  template_count bigint,
  cycle_count bigint
)
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
    select p.id, p.name, p.short_description,
           array(select trim_scale(s)::text from unnest(p.vial_strengths_mg) s),
           p.information, p.cycling_off_guidance, p.supplement_guidance,
           p.offered, p.published_at, p.available, p.version, p.created_at, p.updated_at,
           (select count(distinct pl.template_id) from public.cycle_template_plans pl where pl.peptide_id = p.id)::bigint,
           (select count(distinct cp.cycle_id) from public.cycle_plans cp where cp.peptide_id = p.id)::bigint
    from public.peptides p
    order by p.id;
end;
$$;

revoke all on function public.admin_library_entries() from public, anon;
grant execute on function public.admin_library_entries() to authenticated;

-- The current version of an entry or template and its latest recorded change.
create function public.admin_content_last_change(p_kind text, p_id uuid)
returns table (version bigint, updated_at timestamptz, changed_at timestamptz, changed_by_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('peptide', 'template') or p_id is null then
    raise exception 'kind and id required' using errcode = '22023';
  end if;

  return query
    with target as (
      select p.version, p.updated_at from public.peptides p where p_kind = 'peptide' and p.id = p_id
      union all
      select t.version, t.updated_at from public.cycle_templates t where p_kind = 'template' and t.id = p_id
    ),
    latest as (
      select c.changed_at, pr.name
      from public.admin_content_changes c
      join public.profiles pr on pr.id = c.changed_by
      where c.kind = p_kind and c.target_id = p_id and c.changed
      order by c.version desc, c.changed_at desc
      limit 1
    )
    select target.version, target.updated_at, latest.changed_at, latest.name
    from target left join latest on true;
end;
$$;

revoke all on function public.admin_content_last_change(text, uuid) from public, anon;
grant execute on function public.admin_content_last_change(text, uuid) to authenticated;

-- A11 / D8 People: every account's name, email, role and share state.
create function public.admin_people()
returns table (profile_id uuid, name text, email text, role public.app_role, shared_since timestamptz, stopped_at timestamptz)
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
    select
      p.id,
      p.name,
      p.email,
      p.role,
      active.started_at,
      (select max(s.stopped_at) from public.support_shares s where s.researcher_id = p.id and s.stopped_at is not null)
    from public.profiles p
    left join public.support_shares active on active.researcher_id = p.id and active.stopped_at is null
    where p.role in ('researcher', 'admin')
    order by p.id;
end;
$$;

revoke all on function public.admin_people() from public, anon;
grant execute on function public.admin_people() to authenticated;
