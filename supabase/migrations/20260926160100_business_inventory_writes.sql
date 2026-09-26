-- S5: recording business purchases and sales (A5, A6). The tables, access
-- model, money and FIFO rules, and the refusal SQLSTATEs are described in
-- 20260926160000_business_inventory.sql.

-- ── Input parsing shared by the write functions ────────────────────────────
-- A CAD amount: a decimal string, 0 or more, at most two decimal places and
-- CAD 1,000,000.00. Null when the text is not such an amount. (PL/pgSQL, so
-- the cast only ever runs after the pattern matched.)
create function public.parse_cad_amount(p_text text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := public.trim_whitespace(p_text);
  v_amount numeric;
begin
  if v_text is null or v_text !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then
    return null;
  end if;
  v_amount := v_text::numeric;
  return case when v_amount <= 1000000 then v_amount end;
end;
$$;

-- A vial strength in mg: a decimal string above 0, at most three decimal
-- places and 100,000 mg, returned without trailing zeros. Null when invalid.
create function public.parse_strength_mg(p_text text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := public.trim_whitespace(p_text);
  v_mg numeric;
begin
  if v_text is null or v_text !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' then
    return null;
  end if;
  v_mg := trim_scale(v_text::numeric);
  return case when v_mg > 0 and v_mg <= 100000 then v_mg end;
end;
$$;

-- The latest date a purchase or sale may carry: today in UTC+14, the first
-- time zone to reach each date (see "Dates" in the first S5 migration). A
-- date after this is in the future for everyone, wherever the admin is.
create function public.business_latest_date()
returns date
language sql
stable
set search_path = ''
as $$
  select ((now() at time zone 'UTC') + interval '14 hours')::date;
$$;

revoke all on function public.parse_cad_amount(text) from public, anon, authenticated;
revoke all on function public.parse_strength_mg(text) from public, anon, authenticated;
revoke all on function public.business_latest_date() from public, anon, authenticated, service_role;

-- ── Admin: record a purchase (A5) ──────────────────────────────────────────
-- Either p_stock_item_id (an existing item) or p_peptide_id + p_strength_mg
-- ("New peptide / strength…": the item is created, or reused when that
-- peptide and strength already exist). Any library peptide may be bought,
-- available or not (A5 lists all library peptides). A repeated
-- p_idempotency_key returns the purchase it already recorded (replayed true)
-- and records nothing; reusing it for different details is refused (AP005).
create function public.record_business_purchase(
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
declare
  v_cost numeric := public.parse_cad_amount(p_unit_cost);
  v_strength numeric;
  v_item uuid := p_stock_item_id;
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
  if v_cost is null then
    raise exception 'cost per vial must be CAD 0 to 1000000 with at most 2 decimals' using errcode = '22023';
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

  perform pg_advisory_xact_lock(hashtextextended('business_purchase:' || p_idempotency_key::text, 0));

  if p_peptide_id is not null then
    insert into public.business_stock_items (peptide_id, strength_mg)
    values (p_peptide_id, v_strength)
    on conflict on constraint business_stock_items_one_per_strength do nothing;
    select i.id into v_item from public.business_stock_items i
    where i.peptide_id = p_peptide_id and i.strength_mg = v_strength;
  end if;

  select * into v_existing from public.business_purchases p where p.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.stock_item_id, v_existing.received_on, v_existing.quantity, v_existing.unit_cost)
       is distinct from (v_item, p_received_on, p_quantity, v_cost) then
      raise exception 'this submission was already recorded with different details' using errcode = 'AP005';
    end if;
    return query select v_existing.id, v_existing.stock_item_id, true;
    return;
  end if;

  -- Serializes with sales of this item (see the header).
  perform 1 from public.business_stock_items i where i.id = v_item for update;
  if not found then
    raise exception 'unknown stock item' using errcode = 'AP002';
  end if;

  insert into public.business_purchases (stock_item_id, received_on, quantity, unit_cost, idempotency_key, recorded_by)
  values (v_item, p_received_on, p_quantity, v_cost, p_idempotency_key, (select auth.uid()))
  returning id into v_id;
  return query select v_id, v_item, false;
end;
$$;

-- ── Admin: record a sale (A6) with its FIFO allocation frozen ──────────────
-- Buyer: p_buyer_profile_id (a researcher or admin account; a reference only)
-- or p_buyer_name (an outside buyer's name or reference), not both. Refuses a
-- quantity above the vials on hand (AP001, DETAIL = on hand) and records
-- nothing. The sale date may be before the purchases it uses, never in the
-- future (AP006). A repeated p_idempotency_key returns the sale it already
-- recorded (replayed true), even if stock has since run out; reusing it for
-- different details is refused (AP005). The replay lookup comes before any
-- check against current data (the buyer account, stock), so a replay depends
-- only on the recorded sale and the resubmitted details.
create function public.record_business_sale(
  p_idempotency_key uuid,
  p_stock_item_id uuid,
  p_sold_on date,
  p_quantity integer,
  p_unit_price text,
  p_buyer_profile_id uuid default null,
  p_buyer_name text default null
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
  v_existing public.business_sales;
  v_on_hand bigint;
  v_need integer := p_quantity;
  v_take integer;
  v_cost numeric := 0;
  v_lot record;
  v_lots uuid[] := '{}';
  v_quantities integer[] := '{}';
  v_costs numeric[] := '{}';
  v_dates date[] := '{}';
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

  perform pg_advisory_xact_lock(hashtextextended('business_sale:' || p_idempotency_key::text, 0));

  -- Replay: compared with the details as submitted. An account sale always
  -- keeps its buyer_profile_id (profiles it references cannot be deleted), so
  -- the account is compared by id; its stored name is a snapshot.
  select * into v_existing from public.business_sales s where s.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.stock_item_id, v_existing.sold_on, v_existing.quantity, v_existing.unit_price, v_existing.buyer_type)
         is distinct from (p_stock_item_id, p_sold_on, p_quantity, v_price, v_buyer_type)
       or (v_buyer_type = 'account' and v_existing.buyer_profile_id is distinct from p_buyer_profile_id)
       or (v_buyer_type = 'outside' and v_existing.buyer_name is distinct from v_buyer_name) then
      raise exception 'this submission was already recorded with different details' using errcode = 'AP005';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  -- A new sale: the buyer account must exist; its current name is kept.
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

  -- FIFO: oldest remaining purchase quantities first, by received date, then
  -- recording order (business_purchases.recorded_order; the same order as
  -- admin_business_lots and src/lib/inventory/rules.ts allocateFifo).
  for v_lot in
    select p.id, p.unit_cost, p.received_on,
           p.quantity - coalesce((select sum(a.quantity) from public.business_sale_allocations a where a.purchase_id = p.id), 0) as remaining
    from public.business_purchases p
    where p.stock_item_id = p_stock_item_id
    order by p.received_on, p.recorded_order
  loop
    exit when v_need = 0;
    continue when v_lot.remaining <= 0;
    v_take := least(v_lot.remaining, v_need);
    v_lots := v_lots || v_lot.id;
    v_quantities := v_quantities || v_take;
    v_costs := v_costs || v_lot.unit_cost;
    v_dates := v_dates || v_lot.received_on;
    v_cost := v_cost + v_take * v_lot.unit_cost;
    v_need := v_need - v_take;
  end loop;
  if v_need <> 0 then
    raise exception 'insufficient stock' using errcode = 'AP001', detail = v_on_hand::text;
  end if;

  insert into public.business_sales (
    stock_item_id, sold_on, quantity, unit_price, revenue, cost,
    buyer_type, buyer_profile_id, buyer_name, idempotency_key, recorded_by
  )
  values (
    p_stock_item_id, p_sold_on, p_quantity, v_price, p_quantity * v_price, v_cost,
    v_buyer_type, p_buyer_profile_id, v_buyer_name, p_idempotency_key, (select auth.uid())
  )
  returning id into v_id;

  insert into public.business_sale_allocations (sale_id, purchase_id, quantity, unit_cost, received_on)
  select v_id, l.purchase_id, l.quantity, l.unit_cost, l.received_on
  from unnest(v_lots, v_quantities, v_costs, v_dates) as l (purchase_id, quantity, unit_cost, received_on);

  return query select v_id, false;
end;
$$;

revoke all on function public.record_business_purchase(uuid, date, integer, text, uuid, uuid, text) from public, anon;
revoke all on function public.record_business_sale(uuid, uuid, date, integer, text, uuid, text) from public, anon;
grant execute on function public.record_business_purchase(uuid, date, integer, text, uuid, uuid, text) to authenticated;
grant execute on function public.record_business_sale(uuid, uuid, date, integer, text, uuid, text) to authenticated;
