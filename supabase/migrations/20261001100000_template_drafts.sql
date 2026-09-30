-- Cycle templates have a draft stage (Marco, 2026-09-30, "Yes to draft
-- stage"; tasks/research-app.md, design v3 rebuild decisions): a template can
-- be saved privately as a draft and published when it's ready, like library
-- entries (20260929110000_admin_content.sql).
--
-- 1. cycle_templates.published_at: null while the template is a draft; the
--    time it was (last) published otherwise. A new template starts as a
--    draft (the column's default). Unlike a library entry, a published
--    template can be moved back to draft, which hides it from researchers
--    again. Every existing template is recorded as published at its creation
--    (production has none; local data does).
--
-- 2. Researchers see published templates only, enforced here, not only in
--    the app:
--      * RLS: the templates, plans and phases policies let an acknowledged
--        researcher read a published template's rows only. Admins
--        (is_admin(), terms aside, as before) read every template, drafts
--        included, for the back office. The app's research screens also ask
--        for published templates explicitly, so an admin browsing the
--        research side sees what researchers see.
--      * template_peptides(p_template_id) (the builder's names for a copy)
--        answers for a published template only, for everyone: a draft gives
--        the same empty answer as an unknown template.
--      * Copying: save_cycle() (and save_cycle_with_mixtures(), which calls
--        it) creates a cycle from a template. A trigger on cycles refuses a
--        new cycle whose template is a draft with save_cycle's own "unknown
--        template" (AP008), so a draft can't be copied even by calling the
--        database directly. save_cycle share-locks the template row before
--        it inserts, and admin_save_template locks it for update, so a
--        template moved to draft concurrently is either copied before the
--        move commits or refused after it, never half. Cycles already made
--        from a template keep their copy (they never read the template
--        again), whatever happens to it later.
--      * Counts: nothing researchers read counts templates. The admin-only
--        counts (admin_cycle_template_usage(), library_reference_counts(),
--        admin_library_entries()) keep counting drafts too.
--
-- 3. admin_save_template gains p_published (the state the template should be
--    in after the save: true publishes it, false keeps or moves it to draft;
--    null, the default, keeps its state, and a new template is a draft) and
--    returns published and newly_published, recorded in
--    admin_content_changes as for peptides (published: the template is
--    published after this save; newly_published: this save published a
--    draft or created a published template). A replay answers them from the
--    change row. Changing the state moves the version (the compare-and-set
--    token) like any content change, so a save from an editor opened before
--    someone published or drafted the template is refused (AP038); it does
--    not move updated_at (the content's date); a template created published
--    starts at version 1 like any new one. Draft and publish run the same
--    rules (save_cycle_template): the difference is visibility only.
--    Signature change: the function is dropped and created again (a new
--    argument and result columns), grants restated. An older app calling it
--    without p_published still works (the state is kept; a new template is
--    a draft).
--
-- Refusal SQLSTATEs are unchanged (see 20260929110000_admin_content.sql).

-- ── 1. The state ───────────────────────────────────────────────────────────
alter table public.cycle_templates add column published_at timestamptz;

-- Existing templates are live: published at creation.
update public.cycle_templates set published_at = created_at;

-- The version moves with the state too (one version per save, as before).
create or replace function public.cycle_templates_track_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- admin_save_template writes the row up to three times in one save (name
  -- and guidance, updated_at once the plans changed, the state): one save is
  -- one version.
  v_marker text := 'alpha.template_version_' || replace(new.id::text, '-', '');
begin
  if (new.name, new.guidance, new.updated_at, new.published_at) is distinct from (old.name, old.guidance, old.updated_at, old.published_at)
     and coalesce(current_setting(v_marker, true), '') <> '1' then
    new.version := old.version + 1;
    perform set_config(v_marker, '1', true);
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

revoke all on function public.cycle_templates_track_version() from public, anon, authenticated, service_role;

-- ── 2. Researchers read published templates only ───────────────────────────
drop policy cycle_templates_select on public.cycle_templates;
drop policy cycle_template_plans_select on public.cycle_template_plans;
drop policy cycle_template_phases_select on public.cycle_template_phases;

create policy cycle_templates_select on public.cycle_templates
  for select to authenticated
  using ((select public.is_admin()) or ((select public.is_acknowledged_researcher()) and published_at is not null));

create policy cycle_template_plans_select on public.cycle_template_plans
  for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_acknowledged_researcher()) and exists (
      select 1 from public.cycle_templates t where t.id = cycle_template_plans.template_id and t.published_at is not null))
  );

create policy cycle_template_phases_select on public.cycle_template_phases
  for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_acknowledged_researcher()) and exists (
      select 1 from public.cycle_template_plans pl
      join public.cycle_templates t on t.id = pl.template_id
      where pl.id = cycle_template_phases.plan_id and t.published_at is not null))
  );

-- The peptides a PUBLISHED template names, to copy it (as in
-- 20260926180000_cycles.sql otherwise): nothing for a draft or an unknown id.
create or replace function public.template_peptides(p_template_id uuid)
returns table (id uuid, name text, available boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.is_acknowledged_researcher()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p.id, p.name, p.available
    from public.peptides p
    where exists (
      select 1 from public.cycle_template_plans pl
      join public.cycle_templates t on t.id = pl.template_id
      where pl.template_id = p_template_id and pl.peptide_id = p.id and t.published_at is not null
    )
    order by p.name, p.id;
end;
$$;

revoke all on function public.template_peptides(uuid) from public, anon;
grant execute on function public.template_peptides(uuid) to authenticated;

-- A new cycle is copied from a published template only (save_cycle's
-- "unknown template", AP008, for a draft). Internal: a trigger function.
create function public.cycles_template_published()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.template_id is not null and not exists (
    select 1 from public.cycle_templates t where t.id = new.template_id and t.published_at is not null
  ) then
    raise exception 'unknown template' using errcode = 'AP008';
  end if;
  return new;
end;
$$;

revoke all on function public.cycles_template_published() from public, anon, authenticated, service_role;

create trigger cycles_template_published before insert on public.cycles
  for each row execute function public.cycles_template_published();

-- ── 3. The admin writer records the state ──────────────────────────────────
drop function public.admin_save_template(uuid, text, uuid, bigint, text, text, jsonb);

create function public.admin_save_template(
  p_request_key uuid,
  p_request_hash text,
  p_id uuid,
  p_expected_version bigint,
  p_name text,
  p_guidance text,
  p_plans jsonb,
  p_published boolean default null
)
returns table (template_id uuid, version bigint, published boolean, newly_published boolean, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claim public.admin_content_changes;
  v_before bigint;
  v_was_published boolean := false;
  v_row public.cycle_templates;
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
      return query select v_claim.target_id, v_claim.version, v_claim.published, v_claim.newly_published, true;
      return;
    end if;
    raise exception 'request key already used for other details' using errcode = 'AP005';
  end if;

  if p_id is not null then
    select t.version, t.published_at is not null into v_before, v_was_published
    from public.cycle_templates t where t.id = p_id for update;
    if not found then
      raise exception 'no such template' using errcode = 'P0002';
    end if;
    if v_before <> p_expected_version then
      raise exception 'the template changed since it was opened' using errcode = 'AP038';
    end if;
  end if;

  -- Every template rule, after the replay and the compare-and-set (drafts
  -- and published templates alike), including "a peptide not offered (or a
  -- draft) is never newly added; one the template names already stays"
  -- (AP007 / AP003).
  v_id := public.save_cycle_template(p_name, p_guidance, p_plans, p_id);
  if v_id is null then
    raise exception 'no such template' using errcode = 'P0002';
  end if;

  -- The state: published keeps its time; drafting clears it. A template
  -- created published is created at version 1: its creation is its first
  -- version (the version trigger's once-per-save marker).
  if p_published is not null and p_published <> v_was_published then
    if p_id is null then
      perform set_config('alpha.template_version_' || replace(v_id::text, '-', ''), '1', true);
    end if;
    update public.cycle_templates t
    set published_at = case when p_published then now() end
    where t.id = v_id;
  end if;
  select t.* into v_row from public.cycle_templates t where t.id = v_id;

  insert into public.admin_content_changes (request_key, request_hash, kind, target_id, version, published, newly_published, changed, changed_by)
  values (p_request_key, p_request_hash, 'template', v_id, v_row.version, v_row.published_at is not null,
          not v_was_published and v_row.published_at is not null,
          v_before is null or v_row.version <> v_before, (select auth.uid()));
  return query select v_id, v_row.version, v_row.published_at is not null, not v_was_published and v_row.published_at is not null, false;
end;
$$;

revoke all on function public.admin_save_template(uuid, text, uuid, bigint, text, text, jsonb, boolean) from public, anon;
grant execute on function public.admin_save_template(uuid, text, uuid, bigint, text, text, jsonb, boolean) to authenticated;
