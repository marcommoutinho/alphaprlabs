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
-- Where the rate comes from (Marco, 2026-09-27): our own copy of the Bank of
-- Canada daily rates, public.fx_rates, so saving doesn't depend on the Bank of
-- Canada being up. A daily cron (/api/cron/fx-rates, vercel.json) and a
-- one-off backfill (scripts/fx-backfill.mjs) fill it from the Valet API
-- through store_fx_rates(), callable by the secret key only. When a purchase
-- is saved, the app's server (src/lib/inventory/fx.ts; never the browser)
-- uses the stored rate for the date received, or the latest stored before it
-- within 10 days (weekends, holidays, and today before the day's rate is
-- published); only when that window has none does it ask the Valet API once,
-- store what it got, and use the stored rate.
--
-- The database checks a new USD purchase the same way the app chooses its
-- rate: the rate date must be the LATEST fx_rates date on or at most 10 days
-- before the date received, and the rate that row's rate (so it is a
-- published Bank of Canada rate as fetched, never one typed or sent by a
-- browser, and never an older stored rate picked over a newer one). The CAD
-- cost must be exactly round(USD cost × rate, 2), half away from zero, i.e.
-- half-up for these non-negative amounts, as the app computes it. If a newer
-- rate for the window is stored between the app's lookup and the save (the
-- daily sync, or another save's fallback filling the gap), the save is
-- refused with AP028 and nothing is recorded; the app then looks the rate up
-- again and retries once. Only admins can call the recording functions
-- (is_admin(), as before).

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

-- ── Our copy of the Bank of Canada daily USD→CAD rates ─────────────────────
-- One row per published business day, the rate exactly as published
-- ('1.3760' keeps its scale). Deny by default: admins read it (display); no
-- client writes at all; rows are added only by store_fx_rates() below, and a
-- stored rate is never changed or removed (guard trigger, the owner's
-- ordinary statements included): purchases refer to it.
create table public.fx_rates (
  rate_date date primary key check (rate_date between date '2000-01-01' and date '2100-12-31'),
  usd_cad numeric not null check (usd_cad > 0 and usd_cad < 100 and scale(usd_cad) <= 6),
  fetched_at timestamptz not null default now(),
  source text not null default 'boc-valet' check (source = 'boc-valet')
);

alter table public.fx_rates enable row level security;
revoke all on table public.fx_rates from public, anon, authenticated, service_role;
grant select on table public.fx_rates to authenticated, service_role;
create policy fx_rates_admin_select on public.fx_rates
  for select to authenticated using ((select public.is_admin()));

create function public.fx_rates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a stored Bank of Canada rate cannot be changed or removed' using errcode = '42501';
end;
$$;

revoke all on function public.fx_rates_guard() from public, anon, authenticated, service_role;

create trigger fx_rates_guard before update or delete on public.fx_rates
  for each row execute function public.fx_rates_guard();
create trigger fx_rates_no_truncate before truncate on public.fx_rates
  for each statement execute function public.fx_rates_guard();

-- Stores Bank of Canada rates: p_rates is a JSON array of
-- {"date": "YYYY-MM-DD", "rate": "1.3876"} as published. Secret key only.
--   * Only valid rows are stored: a calendar date from 2000 to 2100 and a rate
--     above 0 and below 100 with at most 6 decimals (parse_fx_rate). Invalid
--     rows are skipped and counted (invalid).
--   * A date already stored with the same rate is left as is (unchanged).
--   * A date already stored with a DIFFERENT rate keeps the first one: a rate
--     purchases may already use is never silently changed. The date is
--     returned in conflicts, and the caller logs it for a person to look at.
-- Idempotent: storing the same rates again changes nothing.
create function public.store_fx_rates(p_rates jsonb)
returns table (stored integer, unchanged integer, invalid integer, conflicts date[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_date date;
  v_rate numeric;
  v_existing numeric;
  v_stored integer := 0;
  v_unchanged integer := 0;
  v_invalid integer := 0;
  v_conflicts date[] := '{}';
begin
  if p_rates is null or jsonb_typeof(p_rates) <> 'array' then
    raise exception 'rates must be a JSON array' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_rates) loop
    v_date := null;
    v_rate := null;
    if jsonb_typeof(v_item) = 'object' and jsonb_typeof(v_item -> 'date') = 'string' and jsonb_typeof(v_item -> 'rate') = 'string'
       and (v_item ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        v_date := (v_item ->> 'date')::date;
      exception when others then
        v_date := null;
      end;
      v_rate := public.parse_fx_rate(v_item ->> 'rate');
    end if;
    if v_date is null or v_rate is null or v_date not between date '2000-01-01' and date '2100-12-31' then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    insert into public.fx_rates (rate_date, usd_cad) values (v_date, v_rate)
    on conflict (rate_date) do nothing;
    if found then
      v_stored := v_stored + 1;
    else
      select r.usd_cad into v_existing from public.fx_rates r where r.rate_date = v_date;
      if v_existing = v_rate then
        v_unchanged := v_unchanged + 1;
      else
        v_conflicts := v_conflicts || v_date;
      end if;
    end if;
  end loop;
  return query select v_stored, v_unchanged, v_invalid, v_conflicts;
end;
$$;

revoke all on function public.store_fx_rates(jsonb) from public, anon, authenticated;
grant execute on function public.store_fx_rates(jsonb) to service_role;

-- ── Admin: record a purchase in CAD or USD (A5) ────────────────────────────
-- As record_business_purchase (20260926160100_business_inventory_writes.sql),
-- plus the currency the cost was entered in:
--   * 'CAD': p_unit_cost is the CAD cost per vial; no conversion arguments.
--   * 'USD': p_original_unit_cost is the USD cost per vial, p_fx_rate and
--     p_fx_rate_date the stored Bank of Canada rate the app's server chose,
--     and p_unit_cost the CAD cost per vial the app computed. For a new
--     purchase the rate must be the latest stored one within the 10 days up
--     to the date received (AP028 otherwise: a newer rate was stored, look it
--     up again; 22023 when none is stored), and the CAD cost must equal
--     round(USD × rate, 2) and be at most CAD 1,000,000.00, or nothing is
--     recorded (22023). A replay needs none of the three.
-- Idempotency: a repeated p_idempotency_key returns the purchase it already
-- recorded (replayed true) when the details the admin entered match: stock
-- item, date received, vials, currency and the cost as entered (CAD, or USD).
-- Other details refuse the key (AP005), as before. The replay lookup comes
-- after the entered details are checked and BEFORE the conversion is: a USD
-- replay needs no rate (the conversion arguments may be absent or differ),
-- so a retry after a lost response reaches the recorded purchase even while
-- the Bank of Canada is unreachable, or after the day's rate was published.
-- The app looks the key up first and replays without fetching a rate.
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
  p_strength_mg text default null
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

  -- The same lock key as record_business_purchase: the two serialize on a key.
  perform pg_advisory_xact_lock(hashtextextended('business_purchase:' || p_idempotency_key::text, 0));

  if p_peptide_id is not null then
    insert into public.business_stock_items (peptide_id, strength_mg)
    values (p_peptide_id, v_strength)
    on conflict on constraint business_stock_items_one_per_strength do nothing;
    select i.id into v_item from public.business_stock_items i
    where i.peptide_id = p_peptide_id and i.strength_mg = v_strength;
  end if;

  -- Replay: compared with the details as entered, before the conversion.
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

  -- A new purchase: its conversion (USD) or none (CAD).
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
    -- The rate the app would choose now: the latest stored in the window.
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
      p_idempotency_key, p_received_on, p_quantity, 'CAD', p_unit_cost, null, null, null,
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
