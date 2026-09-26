-- S5: admin-only reads for the inventory screens (A4 stock list and stock
-- item, A6 buyer accounts and preview, A7 totals). Each function checks
-- is_admin() itself; see 20260926160000_business_inventory.sql for the access
-- model. Amounts are returned as exact decimal text.

-- ── Admin: stock list (A4) ─────────────────────────────────────────────────
-- Every stock item with its peptide's name (available or not: the peptides
-- table shows admins available entries only), vials purchased, sold and on
-- hand. Strength as text without trailing zeros.
create function public.admin_business_stock()
returns table (
  stock_item_id uuid,
  peptide_id uuid,
  peptide_name text,
  peptide_available boolean,
  strength_mg text,
  purchased bigint,
  sold bigint,
  on_hand bigint,
  created_at timestamptz
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
    select i.id, p.id, p.name, p.available, i.strength_mg::text,
           coalesce(bought.quantity, 0)::bigint,
           coalesce(sold.quantity, 0)::bigint,
           (coalesce(bought.quantity, 0) - coalesce(sold.quantity, 0))::bigint,
           i.created_at
    from public.business_stock_items i
    join public.peptides p on p.id = i.peptide_id
    left join (
      select bp.stock_item_id as item, sum(bp.quantity) as quantity
      from public.business_purchases bp group by bp.stock_item_id
    ) bought on bought.item = i.id
    left join (
      select bs.stock_item_id as item, sum(bs.quantity) as quantity
      from public.business_sales bs group by bs.stock_item_id
    ) sold on sold.item = i.id
    order by lower(p.name), p.id, i.strength_mg;
end;
$$;

-- ── Admin: a stock item's purchase lots (A4 stock item, A6 preview) ────────
-- In FIFO order (the order record_business_sale allocates in: received date,
-- then recorded_order), with how many vials of each are already allocated to
-- sales and how many remain. recorded_order is returned so the A6 preview
-- (src/lib/inventory/rules.ts allocateFifo) sorts by exactly the same key.
-- Amounts as exact decimal text.
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
  recorded_order bigint
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
           p.recorded_at, p.recorded_order
    from public.business_purchases p
    left join (
      select a.purchase_id as lot, sum(a.quantity) as quantity
      from public.business_sale_allocations a group by a.purchase_id
    ) used on used.lot = p.id
    where p.stock_item_id = p_stock_item_id
    order by p.received_on, p.recorded_order;
end;
$$;

-- ── Admin: sales totals per stock item (A7 KPIs and by-item rows) ──────────
-- Sales dated p_from..p_to (inclusive; null = open) for one item or all.
-- Exact sums in the database, so totals never depend on how many sale rows a
-- page fetches. Amounts as exact decimal text.
create function public.admin_business_sales_totals(
  p_from date default null,
  p_to date default null,
  p_stock_item_id uuid default null
)
returns table (stock_item_id uuid, sales bigint, vials bigint, revenue text, cost text, gross_profit text)
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
    select s.stock_item_id, count(*)::bigint, sum(s.quantity)::bigint,
           sum(s.revenue)::text, sum(s.cost)::text, sum(s.gross_profit)::text
    from public.business_sales s
    where (p_from is null or s.sold_on >= p_from)
      and (p_to is null or s.sold_on <= p_to)
      and (p_stock_item_id is null or s.stock_item_id = p_stock_item_id)
    group by s.stock_item_id;
end;
$$;

-- ── Admin: buyer accounts for A6 ───────────────────────────────────────────
-- The minimum identity needed to link a sale to an account: id, name, email.
create function public.business_buyer_accounts()
returns table (profile_id uuid, name text, email text)
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
    select pr.id, pr.name, pr.email from public.profiles pr
    where pr.role in ('researcher', 'admin')
    order by lower(pr.name), pr.email;
end;
$$;

revoke all on function public.admin_business_stock() from public, anon;
revoke all on function public.business_buyer_accounts() from public, anon;
revoke all on function public.admin_business_lots(uuid) from public, anon;
revoke all on function public.admin_business_sales_totals(date, date, uuid) from public, anon;
grant execute on function public.admin_business_lots(uuid) to authenticated;
grant execute on function public.admin_business_sales_totals(date, date, uuid) to authenticated;
grant execute on function public.admin_business_stock() to authenticated;
grant execute on function public.business_buyer_accounts() to authenticated;
