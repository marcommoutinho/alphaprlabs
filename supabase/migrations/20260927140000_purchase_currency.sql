-- USD purchases with Bank of Canada conversion (tasks/research-app.md
-- "Purchase currency decisions", Marco, 2026-09-27): supplier purchases are
-- often in USD. A purchase entered in USD keeps the USD cost per vial, the
-- Bank of Canada daily USD→CAD rate used and that rate's date, next to the CAD
-- cost per vial FIFO uses. Every total, cost of vials sold and gross profit
-- stays in CAD (plan D1): business_purchases.unit_cost and currency ('CAD')
-- keep their meaning, so sales, allocations and the integrity checks of
-- 20260926160000_business_inventory.sql are untouched.
--
-- Existing rows (production holds CAD opening stock): the new columns are added
-- with a constant default ('CAD') and nulls, which PostgreSQL applies without
-- rewriting or updating any row (no UPDATE trigger fires, so the append-only
-- guard is not involved), and every existing row satisfies the new checks.
-- Recorded purchases stay append-only: nothing here edits one, and a purchase
-- is never re-converted later (its rate is frozen with it, like its CAD cost).
--
-- Where the rate comes from: the app's server fetches it from the Bank of
-- Canada Valet API (src/lib/inventory/fx.ts; never from the browser) for the
-- date received, or the latest published rate before it (weekends, holidays,
-- and today before the day's rate is published). The database cannot check a
-- rate against the Bank of Canada. It checks what it can: the rate's shape
-- (above 0, at most 6 decimals), that its date is on or at most 10 days before
-- the date received (the app's look-back window), and that the CAD cost is
-- exactly round(USD cost × rate, 2), half away from zero, i.e. half-up for
-- these non-negative amounts, as the app computes it. Only admins can call the
-- recording functions (is_admin(), as before), so only an admin's server
-- session can supply a rate.

-- ── Columns and checks ─────────────────────────────────────────────────────
alter table public.business_purchases
  -- The currency the cost was entered in. unit_cost is always CAD.
  add column original_currency text not null default 'CAD',
  -- USD rows only: the USD cost per vial as entered (cents).
  add column original_unit_cost numeric(12, 2),
  -- USD rows only: CAD per USD, exactly as the Bank of Canada published it.
  add column fx_rate numeric,
  -- USD rows only: the date of the published rate used.
  add column fx_rate_date date;

alter table public.business_purchases
  add constraint business_purchases_original_currency check (original_currency in ('CAD', 'USD')),
  -- A CAD row has no conversion; a USD row has all of it, consistent with its CAD cost.
  add constraint business_purchases_conversion check (
    case original_currency
      when 'CAD' then original_unit_cost is null and fx_rate is null and fx_rate_date is null
      else original_unit_cost is not null and fx_rate is not null and fx_rate_date is not null
        and original_unit_cost >= 0 and original_unit_cost <= 1000000
        and fx_rate > 0 and fx_rate < 100 and scale(fx_rate) <= 6
        and fx_rate_date <= received_on and fx_rate_date >= received_on - 10
        and unit_cost = round(original_unit_cost * fx_rate, 2)
    end
  );

-- ── Parsing ────────────────────────────────────────────────────────────────
-- A USD→CAD rate as text: above 0 and below 100, at most 6 decimals (the Bank
-- of Canada publishes 4), kept exactly as given ('1.3760' stays 1.3760).
-- Null when invalid.
create function public.parse_fx_rate(p_text text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := public.trim_whitespace(p_text);
  v_rate numeric;
begin
  if v_text is null or v_text !~ '^[0-9]{1,2}(\.[0-9]{1,6})?$' then
    return null;
  end if;
  v_rate := v_text::numeric;
  return case when v_rate > 0 then v_rate end;
end;
$$;

revoke all on function public.parse_fx_rate(text) from public, anon, authenticated;

-- ── Admin: record a purchase in CAD or USD (A5) ────────────────────────────
-- As record_business_purchase (20260926160100_business_inventory_writes.sql),
-- plus the currency the cost was entered in:
--   * 'CAD': p_unit_cost is the CAD cost per vial; no conversion arguments.
--   * 'USD': p_original_unit_cost is the USD cost per vial, p_fx_rate and
--     p_fx_rate_date the Bank of Canada rate the app's server fetched, and
--     p_unit_cost the CAD cost per vial the app computed. It must equal
--     round(USD × rate, 2) and be at most CAD 1,000,000.00, or nothing is
--     recorded (22023).
-- Idempotency: a repeated p_idempotency_key returns the purchase it already
-- recorded (replayed true) when the details the admin entered match: stock
-- item, date received, vials, currency and the cost as entered (CAD, or USD).
-- The rate is not compared: it is looked up by the server, not entered, and a
-- retry after the day's rate was published would otherwise be refused. Other
-- details refuse the key (AP005), as before.
create function public.record_business_purchase_fx(
  p_idempotency_key uuid,
  p_received_on date,
  p_quantity integer,
  p_unit_cost text,
  p_original_currency text,
  p_original_unit_cost text default null,
  p_fx_rate text default null,
  p_fx_rate_date date default null,
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
  v_currency text := p_original_currency;
  v_original numeric;
  v_rate numeric;
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
  if v_currency is null or v_currency not in ('CAD', 'USD') then
    raise exception 'currency must be CAD or USD' using errcode = '22023';
  end if;
  if v_currency = 'CAD' then
    if p_original_unit_cost is not null or p_fx_rate is not null or p_fx_rate_date is not null then
      raise exception 'a CAD purchase has no conversion' using errcode = '22023';
    end if;
  else
    v_original := public.parse_cad_amount(p_original_unit_cost);
    if v_original is null then
      raise exception 'USD cost per vial must be 0 to 1000000 with at most 2 decimals' using errcode = '22023';
    end if;
    v_rate := public.parse_fx_rate(p_fx_rate);
    if v_rate is null then
      raise exception 'exchange rate must be above 0 with at most 6 decimals' using errcode = '22023';
    end if;
    if p_fx_rate_date is null or p_fx_rate_date > p_received_on or p_fx_rate_date < p_received_on - 10 then
      raise exception 'the rate date must be the date received or up to 10 days before' using errcode = '22023';
    end if;
    if v_cost <> round(v_original * v_rate, 2) then
      raise exception 'CAD cost per vial must be the USD cost times the rate, rounded to the cent' using errcode = '22023';
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

  -- The same lock key as record_business_purchase: the two serialize on a key.
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
    if (v_existing.stock_item_id, v_existing.received_on, v_existing.quantity, v_existing.original_currency,
        case when v_existing.original_currency = 'USD' then v_existing.original_unit_cost else v_existing.unit_cost end)
       is distinct from (v_item, p_received_on, p_quantity, v_currency,
        case when v_currency = 'USD' then v_original else v_cost end) then
      raise exception 'this submission was already recorded with different details' using errcode = 'AP005';
    end if;
    return query select v_existing.id, v_existing.stock_item_id, true;
    return;
  end if;

  -- Serializes with sales of this item (see 20260926160000_business_inventory.sql).
  perform 1 from public.business_stock_items i where i.id = v_item for update;
  if not found then
    raise exception 'unknown stock item' using errcode = 'AP002';
  end if;

  insert into public.business_purchases (
    stock_item_id, received_on, quantity, unit_cost, idempotency_key, recorded_by,
    original_currency, original_unit_cost, fx_rate, fx_rate_date
  )
  values (
    v_item, p_received_on, p_quantity, v_cost, p_idempotency_key, (select auth.uid()),
    v_currency, v_original, v_rate, case when v_currency = 'USD' then p_fx_rate_date end
  )
  returning id into v_id;
  return query select v_id, v_item, false;
end;
$$;

revoke all on function public.record_business_purchase_fx(uuid, date, integer, text, text, text, text, date, uuid, uuid, text)
  from public, anon;
grant execute on function public.record_business_purchase_fx(uuid, date, integer, text, text, text, text, date, uuid, uuid, text)
  to authenticated;

-- ── The CAD function, now one path with the above ─────────────────────────
-- Same signature, return type and privileges (CREATE OR REPLACE keeps its
-- grants): a CAD purchase exactly as before. Its replay now also compares the
-- currency, so a key recorded as a USD purchase is not replayed as CAD (AP005).
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
      p_idempotency_key, p_received_on, p_quantity, p_unit_cost, 'CAD', null, null, null,
      p_stock_item_id, p_peptide_id, p_strength_mg
    ) r;
end;
$$;

-- ── Admin: a stock item's purchase lots, with the conversion (A4) ──────────
-- As before (20260926160200_business_inventory_reads.sql), plus the currency
-- the cost was entered in and, for USD, the USD cost, rate and rate date. The
-- result type changes, so the function is dropped and created again with the
-- same privileges.
drop function public.admin_business_lots(uuid);

create function public.admin_business_lots(p_stock_item_id uuid)
returns table (
  purchase_id uuid,
  received_on date,
  quantity integer,
  unit_cost text,
  total_cost text,
  allocated bigint,
  remaining bigint,
  recorded_at timestamptz,
  recorded_order bigint,
  original_currency text,
  original_unit_cost text,
  fx_rate text,
  fx_rate_date date
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
    select p.id, p.received_on, p.quantity, p.unit_cost::text, p.total_cost::text,
           coalesce(used.quantity, 0)::bigint,
           (p.quantity - coalesce(used.quantity, 0))::bigint,
           p.recorded_at, p.recorded_order,
           p.original_currency, p.original_unit_cost::text, p.fx_rate::text, p.fx_rate_date
    from public.business_purchases p
    left join (
      select a.purchase_id as lot, sum(a.quantity) as quantity
      from public.business_sale_allocations a group by a.purchase_id
    ) used on used.lot = p.id
    where p.stock_item_id = p_stock_item_id
    order by p.received_on, p.recorded_order;
end;
$$;

revoke all on function public.admin_business_lots(uuid) from public, anon;
grant execute on function public.admin_business_lots(uuid) to authenticated;
