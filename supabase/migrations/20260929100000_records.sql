-- V6 Records (design v3 A4 / D4 Record a sale, A5 / D5 Record a purchase,
-- A7 / A14 / D5 Ledger; tasks/research-app.md "Design v3 rebuild decisions":
-- supplier on purchases, the Ledger grouped by day or month; USD purchases use
-- only the stored Bank of Canada rate, unchanged).
--
-- 1. Supplier on purchases. business_purchases gains supplier: optional,
--    stored trimmed (trim_whitespace) and 1 to 120 characters, or null. The
--    column is added without a default, so no row is rewritten or updated
--    (no UPDATE trigger fires): every existing purchase, production's
--    opening stock included, has no supplier. It is written only when a
--    purchase is recorded: the append-only guard (business_records_guard,
--    unchanged) still refuses every UPDATE of a purchase, so a supplier is
--    set on insert or never. Suppliers are grouped by
--    public.library_name_key(supplier) (trimmed, inner whitespace as one
--    space, lower-cased), so "Halcyon Peptides" and "halcyon  peptides" are
--    one supplier, shown with the spelling of its latest purchase.
--
--    record_business_purchase_fx gains p_supplier (default null; blank means
--    none; more than 120 characters is refused with 22023). It stays the one
--    path for CAD and USD purchases (record_business_purchase, the CAD
--    wrapper, calls it without a supplier). Its replay compares the supplier
--    too: the same idempotency key with another supplier is refused (AP005),
--    as for every other detail entered. Grants as before (authenticated;
--    is_admin() inside).
--
--    Admin reads: admin_business_suppliers() lists the distinct past
--    suppliers (A5's combobox), and admin_business_purchase_suppliers
--    (V5, A13 / D9 "Purchases by supplier") now groups by the recorded
--    supplier, purchases without one in the group keyed '' (supplier_name
--    null), which the app lists last as "No supplier recorded".
--
-- 2. The sale preview is the allocation the sale freezes. FIFO moves into
--    one function, business_fifo_allocation(item, vials): the oldest
--    remaining purchase quantities first, by received date then recording
--    order (unchanged). record_business_sale allocates with it, and
--    admin_business_sale_preview(item, vials) returns what it would take
--    now: the vials on hand and every lot the sale would use, with that
--    lot's date and CAD cost (and its USD cost and rate, when entered in
--    USD). A4 / D4 show that preview, never a re-implementation.
--
--    record_business_sale requires p_expected_allocation (jsonb, no
--    default): the preview's lots as [{"purchase_id": uuid, "quantity": n},
--    ...] in FIFO order. Every sale is recorded against a preview: the
--    previous signature (without it) is dropped, and a missing, null, empty
--    or malformed allocation is refused with 22023, so no API path (the app,
--    a script, a future import) records a sale whose cost nobody saw; such a
--    caller calls admin_business_sale_preview first. For a new sale, when the
--    allocation the sale would freeze now differs (another sale or a
--    purchase of the item was recorded in between), nothing is recorded and
--    the sale is refused with AP037 (DETAIL: the vials on hand now); the app
--    shows the new preview. Stock short of the vials is still AP001, checked
--    first. A replay (the same idempotency key) is compared with the details
--    entered only, as before, so a retry after a lost answer replays
--    whatever stock has done since. The parameter comes right after
--    p_unit_price (a parameter without a default can't follow ones with
--    defaults); the API calls it by name.
--
-- 3. Ledger reads (A7 / A14 / D5), admins only, each checking is_admin()
--    itself (42501), amounts as exact decimal text, dates as business dates
--    (America/Toronto calendar days, as sold_on and received_on are
--    recorded). Each range is inclusive and required (22023 when missing or
--    reversed):
--      * admin_business_ledger_sales(from, to, seller, item): one row per
--        sale, with its item, seller and buyer as recorded. p_seller null is
--        every seller, the nil UUID the sales recorded before sellers
--        existed. sort_key orders them newest first (sale date, then when
--        recorded, then id) and is unique, for keyset pages.
--      * admin_business_ledger_purchases(from, to, item): one row per
--        purchase, with its CAD cost, the USD cost and rate when entered in
--        USD, and the supplier. sort_key: received date, then recording order.
--      * admin_business_ledger_month_items(kind, from, to, seller, item):
--        per calendar month and stock item, the sales (vials, revenue, cost,
--        gross profit) or the purchases (vials, CAD total, how many
--        suppliers and which when one). row_key is unique, for keyset pages.
--
-- Lock order: nothing here takes a cycle, plan, vial or mixture lock, so the
-- global order of 20260926200100_dose_confirmation.sql (cycle -> plans by id
-- -> vial -> mixtures by id) is untouched. The two writers keep the business
-- order: their idempotency key's transaction advisory lock, then the stock
-- item's row lock (sales and purchases of one item are serialized, so the
-- allocation compared with the preview cannot change until the sale commits).
--
-- Access (deny by default): no new table. The new functions refuse
-- non-admins; business_fifo_allocation is callable by no API role. One new
-- refusal SQLSTATE, AP037 (stock changed since the preview), beside AP001 to
-- AP006, AP028 to AP030 and AP036.

-- ── 1. Supplier ────────────────────────────────────────────────────────────
alter table public.business_purchases
  add column supplier text;

alter table public.business_purchases
  add constraint business_purchases_supplier check (
    supplier is null or (supplier = public.trim_whitespace(supplier) and char_length(supplier) between 1 and 120)
  );

create index business_purchases_by_supplier
  on public.business_purchases (public.library_name_key(supplier)) where supplier is not null;

-- ── Admin: record a purchase in CAD or USD, with its supplier (A5 / D5) ─────
-- As 20260927140000_purchase_currency.sql, plus p_supplier (see the header).
drop function public.record_business_purchase_fx(uuid, date, integer, text, text, text, text, date, uuid, uuid, text);

create function public.record_business_purchase_fx(
  p_idempotency_key uuid,
  p_received_on date,
  p_quantity integer,
  p_original_currency text,
  p_unit_cost text default null,
  p_original_unit_cost text default null,
  p_fx_rate text default null,
  p_fx_rate_date date default null,
  p_stock_item_id uuid default null,
  p_peptide_id uuid default null,
  p_strength_mg text default null,
  p_supplier text default null
)
returns table (purchase_id uuid, stock_item_id uuid, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cost numeric;
  v_currency text := p_original_currency;
  v_original numeric;
  v_rate numeric;
  v_latest public.fx_rates;
  v_strength numeric;
  v_item uuid := p_stock_item_id;
  v_supplier text := nullif(public.trim_whitespace(coalesce(p_supplier, '')), '');
  v_existing public.business_purchases;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if (p_stock_item_id is null) = (p_peptide_id is null) or (p_stock_item_id is not null and p_strength_mg is not null) then
    raise exception 'give a stock item, or a peptide and vial strength' using errcode = '22023';
  end if;
  if p_received_on is null then
    raise exception 'received date required' using errcode = '22023';
  end if;
  if p_received_on > public.business_latest_date() then
    raise exception 'the date received cannot be in the future' using errcode = 'AP006';
  end if;
  if p_quantity is null or p_quantity not between 1 and 100000 then
    raise exception 'vials must be a whole number from 1 to 100000' using errcode = '22023';
  end if;
  if v_currency is null or v_currency not in ('CAD', 'USD') then
    raise exception 'currency must be CAD or USD' using errcode = '22023';
  end if;
  if v_supplier is not null and char_length(v_supplier) > 120 then
    raise exception 'the supplier can be up to 120 characters' using errcode = '22023';
  end if;
  -- The cost as entered: CAD per vial, or USD per vial.
  if v_currency = 'CAD' then
    v_cost := public.parse_cad_amount(p_unit_cost);
    if v_cost is null then
      raise exception 'cost per vial must be CAD 0 to 1000000 with at most 2 decimals' using errcode = '22023';
    end if;
  else
    v_original := public.parse_cad_amount(p_original_unit_cost);
    if v_original is null then
      raise exception 'USD cost per vial must be 0 to 1000000 with at most 2 decimals' using errcode = '22023';
    end if;
  end if;
  if p_peptide_id is not null then
    v_strength := public.parse_strength_mg(p_strength_mg);
    if v_strength is null then
      raise exception 'vial strength must be above 0 mg with at most 3 decimals' using errcode = '22023';
    end if;
    if not exists (select 1 from public.peptides p where p.id = p_peptide_id) then
      raise exception 'unknown peptide' using errcode = 'AP003';
    end if;
  end if;

  -- The same lock key as before: retries of one entry serialize on it.
  perform pg_advisory_xact_lock(hashtextextended('business_purchase:' || p_idempotency_key::text, 0));

  if p_peptide_id is not null then
    insert into public.business_stock_items (peptide_id, strength_mg)
    values (p_peptide_id, v_strength)
    on conflict on constraint business_stock_items_one_per_strength do nothing;
    select i.id into v_item from public.business_stock_items i
    where i.peptide_id = p_peptide_id and i.strength_mg = v_strength;
  end if;

  -- Replay: compared with the details as entered (the supplier included), before the conversion.
  select * into v_existing from public.business_purchases p where p.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.stock_item_id, v_existing.received_on, v_existing.quantity, v_existing.original_currency,
        case when v_existing.original_currency = 'USD' then v_existing.original_unit_cost else v_existing.unit_cost end,
        v_existing.supplier)
       is distinct from (v_item, p_received_on, p_quantity, v_currency,
        case when v_currency = 'USD' then v_original else v_cost end,
        v_supplier) then
      raise exception 'this submission was already recorded with different details' using errcode = 'AP005';
    end if;
    return query select v_existing.id, v_existing.stock_item_id, true;
    return;
  end if;

  -- A new purchase: its conversion (USD) or none (CAD), unchanged.
  if v_currency = 'CAD' then
    if p_original_unit_cost is not null or p_fx_rate is not null or p_fx_rate_date is not null then
      raise exception 'a CAD purchase has no conversion' using errcode = '22023';
    end if;
  else
    v_rate := public.parse_fx_rate(p_fx_rate);
    if v_rate is null then
      raise exception 'exchange rate must be above 0 with at most 6 decimals' using errcode = '22023';
    end if;
    if p_fx_rate_date is null or p_fx_rate_date > p_received_on or p_fx_rate_date < p_received_on - 10 then
      raise exception 'the rate date must be the date received or up to 10 days before' using errcode = '22023';
    end if;
    select * into v_latest from public.fx_rates r
    where r.rate_date between p_received_on - 10 and p_received_on
    order by r.rate_date desc
    limit 1;
    if not found then
      raise exception 'no Bank of Canada rate is stored for the date received' using errcode = '22023';
    end if;
    if v_latest.rate_date <> p_fx_rate_date or v_latest.usd_cad <> v_rate then
      raise exception 'the rate must be the latest stored Bank of Canada rate for the date received' using errcode = 'AP028';
    end if;
    v_cost := public.parse_cad_amount(p_unit_cost);
    if v_cost is null then
      raise exception 'cost per vial must be CAD 0 to 1000000 with at most 2 decimals' using errcode = '22023';
    end if;
    if v_cost <> round(v_original * v_rate, 2) then
      raise exception 'CAD cost per vial must be the USD cost times the rate, rounded to the cent' using errcode = '22023';
    end if;
  end if;

  -- Serializes with sales of this item (see 20260926160000_business_inventory.sql).
  perform 1 from public.business_stock_items i where i.id = v_item for update;
  if not found then
    raise exception 'unknown stock item' using errcode = 'AP002';
  end if;

  insert into public.business_purchases (
    stock_item_id, received_on, quantity, unit_cost, idempotency_key, recorded_by,
    original_currency, original_unit_cost, fx_rate, fx_rate_date, supplier
  )
  values (
    v_item, p_received_on, p_quantity, v_cost, p_idempotency_key, (select auth.uid()),
    v_currency, v_original, v_rate, case when v_currency = 'USD' then p_fx_rate_date end, v_supplier
  )
  returning id into v_id;
  return query select v_id, v_item, false;
end;
$$;

revoke all on function public.record_business_purchase_fx(uuid, date, integer, text, text, text, text, date, uuid, uuid, text, text)
  from public, anon;
grant execute on function public.record_business_purchase_fx(uuid, date, integer, text, text, text, text, date, uuid, uuid, text, text)
  to authenticated;

-- The CAD wrapper: same signature, return type and privileges (CREATE OR
-- REPLACE keeps its grants), a CAD purchase without a supplier, as before.
create or replace function public.record_business_purchase(
  p_idempotency_key uuid,
  p_received_on date,
  p_quantity integer,
  p_unit_cost text,
  p_stock_item_id uuid default null,
  p_peptide_id uuid default null,
  p_strength_mg text default null
)
returns table (purchase_id uuid, stock_item_id uuid, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
    select r.purchase_id, r.stock_item_id, r.replayed
    from public.record_business_purchase_fx(
      p_idempotency_key, p_received_on, p_quantity, 'CAD', p_unit_cost, null, null, null,
      p_stock_item_id, p_peptide_id, p_strength_mg, null
    ) r;
end;
$$;

-- ── Admin: the suppliers purchases were recorded with (A5's combobox) ──────
-- One row per supplier key, with the spelling of its latest purchase, how
-- many purchases name it and the latest date received. Paged by supplier_key.
create function public.admin_business_suppliers()
returns table (supplier_key text, supplier text, orders bigint, last_received date)
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
    select public.library_name_key(bp.supplier),
           (array_agg(bp.supplier order by bp.recorded_order desc))[1],
           count(*)::bigint,
           max(bp.received_on)
    from public.business_purchases bp
    where bp.supplier is not null
    group by public.library_name_key(bp.supplier);
end;
$$;

revoke all on function public.admin_business_suppliers() from public, anon;
grant execute on function public.admin_business_suppliers() to authenticated;

-- Purchases by supplier (A13 / D9), now by the recorded supplier: same
-- signature, result and privileges as 20260928150000_business_overview.sql.
create or replace function public.admin_business_purchase_suppliers(p_from date, p_to date)
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
    select coalesce(public.library_name_key(bp.supplier), ''),
           (array_agg(bp.supplier order by bp.recorded_order desc))[1],
           count(*)::bigint,
           round(sum(bp.total_cost), 2)::text,
           array_agg(distinct bp.original_currency order by bp.original_currency)
    from public.business_purchases bp
    where bp.received_on between p_from and p_to
    group by coalesce(public.library_name_key(bp.supplier), '');
end;
$$;

-- ── 2. FIFO, shared by the sale and its preview ────────────────────────────
-- The lots a sale of p_quantity vials of the item takes now: the oldest
-- remaining purchase quantities first, by received date then recording
-- order. Fewer vials than asked when stock is short (the callers check the
-- vials on hand first). STABLE: it reads with its caller's snapshot, so
-- record_business_sale's allocation is read after it holds the item's lock,
-- and the preview's lots and vials on hand come from one snapshot.
create function public.business_fifo_allocation(p_stock_item_id uuid, p_quantity integer)
returns table (purchase_id uuid, quantity integer, unit_cost numeric, received_on date, recorded_order bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_need integer := greatest(coalesce(p_quantity, 0), 0);
  v_take integer;
  v_lot record;
begin
  for v_lot in
    select p.id as lot_id, p.unit_cost as lot_cost, p.received_on as lot_date, p.recorded_order as lot_order,
           p.quantity - coalesce((select sum(a.quantity) from public.business_sale_allocations a where a.purchase_id = p.id), 0) as remaining
    from public.business_purchases p
    where p.stock_item_id = p_stock_item_id
    order by p.received_on, p.recorded_order
  loop
    exit when v_need = 0;
    continue when v_lot.remaining <= 0;
    v_take := least(v_lot.remaining, v_need)::integer;
    purchase_id := v_lot.lot_id;
    quantity := v_take;
    unit_cost := v_lot.lot_cost;
    received_on := v_lot.lot_date;
    recorded_order := v_lot.lot_order;
    return next;
    v_need := v_need - v_take;
  end loop;
end;
$$;

revoke all on function public.business_fifo_allocation(uuid, integer) from public, anon, authenticated, service_role;

-- ── Admin: the sale preview (A4 / D4 "Gross profit on this sale") ──────────
-- {"on_hand": n, "short": bool, "cost": "40.14" | null, "lots": [...]}: when
-- the vials fit, every lot the sale would take now, in FIFO order, as
-- {"purchase_id", "quantity", "unit_cost" (CAD), "received_on", "currency",
-- "usd_unit_cost", "fx_rate", "supplier"}, and their cost; when they don't,
-- short true and no lots. Amounts as exact decimal text. Refusals: 42501 not
-- an admin; 22023 no item, or vials outside 1..100000; AP002 unknown item.
create function public.admin_business_sale_preview(p_stock_item_id uuid, p_quantity integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_on_hand bigint;
  v_lots jsonb;
  v_cost numeric;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_stock_item_id is null then
    raise exception 'stock item required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity not between 1 and 100000 then
    raise exception 'vials must be a whole number from 1 to 100000' using errcode = '22023';
  end if;
  if not exists (select 1 from public.business_stock_items i where i.id = p_stock_item_id) then
    raise exception 'unknown stock item' using errcode = 'AP002';
  end if;

  -- As record_business_sale counts it.
  select coalesce(sum(p.quantity), 0)
         - coalesce((select sum(s.quantity) from public.business_sales s where s.stock_item_id = p_stock_item_id), 0)
    into v_on_hand
  from public.business_purchases p where p.stock_item_id = p_stock_item_id;
  if p_quantity > v_on_hand then
    return jsonb_build_object('on_hand', v_on_hand, 'short', true, 'cost', null, 'lots', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'purchase_id', f.purchase_id,
           'quantity', f.quantity,
           'unit_cost', f.unit_cost::text,
           'received_on', f.received_on,
           'currency', p.original_currency,
           'usd_unit_cost', p.original_unit_cost::text,
           'fx_rate', p.fx_rate::text,
           'supplier', p.supplier
         ) order by f.received_on, f.recorded_order), '[]'::jsonb),
         coalesce(sum(f.quantity * f.unit_cost), 0)
    into v_lots, v_cost
  from public.business_fifo_allocation(p_stock_item_id, p_quantity) f
  join public.business_purchases p on p.id = f.purchase_id;

  return jsonb_build_object('on_hand', v_on_hand, 'short', false, 'cost', round(v_cost, 2)::text, 'lots', v_lots);
end;
$$;

revoke all on function public.admin_business_sale_preview(uuid, integer) from public, anon;
grant execute on function public.admin_business_sale_preview(uuid, integer) to authenticated;

-- ── Admin: record a sale (A4 / D4), frozen as previewed ─────────────────────
-- As 20260927160000_sellers_admin_invites.sql, allocating with
-- business_fifo_allocation, plus p_expected_allocation (see the header).
drop function public.record_business_sale(uuid, uuid, date, integer, text, uuid, text, uuid);

create function public.record_business_sale(
  p_idempotency_key uuid,
  p_stock_item_id uuid,
  p_sold_on date,
  p_quantity integer,
  p_unit_price text,
  p_expected_allocation jsonb,
  p_buyer_profile_id uuid default null,
  p_buyer_name text default null,
  p_seller_id uuid default null
)
returns table (sale_id uuid, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_price numeric := public.parse_cad_amount(p_unit_price);
  v_outside_name text := public.trim_whitespace(coalesce(p_buyer_name, ''));
  v_buyer_type public.business_buyer_type;
  v_buyer_name text;
  v_seller_name text;
  v_existing public.business_sales;
  v_on_hand bigint;
  v_taken integer := 0;
  v_cost numeric := 0;
  v_lot record;
  v_lots uuid[] := '{}';
  v_quantities integer[] := '{}';
  v_costs numeric[] := '{}';
  v_dates date[] := '{}';
  v_expected jsonb;
  v_actual jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if p_stock_item_id is null then
    raise exception 'stock item required' using errcode = '22023';
  end if;
  if p_sold_on is null then
    raise exception 'sale date required' using errcode = '22023';
  end if;
  if p_sold_on > public.business_latest_date() then
    raise exception 'the sale date cannot be in the future' using errcode = 'AP006';
  end if;
  if p_quantity is null or p_quantity not between 1 and 100000 then
    raise exception 'vials must be a whole number from 1 to 100000' using errcode = '22023';
  end if;
  if v_price is null then
    raise exception 'price per vial must be CAD 0 to 1000000 with at most 2 decimals' using errcode = '22023';
  end if;
  if p_seller_id is null then
    raise exception 'seller required' using errcode = '22023';
  end if;
  if p_buyer_profile_id is not null then
    if v_outside_name <> '' then
      raise exception 'give a buyer account or an outside buyer, not both' using errcode = '22023';
    end if;
    v_buyer_type := 'account';
  else
    if v_outside_name = '' then
      raise exception 'buyer required' using errcode = '22023';
    end if;
    if char_length(v_outside_name) > 120 then
      raise exception 'buyer name can be up to 120 characters' using errcode = '22023';
    end if;
    v_buyer_type := 'outside';
    v_buyer_name := v_outside_name;
  end if;
  -- The preview's lots, as [{"purchase_id", "quantity"}, ...] in FIFO order:
  -- required, never null or empty (see the header).
  if p_expected_allocation is null or jsonb_typeof(p_expected_allocation) <> 'array'
     or jsonb_array_length(p_expected_allocation) = 0 then
    raise exception 'the expected allocation (the preview''s lots and vials) is required' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements(p_expected_allocation) e
       where jsonb_typeof(e.value) <> 'object'
          or jsonb_typeof(e.value -> 'purchase_id') is distinct from 'string'
          or jsonb_typeof(e.value -> 'quantity') is distinct from 'number'
          or (e.value ->> 'purchase_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or (e.value ->> 'quantity') !~ '^[0-9]{1,6}$'
     ) then
    raise exception 'the expected allocation must be a list of lots and vials' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object(
           'purchase_id', (e.value ->> 'purchase_id')::uuid,
           'quantity', (e.value ->> 'quantity')::integer
         ) order by e.ordinality)
    into v_expected
  from jsonb_array_elements(p_expected_allocation) with ordinality e;

  perform pg_advisory_xact_lock(hashtextextended('business_sale:' || p_idempotency_key::text, 0));

  -- Replay: compared with the details as submitted, the seller included (not
  -- the expected allocation: a retry replays whatever stock has done since).
  select * into v_existing from public.business_sales s where s.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.stock_item_id, v_existing.sold_on, v_existing.quantity, v_existing.unit_price, v_existing.seller_id)
         is distinct from (p_stock_item_id, p_sold_on, p_quantity, v_price, p_seller_id)
       or (v_buyer_type = 'account' and (v_existing.linked_at is not null or v_existing.buyer_profile_id is distinct from p_buyer_profile_id))
       or (v_buyer_type = 'outside'
           and coalesce(v_existing.original_buyer_name, case when v_existing.buyer_type = 'outside' then v_existing.buyer_name end)
               is distinct from v_buyer_name) then
      raise exception 'this submission was already recorded with different details' using errcode = 'AP005';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  -- A new sale: the seller must be a current admin; their current name is kept.
  select left(public.trim_whitespace(pr.name), 120) into v_seller_name
  from public.profiles pr where pr.id = p_seller_id and pr.role = 'admin';
  if not found then
    raise exception 'the seller must be a current admin' using errcode = 'AP029';
  end if;

  -- The buyer account must exist; its current name is kept.
  if v_buyer_type = 'account' then
    select left(public.trim_whitespace(pr.name), 120) into v_buyer_name
    from public.profiles pr where pr.id = p_buyer_profile_id;
    if not found then
      raise exception 'unknown buyer account' using errcode = 'AP004';
    end if;
  end if;

  -- Serializes every sale and purchase of this item: the remaining quantities
  -- read below cannot change until this transaction ends.
  perform 1 from public.business_stock_items i where i.id = p_stock_item_id for update;
  if not found then
    raise exception 'unknown stock item' using errcode = 'AP002';
  end if;

  select coalesce(sum(p.quantity), 0)
         - coalesce((select sum(s.quantity) from public.business_sales s where s.stock_item_id = p_stock_item_id), 0)
    into v_on_hand
  from public.business_purchases p where p.stock_item_id = p_stock_item_id;
  if p_quantity > v_on_hand then
    raise exception 'insufficient stock' using errcode = 'AP001', detail = v_on_hand::text;
  end if;

  -- FIFO: the shared allocation, exactly what admin_business_sale_preview shows.
  for v_lot in
    select f.purchase_id, f.quantity, f.unit_cost, f.received_on
    from public.business_fifo_allocation(p_stock_item_id, p_quantity) f
    order by f.received_on, f.recorded_order
  loop
    v_lots := v_lots || v_lot.purchase_id;
    v_quantities := v_quantities || v_lot.quantity;
    v_costs := v_costs || v_lot.unit_cost;
    v_dates := v_dates || v_lot.received_on;
    v_cost := v_cost + v_lot.quantity * v_lot.unit_cost;
    v_taken := v_taken + v_lot.quantity;
    v_actual := v_actual || jsonb_build_array(jsonb_build_object('purchase_id', v_lot.purchase_id, 'quantity', v_lot.quantity));
  end loop;
  if v_taken <> p_quantity then
    raise exception 'insufficient stock' using errcode = 'AP001', detail = v_on_hand::text;
  end if;
  -- Frozen as previewed, or not at all. The comparison covers the lots and
  -- the vials taken from each (the cost the admin agreed to), not the vials
  -- on hand: two admins who both preview "2 from the Aug 30 lot" each get
  -- exactly that, so the money matches what each saw. Overselling is AP001's
  -- job (above), which counts on hand under the item's lock.
  if v_expected <> v_actual then
    raise exception 'stock changed since the preview' using errcode = 'AP037', detail = v_on_hand::text;
  end if;

  insert into public.business_sales (
    stock_item_id, sold_on, quantity, unit_price, revenue, cost,
    buyer_type, buyer_profile_id, buyer_name, idempotency_key, recorded_by, seller_id, seller_name
  )
  values (
    p_stock_item_id, p_sold_on, p_quantity, v_price, p_quantity * v_price, v_cost,
    v_buyer_type, p_buyer_profile_id, v_buyer_name, p_idempotency_key, (select auth.uid()), p_seller_id, v_seller_name
  )
  returning id into v_id;

  insert into public.business_sale_allocations (sale_id, purchase_id, quantity, unit_cost, received_on)
  select v_id, l.purchase_id, l.quantity, l.unit_cost, l.received_on
  from unnest(v_lots, v_quantities, v_costs, v_dates) as l (purchase_id, quantity, unit_cost, received_on);

  return query select v_id, false;
end;
$$;

revoke all on function public.record_business_sale(uuid, uuid, date, integer, text, jsonb, uuid, text, uuid) from public, anon;
grant execute on function public.record_business_sale(uuid, uuid, date, integer, text, jsonb, uuid, text, uuid) to authenticated;

-- ── 3. Ledger reads ────────────────────────────────────────────────────────

-- Sales in a range, one row per sale (A7 by day, D5 Sales, a month's item opened on A14).
create function public.admin_business_ledger_sales(
  p_from date,
  p_to date,
  p_seller uuid default null,
  p_stock_item_id uuid default null
)
returns table (
  sort_key text,
  sale_id uuid,
  sold_on date,
  recorded_at timestamptz,
  stock_item_id uuid,
  peptide_name text,
  strength_mg text,
  quantity integer,
  unit_price text,
  revenue text,
  cost text,
  gross_profit text,
  seller_id uuid,
  seller_name text,
  buyer_type text,
  buyer_profile_id uuid,
  buyer_name text,
  original_buyer_name text
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
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'give a range of days' using errcode = '22023';
  end if;

  return query
    select s.sold_on::text || ' ' || to_char(s.recorded_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || ' ' || s.id::text,
           s.id, s.sold_on, s.recorded_at, s.stock_item_id, p.name, i.strength_mg::text,
           s.quantity, s.unit_price::text, s.revenue::text, s.cost::text, s.gross_profit::text,
           s.seller_id, s.seller_name, s.buyer_type::text, s.buyer_profile_id, s.buyer_name, s.original_buyer_name
    from public.business_sales s
    join public.business_stock_items i on i.id = s.stock_item_id
    join public.peptides p on p.id = i.peptide_id
    where s.sold_on between p_from and p_to
      and (p_seller is null
           or (p_seller = '00000000-0000-0000-0000-000000000000'::uuid and s.seller_id is null)
           or s.seller_id = p_seller)
      and (p_stock_item_id is null or s.stock_item_id = p_stock_item_id);
end;
$$;

-- Purchases in a range, one row per purchase (A7 Purchases by day, D5 Purchases).
create function public.admin_business_ledger_purchases(
  p_from date,
  p_to date,
  p_stock_item_id uuid default null
)
returns table (
  sort_key text,
  purchase_id uuid,
  received_on date,
  recorded_at timestamptz,
  stock_item_id uuid,
  peptide_name text,
  strength_mg text,
  quantity integer,
  unit_cost text,
  total_cost text,
  original_currency text,
  original_unit_cost text,
  fx_rate text,
  fx_rate_date date,
  supplier text
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
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'give a range of days' using errcode = '22023';
  end if;

  return query
    select bp.received_on::text || ' ' || lpad(bp.recorded_order::text, 20, '0'),
           bp.id, bp.received_on, bp.recorded_at, bp.stock_item_id, p.name, i.strength_mg::text,
           bp.quantity, bp.unit_cost::text, bp.total_cost::text,
           bp.original_currency, bp.original_unit_cost::text, bp.fx_rate::text, bp.fx_rate_date, bp.supplier
    from public.business_purchases bp
    join public.business_stock_items i on i.id = bp.stock_item_id
    join public.peptides p on p.id = i.peptide_id
    where bp.received_on between p_from and p_to
      and (p_stock_item_id is null or bp.stock_item_id = p_stock_item_id);
end;
$$;

-- Per month and stock item (A14): sales (p_kind 'sales', optionally one
-- seller as in admin_business_ledger_sales) or purchases ('purchases').
create function public.admin_business_ledger_month_items(
  p_kind text,
  p_from date,
  p_to date,
  p_seller uuid default null,
  p_stock_item_id uuid default null
)
returns table (
  row_key text,
  month date,
  stock_item_id uuid,
  peptide_name text,
  strength_mg text,
  entries bigint,
  vials bigint,
  revenue text,
  cost text,
  gross_profit text,
  total text,
  supplier_count bigint,
  supplier text,
  no_supplier bigint
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
  if p_kind is null or p_kind not in ('sales', 'purchases') then
    raise exception 'kind must be sales or purchases' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'give a range of days' using errcode = '22023';
  end if;

  if p_kind = 'sales' then
    return query
      select to_char(t.month, 'YYYY-MM') || ' ' || t.item::text, t.month, t.item, p.name, i.strength_mg::text,
             t.entries, t.vials, t.revenue::text, t.cost::text, t.gross_profit::text,
             null::text, null::bigint, null::text, null::bigint
      from (
        select date_trunc('month', s.sold_on::timestamp)::date as month, s.stock_item_id as item,
               count(*)::bigint as entries, sum(s.quantity)::bigint as vials,
               sum(s.revenue) as revenue, sum(s.cost) as cost, sum(s.gross_profit) as gross_profit
        from public.business_sales s
        where s.sold_on between p_from and p_to
          and (p_seller is null
               or (p_seller = '00000000-0000-0000-0000-000000000000'::uuid and s.seller_id is null)
               or s.seller_id = p_seller)
          and (p_stock_item_id is null or s.stock_item_id = p_stock_item_id)
        group by 1, 2
      ) t
      join public.business_stock_items i on i.id = t.item
      join public.peptides p on p.id = i.peptide_id;
  else
    return query
      select to_char(t.month, 'YYYY-MM') || ' ' || t.item::text, t.month, t.item, p.name, i.strength_mg::text,
             t.entries, t.vials, null::text, null::text, null::text, t.total::text,
             t.supplier_count, case when t.supplier_count = 1 then t.supplier end, t.no_supplier
      from (
        select date_trunc('month', bp.received_on::timestamp)::date as month, bp.stock_item_id as item,
               count(*)::bigint as entries, sum(bp.quantity)::bigint as vials, sum(bp.total_cost) as total,
               count(distinct public.library_name_key(bp.supplier))::bigint as supplier_count,
               (array_agg(bp.supplier order by bp.recorded_order desc) filter (where bp.supplier is not null))[1] as supplier,
               count(*) filter (where bp.supplier is null)::bigint as no_supplier
        from public.business_purchases bp
        where bp.received_on between p_from and p_to
          and (p_stock_item_id is null or bp.stock_item_id = p_stock_item_id)
        group by 1, 2
      ) t
      join public.business_stock_items i on i.id = t.item
      join public.peptides p on p.id = i.peptide_id;
  end if;
end;
$$;

revoke all on function public.admin_business_ledger_sales(date, date, uuid, uuid) from public, anon;
revoke all on function public.admin_business_ledger_purchases(date, date, uuid) from public, anon;
revoke all on function public.admin_business_ledger_month_items(text, date, date, uuid, uuid) from public, anon;
grant execute on function public.admin_business_ledger_sales(date, date, uuid, uuid) to authenticated;
grant execute on function public.admin_business_ledger_purchases(date, date, uuid) to authenticated;
grant execute on function public.admin_business_ledger_month_items(text, date, date, uuid, uuid) to authenticated;
