-- S5: business inventory, purchases and manual sales with frozen FIFO cost
-- (handoff A4-A7; plan "Routine implementation rules" and D1/D2). This file
-- holds the tables, access and integrity triggers; the write functions are in
-- 20260926160100_business_inventory_writes.sql and the admin reads in
-- 20260926160200_business_inventory_reads.sql.
--
-- Access model (deny by default):
--   * Admin-only financial records. Researchers (acknowledged or not) and
--     anonymous callers read nothing: anon has no grants at all, and the only
--     SELECT policy is is_admin(). Business stock is never a researcher's
--     personal supplies and nothing here touches researcher tables.
--   * No direct writes through the API, for anyone (the secret key included):
--     purchases and sales are recorded only through record_business_purchase()
--     and record_business_sale(), which check is_admin() themselves.
--   * Append-only. Recorded stock items, purchases, sales and allocations are
--     never edited or deleted (a trigger refuses every UPDATE, DELETE and
--     TRUNCATE, even the database owner's ordinary statements): historical
--     gross profit must not change, and corrections are out of scope for the
--     MVP (handoff open decision 2).
--   * Attribution is permanent. recorded_by and buyer_profile_id reference
--     profiles ON DELETE RESTRICT, so a profile that recorded or bought stock
--     cannot be hard-deleted (accounts are never fully erased; closing one is
--     a soft delete: tasks/research-app.md "Library and account-data
--     decisions"). There is therefore no ON DELETE SET NULL cascade to admit,
--     and the append-only guard has no exception at all.
--
-- Money: CAD only (D1), stored in the explicit `currency` column, as exact
-- numeric(12,2) per vial and numeric(14,2) for totals: never floating point.
-- The functions take amounts as decimal STRINGS ('40', '40.5', '40.50') with
-- at most two decimal places, so no binary float is ever involved between the
-- form and the database; more decimals are refused rather than rounded. Reads
-- cast amounts to text for the same reason (src/lib/inventory/service.ts).
--
-- Quantities are whole vials (integer, 1..100000). A vial strength is a mg
-- decimal string with at most three decimal places, stored without trailing
-- zeros ('8', '2.5'), so '8', '8.0' and '8.000' are the same stock item.
--
-- FIFO (D2): a sale takes the oldest remaining purchase quantities of its
-- stock item first, by received date, then recording order (recorded_order,
-- an always-generated identity: see business_purchases). The sale stores
-- its revenue and cost and one allocation row per purchase lot with a COPY of
-- that lot's unit cost and date, so later purchases never change it.
--
-- Concurrency: each write takes a transaction advisory lock on its idempotency
-- key, then a row lock on the stock item. Sales and purchases of one item are
-- therefore serialized: two sales can never both see the same remaining stock.
--
-- Dates: a purchase or sale cannot be dated in the future (Marco,
-- 2026-09-26); a sale may be dated before the purchase whose stock it uses.
-- "Today" is the date in the business time zone, America/Toronto (Marco,
-- 2026-09-26: the business is local only). The database refuses a date later
-- than that (public.business_latest_date()); the app checks the same date
-- first (src/lib/inventory/screens.ts businessToday, passed to
-- src/lib/inventory/rules.ts) to give the designed messages.
--
-- Refusals (SQLSTATE; the app maps them, src/lib/inventory/service.ts):
--   42501 not an admin              22023 invalid input (message names it)
--   AP001 insufficient stock (DETAIL = vials on hand)
--   AP002 unknown stock item        AP003 unknown peptide
--   AP004 unknown buyer account     AP005 idempotency key reused for different details
--   AP006 date in the future

create type public.business_buyer_type as enum ('account', 'outside');

-- ── Stock items: one per library peptide and vial strength ─────────────────
create table public.business_stock_items (
  id uuid primary key default gen_random_uuid(),
  peptide_id uuid not null references public.peptides (id) on delete restrict,
  strength_mg numeric not null check (
    strength_mg > 0 and strength_mg <= 100000
    and strength_mg = trim_scale(strength_mg) and scale(strength_mg) <= 3
  ),
  created_at timestamptz not null default now(),
  constraint business_stock_items_one_per_strength unique (peptide_id, strength_mg)
);

-- ── Purchases: the lots FIFO allocates from ────────────────────────────────
create table public.business_purchases (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.business_stock_items (id) on delete restrict,
  received_on date not null,
  quantity integer not null check (quantity between 1 and 100000),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0 and unit_cost <= 1000000),
  total_cost numeric(14, 2) generated always as (quantity * unit_cost) stored,
  currency text not null default 'CAD' check (currency = 'CAD'),
  idempotency_key uuid not null unique,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  -- FIFO tie-break between lots received the same day: the order they were
  -- recorded in. The handoff says "by date, then id" (README Business Rules
  -- 4), where the prototype's ids are insertion-ordered (p1, p2, ...); UUIDs
  -- are random, so this monotonic identity carries that meaning instead.
  -- Purchases of one item are inserted under that item's row lock, so their
  -- order here is their recording order. src/lib/inventory/rules.ts
  -- allocateFifo sorts the preview by exactly (received_on, recorded_order).
  recorded_order bigint generated always as identity,
  constraint business_purchases_recorded_order_unique unique (recorded_order)
);

create index business_purchases_fifo on public.business_purchases (stock_item_id, received_on, recorded_order);

-- ── Sales, with revenue and cost frozen at the time of the sale ────────────
create table public.business_sales (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.business_stock_items (id) on delete restrict,
  sold_on date not null,
  quantity integer not null check (quantity between 1 and 100000),
  unit_price numeric(12, 2) not null check (unit_price >= 0 and unit_price <= 1000000),
  currency text not null default 'CAD' check (currency = 'CAD'),
  revenue numeric(14, 2) not null,
  -- Cost of the vials sold (FIFO): the sum of this sale's allocations.
  cost numeric(14, 2) not null check (cost >= 0),
  gross_profit numeric(14, 2) generated always as (revenue - cost) stored,
  -- A linked researcher account (a buyer reference only: it grants nothing
  -- and adds nothing to their supplies) or an outside buyer. buyer_name is the
  -- account's name at the time of the sale, or the outside buyer's reference.
  buyer_type public.business_buyer_type not null,
  buyer_profile_id uuid references public.profiles (id) on delete restrict,
  buyer_name text not null check (buyer_name = public.trim_whitespace(buyer_name) and char_length(buyer_name) between 1 and 120),
  idempotency_key uuid not null unique,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  constraint business_sales_revenue check (revenue = quantity * unit_price),
  -- An account sale names its profile; an outside sale names none.
  constraint business_sales_buyer check ((buyer_type = 'account') = (buyer_profile_id is not null))
);

create index business_sales_by_item on public.business_sales (stock_item_id, sold_on);
create index business_sales_by_date on public.business_sales (sold_on, recorded_at);

-- ── Allocations: which purchase lots a sale took, at what cost ─────────────
create table public.business_sale_allocations (
  sale_id uuid not null references public.business_sales (id) on delete restrict,
  purchase_id uuid not null references public.business_purchases (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  -- Copies of the lot's unit cost and date, frozen with the sale.
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  received_on date not null,
  primary key (sale_id, purchase_id)
);

create index business_sale_allocations_by_purchase on public.business_sale_allocations (purchase_id);

-- ── Access ─────────────────────────────────────────────────────────────────
alter table public.business_stock_items enable row level security;
alter table public.business_purchases enable row level security;
alter table public.business_sales enable row level security;
alter table public.business_sale_allocations enable row level security;

revoke all on table public.business_stock_items, public.business_purchases, public.business_sales,
  public.business_sale_allocations from public, anon, authenticated, service_role;
-- Reads only: admins through the policies below, server-only code and tests
-- (secret key) directly. Nobody writes except the record_* functions
-- (20260926160100_business_inventory_writes.sql).
grant select on table public.business_stock_items, public.business_purchases, public.business_sales,
  public.business_sale_allocations to authenticated, service_role;

create policy business_stock_items_admin_select on public.business_stock_items
  for select to authenticated using ((select public.is_admin()));
create policy business_purchases_admin_select on public.business_purchases
  for select to authenticated using ((select public.is_admin()));
create policy business_sales_admin_select on public.business_sales
  for select to authenticated using ((select public.is_admin()));
create policy business_sale_allocations_admin_select on public.business_sale_allocations
  for select to authenticated using ((select public.is_admin()));

-- ── Append-only guard ──────────────────────────────────────────────────────
-- Refuses every UPDATE, DELETE and TRUNCATE, with no exception: attribution
-- columns are never nulled by a cascade (ON DELETE RESTRICT, see the header).
create function public.business_records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'recorded business stock, purchases and sales cannot be changed' using errcode = '42501';
end;
$$;

revoke all on function public.business_records_guard() from public, anon, authenticated, service_role;

create trigger business_stock_items_guard before update or delete on public.business_stock_items
  for each row execute function public.business_records_guard();
create trigger business_purchases_guard before update or delete on public.business_purchases
  for each row execute function public.business_records_guard();
create trigger business_sales_guard before update or delete on public.business_sales
  for each row execute function public.business_records_guard();
create trigger business_sale_allocations_guard before update or delete on public.business_sale_allocations
  for each row execute function public.business_records_guard();
create trigger business_stock_items_no_truncate before truncate on public.business_stock_items
  for each statement execute function public.business_records_guard();
create trigger business_purchases_no_truncate before truncate on public.business_purchases
  for each statement execute function public.business_records_guard();
create trigger business_sales_no_truncate before truncate on public.business_sales
  for each statement execute function public.business_records_guard();
create trigger business_sale_allocations_no_truncate before truncate on public.business_sale_allocations
  for each statement execute function public.business_records_guard();

-- ── Commit-time integrity ──────────────────────────────────────────────────
-- Checked for a sale when the sale is inserted AND whenever an allocation is
-- inserted for it (deferred to commit, so a sale and its allocations are
-- checked together once all are written; an allocation added later onto an
-- existing sale is checked too). Rows are never updated or deleted (guard
-- above) and a lot's quantity never changes, so inserts are the only way to
-- break these invariants:
--   * the sale's allocations add up to exactly its quantity and its cost;
--   * every lot it takes from belongs to the sale's stock item, and the
--     allocation's unit cost and date are copies of that lot's;
--   * no lot it takes from is allocated beyond its quantity, counting the
--     allocations of every sale.
-- The check first locks the sale's stock item, as the record_* functions do,
-- so two transactions adding allocations for one item are checked one after
-- the other: under READ COMMITTED each query below then sees what the other
-- committed. (Only the record_* functions write through the API; this is the
-- backstop for everything else.) The trigger functions are SECURITY DEFINER:
-- deferred triggers fire at commit, after record_*'s own definer context has
-- ended, and the check must lock and read every row whoever commits.
create function public.business_check_sale(p_sale_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_sale public.business_sales;
  v_quantity bigint;
  v_cost numeric;
begin
  select * into v_sale from public.business_sales s where s.id = p_sale_id;
  if not found then
    raise exception 'allocation for an unknown sale' using errcode = '23503';
  end if;
  perform 1 from public.business_stock_items i where i.id = v_sale.stock_item_id for update;

  select coalesce(sum(a.quantity), 0), coalesce(sum(a.quantity * a.unit_cost), 0)
    into v_quantity, v_cost
  from public.business_sale_allocations a where a.sale_id = p_sale_id;
  if v_quantity <> v_sale.quantity or v_cost <> v_sale.cost then
    raise exception 'sale allocations do not match the sale' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.business_sale_allocations mine
    join public.business_purchases p on p.id = mine.purchase_id
    where mine.sale_id = p_sale_id
      and (p.stock_item_id <> v_sale.stock_item_id or mine.unit_cost <> p.unit_cost or mine.received_on <> p.received_on)
  ) then
    raise exception 'a sale allocation does not match its purchase lot' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.business_sale_allocations mine
    join public.business_purchases p on p.id = mine.purchase_id
    where mine.sale_id = p_sale_id
      and p.quantity < (select sum(a.quantity) from public.business_sale_allocations a where a.purchase_id = p.id)
  ) then
    raise exception 'a purchase lot is allocated beyond its quantity' using errcode = '23514';
  end if;
end;
$$;

create function public.business_sale_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.business_check_sale(new.id);
  return null;
end;
$$;

create function public.business_allocation_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.business_check_sale(new.sale_id);
  return null;
end;
$$;

revoke all on function public.business_check_sale(uuid) from public, anon, authenticated, service_role;
revoke all on function public.business_sale_integrity() from public, anon, authenticated, service_role;
revoke all on function public.business_allocation_integrity() from public, anon, authenticated, service_role;

create constraint trigger business_sales_integrity after insert on public.business_sales
  deferrable initially deferred
  for each row execute function public.business_sale_integrity();
create constraint trigger business_sale_allocations_integrity after insert on public.business_sale_allocations
  deferrable initially deferred
  for each row execute function public.business_allocation_integrity();
