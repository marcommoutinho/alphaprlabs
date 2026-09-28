-- V5 Business (design v3 A1, A2, A13, D9, A3, D4, A6; tasks/research-app.md
-- "Design v3 rebuild decisions": per-item low-stock threshold, default 10
-- vials; the Business period views with month-over-month on matching days).
--
-- 1. Per-item low-stock threshold. business_stock_items gains
--    low_stock_threshold (whole vials, 0 to 100,000, default 10). An item is
--    low when its vials on hand are fewer than its threshold
--    (src/lib/business/stock.ts isLow); 0 never flags it. The column is
--    added with a constant default, which PostgreSQL applies without
--    rewriting or updating any row (no UPDATE trigger fires, so the
--    append-only guard is not involved): every existing item, production's
--    opening stock included, reads 10.
--
--    Only set_business_stock_threshold(p_request_key, p_stock_item_id,
--    p_threshold) changes it: admins only (is_admin(), 42501 otherwise),
--    22023 for a missing key or item or a threshold outside 0..100000, AP002
--    for an unknown item. Every call that commits records who set which
--    threshold when, and the one it replaced, in
--    business_stock_threshold_changes (append-only, admin-readable). The
--    request key is claimed there: the same key with the same item and
--    threshold again returns that result (replayed) and changes nothing, so
--    a retry arriving after a later change never undoes it; the same key
--    with another item or threshold is refused with AP005 (the business
--    writers' "idempotency key reused for different details").
--
-- 2. The append-only guard (business_records_guard, last replaced in
--    20260927160000_sellers_admin_invites.sql) gains one exception, made the
--    same way as the sale link's: an UPDATE of a stock item passes only while
--    set_business_stock_threshold has marked that very item in a
--    transaction-local setting (nothing reachable through the API can set
--    it), and then only low_stock_threshold may differ: every other column,
--    including any added later, must stay exactly as recorded. The sale-link
--    exception is kept unchanged. Deletes and truncates are refused as
--    before, and the new changes table is guarded too.
--
-- 3. Admin-only reads for the Business screens, each checking is_admin()
--    itself (42501), amounts as exact decimal text summed in the database
--    (so no total depends on how many rows the API returns per request),
--    dates as business dates (America/Toronto calendar days, as sold_on and
--    received_on are recorded):
--      * admin_business_stock_levels(p_today): per stock item, vials on
--        hand, their value at cost (each purchase lot's vials not yet
--        allocated to a sale, at that lot's CAD cost: the FIFO view of what
--        is left), vials sold in the 30 days ending p_today (p_today - 29
--        through p_today), the threshold and its last change (when and by
--        which admin: admin screens only). Paged by stock_item_id.
--      * admin_business_sales_by_day(p_from, p_to): one row per day of the
--        range, days without sales included as zeros (at most 400 days).
--      * admin_business_sales_summary(p_from, p_to): one row of totals.
--      * admin_business_months(p_from, p_to): one row per calendar month
--        touched by the range (at most 36), with the totals of its sales and
--        supplier purchases (CAD total_cost and how many were recorded)
--        dated within the range: a range ending today gives this month to
--        date, one starting mid-month a partial first month.
--      * admin_business_purchase_suppliers(p_from, p_to): purchases in the
--        range grouped by supplier, with their CAD total, how many and the
--        currencies they were entered in. Suppliers are recorded on
--        purchases from V6; until then every purchase is in the group with
--        no supplier (supplier_key '', supplier_name null), which V6
--        replaces with a grouping by the recorded supplier.
--    Each range is inclusive and required (22023 when missing, reversed or
--    too long). The month-over-month rule (a partial current month compared
--    with the same day numbers of the previous month) is applied by the app
--    (src/lib/business/period.ts sameDaysWindow), which asks
--    admin_business_sales_summary for both windows.
--
-- Lock order: nothing here takes a cycle, plan, vial or mixture lock, so the
-- global order of 20260926200100_dose_confirmation.sql (cycle -> plans by id
-- -> vial -> mixtures by id) is untouched. set_business_stock_threshold takes
-- its request key's transaction advisory lock first (a concurrent retry waits
-- and then replays), then the stock item's row lock: the order every
-- business writer uses (idempotency key, then stock item), so it serializes
-- with sales and purchases of that item and never waits on them in a cycle.
--
-- Access (deny by default): the changes table is readable by admins only
-- (RLS) and written only by the function; the reads refuse non-admins. No
-- new refusal SQLSTATE (the existing AP002, AP005, 22023 and 42501).

-- ── 1. Threshold column and its history ────────────────────────────────────
alter table public.business_stock_items
  add column low_stock_threshold integer not null default 10;

alter table public.business_stock_items
  add constraint business_stock_items_low_stock_threshold check (low_stock_threshold between 0 and 100000);

create table public.business_stock_threshold_changes (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.business_stock_items (id) on delete restrict,
  previous_threshold integer not null,
  threshold integer not null check (threshold between 0 and 100000),
  request_key uuid not null unique,
  changed_by uuid not null references public.profiles (id) on delete restrict,
  changed_at timestamptz not null default clock_timestamp()
);

create index business_stock_threshold_changes_by_item
  on public.business_stock_threshold_changes (stock_item_id, changed_at desc);

alter table public.business_stock_threshold_changes enable row level security;
revoke all on table public.business_stock_threshold_changes from public, anon, authenticated, service_role;
grant select on table public.business_stock_threshold_changes to authenticated, service_role;

create policy business_stock_threshold_changes_admin_select on public.business_stock_threshold_changes
  for select to authenticated using ((select public.is_admin()));

-- ── 2. The append-only guard, with its two exceptions ──────────────────────
create or replace function public.business_records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'business_sales' and tg_level = 'ROW' then
    if coalesce(current_setting('app.business_sale_link', true), '') = old.id::text
       and old.buyer_type = 'outside' and old.linked_at is null
       and new.buyer_type = 'account' and new.buyer_profile_id is not null
       and new.original_buyer_name = old.buyer_name
       and new.linked_at is not null and new.linked_by is not null
       and (new.id, new.stock_item_id, new.sold_on, new.quantity, new.unit_price, new.currency, new.revenue, new.cost,
            new.idempotency_key, new.recorded_by, new.recorded_at, new.seller_id, new.seller_name)
           is not distinct from
           (old.id, old.stock_item_id, old.sold_on, old.quantity, old.unit_price, old.currency, old.revenue, old.cost,
            old.idempotency_key, old.recorded_by, old.recorded_at, old.seller_id, old.seller_name) then
      return new;
    end if;
  end if;
  -- V5: a stock item's low-stock threshold, set by set_business_stock_threshold
  -- for the item it marked; every other column stays exactly as recorded.
  if tg_op = 'UPDATE' and tg_table_name = 'business_stock_items' and tg_level = 'ROW' then
    if coalesce(current_setting('app.business_stock_threshold', true), '') = old.id::text
       and (to_jsonb(new) - 'low_stock_threshold') = (to_jsonb(old) - 'low_stock_threshold') then
      return new;
    end if;
  end if;
  raise exception 'recorded business stock, purchases and sales cannot be changed' using errcode = '42501';
end;
$$;

revoke all on function public.business_records_guard() from public, anon, authenticated, service_role;

create trigger business_stock_threshold_changes_guard before update or delete on public.business_stock_threshold_changes
  for each row execute function public.business_records_guard();
create trigger business_stock_threshold_changes_no_truncate before truncate on public.business_stock_threshold_changes
  for each statement execute function public.business_records_guard();

-- ── Admin: set an item's low-stock threshold ───────────────────────────────
create function public.set_business_stock_threshold(p_request_key uuid, p_stock_item_id uuid, p_threshold integer)
returns table (item_id uuid, threshold integer, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claim public.business_stock_threshold_changes;
  v_previous integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_request_key is null then
    raise exception 'request key required' using errcode = '22023';
  end if;
  if p_stock_item_id is null then
    raise exception 'stock item required' using errcode = '22023';
  end if;
  if p_threshold is null or p_threshold not between 0 and 100000 then
    raise exception 'the threshold must be a whole number of vials from 0 to 100000' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('business_stock_threshold:' || p_request_key::text, 0));

  select c.* into v_claim from public.business_stock_threshold_changes c where c.request_key = p_request_key;
  if found then
    if v_claim.stock_item_id = p_stock_item_id and v_claim.threshold = p_threshold then
      return query select v_claim.stock_item_id, v_claim.threshold, true;
      return;
    end if;
    raise exception 'request key already used for other details' using errcode = 'AP005';
  end if;

  select i.low_stock_threshold into v_previous
  from public.business_stock_items i where i.id = p_stock_item_id
  for update;
  if not found then
    raise exception 'unknown stock item' using errcode = 'AP002';
  end if;

  insert into public.business_stock_threshold_changes (stock_item_id, previous_threshold, threshold, request_key, changed_by)
  values (p_stock_item_id, v_previous, p_threshold, p_request_key, (select auth.uid()));

  if v_previous <> p_threshold then
    perform set_config('app.business_stock_threshold', p_stock_item_id::text, true);
    update public.business_stock_items i set low_stock_threshold = p_threshold where i.id = p_stock_item_id;
    perform set_config('app.business_stock_threshold', '', true);
  end if;

  return query select p_stock_item_id, p_threshold, false;
end;
$$;

revoke all on function public.set_business_stock_threshold(uuid, uuid, integer) from public, anon;
grant execute on function public.set_business_stock_threshold(uuid, uuid, integer) to authenticated;

-- ── 3. Admin reads ─────────────────────────────────────────────────────────

-- Stock levels (A3 / D4 Stock, A1 / A2 low stock and stock value).
create function public.admin_business_stock_levels(p_today date default null)
returns table (
  stock_item_id uuid,
  peptide_id uuid,
  peptide_name text,
  peptide_available boolean,
  strength_mg text,
  on_hand bigint,
  value_at_cost text,
  sold_30d bigint,
  low_stock_threshold integer,
  threshold_changed_at timestamptz,
  threshold_changed_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, public.business_latest_date());
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select i.id, p.id, p.name, p.available, i.strength_mg::text,
           coalesce(lots.on_hand, 0)::bigint,
           round(coalesce(lots.value, 0), 2)::text,
           coalesce(recent.vials, 0)::bigint,
           i.low_stock_threshold,
           last_change.changed_at,
           last_change.changed_by_name
    from public.business_stock_items i
    join public.peptides p on p.id = i.peptide_id
    left join (
      select bp.stock_item_id as item,
             sum(bp.quantity - coalesce(used.quantity, 0)) as on_hand,
             sum((bp.quantity - coalesce(used.quantity, 0)) * bp.unit_cost) as value
      from public.business_purchases bp
      left join (
        select a.purchase_id as lot, sum(a.quantity) as quantity
        from public.business_sale_allocations a group by a.purchase_id
      ) used on used.lot = bp.id
      group by bp.stock_item_id
    ) lots on lots.item = i.id
    left join (
      select bs.stock_item_id as item, sum(bs.quantity) as vials
      from public.business_sales bs
      where bs.sold_on between v_today - 29 and v_today
      group by bs.stock_item_id
    ) recent on recent.item = i.id
    left join lateral (
      select c.changed_at, left(public.trim_whitespace(pr.name), 120) as changed_by_name
      from public.business_stock_threshold_changes c
      left join public.profiles pr on pr.id = c.changed_by
      where c.stock_item_id = i.id
      order by c.changed_at desc, c.id desc
      limit 1
    ) last_change on true
    order by i.id;
end;
$$;

-- Sales per day, zeros included (A1 / A2 revenue by day).
create function public.admin_business_sales_by_day(p_from date, p_to date)
returns table (day date, sales bigint, vials bigint, revenue text, cost text, gross_profit text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 399 then
    raise exception 'give a range of 1 to 400 days' using errcode = '22023';
  end if;

  return query
    select d.day, coalesce(s.sales, 0)::bigint, coalesce(s.vials, 0)::bigint,
           round(coalesce(s.revenue, 0), 2)::text, round(coalesce(s.cost, 0), 2)::text,
           round(coalesce(s.gross_profit, 0), 2)::text
    from (select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) d
    left join (
      select bs.sold_on, count(*) as sales, sum(bs.quantity) as vials, sum(bs.revenue) as revenue,
             sum(bs.cost) as cost, sum(bs.gross_profit) as gross_profit
      from public.business_sales bs
      where bs.sold_on between p_from and p_to
      group by bs.sold_on
    ) s on s.sold_on = d.day
    order by d.day;
end;
$$;

-- Sales totals for a range (A1 / A2 Now block; A13 / D9 same-days comparison).
create function public.admin_business_sales_summary(p_from date, p_to date)
returns table (sales bigint, vials bigint, revenue text, cost text, gross_profit text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'give a range of days' using errcode = '22023';
  end if;

  return query
    select count(*)::bigint, coalesce(sum(bs.quantity), 0)::bigint,
           round(coalesce(sum(bs.revenue), 0), 2)::text, round(coalesce(sum(bs.cost), 0), 2)::text,
           round(coalesce(sum(bs.gross_profit), 0), 2)::text
    from public.business_sales bs
    where bs.sold_on between p_from and p_to;
end;
$$;

-- Months (A13 / D9): sales and supplier purchases per calendar month.
create function public.admin_business_months(p_from date, p_to date)
returns table (
  month date,
  sales bigint,
  vials bigint,
  revenue text,
  cost text,
  gross_profit text,
  purchases text,
  purchase_orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first date;
  v_last date;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'give a range of months' using errcode = '22023';
  end if;
  v_first := date_trunc('month', p_from::timestamp)::date;
  v_last := date_trunc('month', p_to::timestamp)::date;
  if v_last > (v_first + interval '35 months')::date then
    raise exception 'give a range of 1 to 36 months' using errcode = '22023';
  end if;

  return query
    select m.month, coalesce(s.sales, 0)::bigint, coalesce(s.vials, 0)::bigint,
           round(coalesce(s.revenue, 0), 2)::text, round(coalesce(s.cost, 0), 2)::text,
           round(coalesce(s.gross_profit, 0), 2)::text,
           round(coalesce(b.total, 0), 2)::text, coalesce(b.orders, 0)::bigint
    from (select g::date as month from generate_series(v_first::timestamp, v_last::timestamp, interval '1 month') g) m
    left join (
      select date_trunc('month', bs.sold_on::timestamp)::date as month, count(*) as sales, sum(bs.quantity) as vials,
             sum(bs.revenue) as revenue, sum(bs.cost) as cost, sum(bs.gross_profit) as gross_profit
      from public.business_sales bs
      where bs.sold_on between p_from and p_to
      group by 1
    ) s on s.month = m.month
    left join (
      select date_trunc('month', bp.received_on::timestamp)::date as month, count(*) as orders, sum(bp.total_cost) as total
      from public.business_purchases bp
      where bp.received_on between p_from and p_to
      group by 1
    ) b on b.month = m.month
    order by m.month;
end;
$$;

-- Purchases by supplier (A13 / D9). No supplier is recorded yet (V6): one group.
create function public.admin_business_purchase_suppliers(p_from date, p_to date)
returns table (supplier_key text, supplier_name text, orders bigint, total text, currencies text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'give a range of days' using errcode = '22023';
  end if;

  return query
    select ''::text, null::text, count(*)::bigint, round(sum(bp.total_cost), 2)::text,
           array_agg(distinct bp.original_currency order by bp.original_currency)
    from public.business_purchases bp
    where bp.received_on between p_from and p_to
    having count(*) > 0;
end;
$$;

revoke all on function public.admin_business_stock_levels(date) from public, anon;
revoke all on function public.admin_business_sales_by_day(date, date) from public, anon;
revoke all on function public.admin_business_sales_summary(date, date) from public, anon;
revoke all on function public.admin_business_months(date, date) from public, anon;
revoke all on function public.admin_business_purchase_suppliers(date, date) from public, anon;
grant execute on function public.admin_business_stock_levels(date) to authenticated;
grant execute on function public.admin_business_sales_by_day(date, date) to authenticated;
grant execute on function public.admin_business_sales_summary(date, date) to authenticated;
grant execute on function public.admin_business_months(date, date) to authenticated;
grant execute on function public.admin_business_purchase_suppliers(date, date) to authenticated;
