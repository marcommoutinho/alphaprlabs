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
--   * Append-only. Recorded purchases, sales and allocations are never edited
--     or deleted (a trigger refuses it even for database owners' ordinary
--     statements): historical gross profit must not change, and corrections
--     are out of scope for the MVP (handoff open decision 2).
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
-- stock item first, by received date, then recording order. The sale stores
-- its revenue and cost and one allocation row per purchase lot with a COPY of
-- that lot's unit cost and date, so later purchases never change it.
--
-- Concurrency: each write takes a transaction advisory lock on its idempotency
-- key, then a row lock on the stock item. Sales and purchases of one item are
-- therefore serialized: two sales can never both see the same remaining stock.
--
-- Refusals (SQLSTATE; the app maps them, src/lib/inventory/service.ts):
--   42501 not an admin              22023 invalid input (message names it)
--   AP001 insufficient stock (DETAIL = vials on hand)
--   AP002 unknown stock item        AP003 unknown peptide
--   AP004 unknown buyer account     AP005 idempotency key reused for different details

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
  recorded_by uuid references public.profiles (id) on delete set null,
  -- Recording order breaks FIFO ties between lots received the same day.
  recorded_at timestamptz not null default clock_timestamp()
);

create index business_purchases_fifo on public.business_purchases (stock_item_id, received_on, recorded_at, id);

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
  buyer_profile_id uuid references public.profiles (id) on delete set null,
  buyer_name text not null check (buyer_name = public.trim_whitespace(buyer_name) and char_length(buyer_name) between 1 and 120),
  idempotency_key uuid not null unique,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint business_sales_revenue check (revenue = quantity * unit_price),
  -- Only an account sale names a profile (null again if that account is deleted).
  constraint business_sales_buyer check (buyer_type = 'account' or buyer_profile_id is null)
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
-- Refuses every UPDATE and DELETE, except the database nulling a deleted
-- account's reference (ON DELETE SET NULL on buyer_profile_id / recorded_by),
-- which changes no quantity, amount or allocation. TRUNCATE is refused too.
-- (Generated columns are not yet computed in a BEFORE trigger, so they are
-- left out of the comparison; they derive from compared columns.)
create function public.business_records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op = 'UPDATE' and tg_table_name in ('business_sales', 'business_purchases') then
    v_new := to_jsonb(new) - 'gross_profit' - 'total_cost';
    v_old := to_jsonb(old) - 'gross_profit' - 'total_cost';
    if not exists (
      select 1 from jsonb_each(v_old) o
      where o.value is distinct from v_new -> o.key
        and not (o.key in ('buyer_profile_id', 'recorded_by') and v_new -> o.key = 'null'::jsonb)
    ) then
      return new;
    end if;
  end if;
  raise exception 'recorded business stock, purchases and sales cannot be changed' using errcode = '42501';
end;
$$;

revoke all on function public.business_records_guard() from public, anon, authenticated;

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

-- Commit-time integrity of every sale: its allocations cover exactly its
-- quantity and cost, and no purchase lot is allocated beyond its quantity.
create function public.business_sale_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_quantity bigint;
  v_cost numeric;
begin
  select coalesce(sum(a.quantity), 0), coalesce(sum(a.quantity * a.unit_cost), 0)
    into v_quantity, v_cost
  from public.business_sale_allocations a where a.sale_id = new.id;
  if v_quantity <> new.quantity or v_cost <> new.cost then
    raise exception 'sale allocations do not match the sale' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.business_sale_allocations mine
    join public.business_purchases p on p.id = mine.purchase_id
    where mine.sale_id = new.id
      and p.quantity < (select sum(a.quantity) from public.business_sale_allocations a where a.purchase_id = p.id)
  ) then
    raise exception 'a purchase lot is allocated beyond its quantity' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function public.business_sale_integrity() from public, anon, authenticated;

create constraint trigger business_sales_integrity after insert on public.business_sales
  deferrable initially deferred
  for each row execute function public.business_sale_integrity();
