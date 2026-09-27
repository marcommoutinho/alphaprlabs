-- Sellers, admin invitations and buyer linking (tasks/research-app.md,
-- "Sellers, admin invitations and buyer linking", Marco, 2026-09-27):
--
--   1. Every new sale records its seller, which is required and must be a
--      current admin account. A7 Sales shows revenue, cost and gross profit
--      per seller for the chosen period (admin_business_seller_totals).
--   2. Admins can invite a new admin: an invitation carries the role the
--      account is created with (researcher unless an admin chose Admin).
--   3. An outside-buyer sale can later be linked by an admin to that person's
--      account (link_business_sale). The link is a buyer reference only: it
--      grants no access to history (support shares are untouched) and adds
--      nothing to personal supplies (no researcher table is touched).
--
-- Business records stay append-only (20260926160000_business_inventory.sql):
-- revenue, cost, allocations, date and quantity of a sale never change. The
-- guard (business_records_guard, replaced below) now allows exactly one
-- change to a recorded sale: link_business_sale's outside → account link,
-- and only while that function has marked that very sale in its own
-- transaction. Every other UPDATE, DELETE or TRUNCATE is refused as before.
--
-- Existing rows (production holds no sales; this stays safe if some exist):
-- the new columns are added without a default, so no row is rewritten or
-- updated and no UPDATE trigger fires. A sale recorded before this
-- migration keeps no seller ("Seller not recorded" on A7); the seller is
-- required for every NEW sale by record_business_sale and, as a backstop for
-- any other insert, by the business_sales_seller trigger. Existing
-- invitations take the default role, researcher (a constant default: no
-- rewrite).
--
-- Who sees sellers: business_sales, the seller totals and the seller list are
-- admin-only (is_admin(), as every business read). Researchers never see a
-- seller or any admin name: no researcher-callable read returns them.
--
-- Refusals added to the list in 20260926160000_business_inventory.sql:
--   22023 seller required            AP029 the seller is not a current admin
--   AP030 this sale cannot be linked (unknown, or its buyer is not an outside buyer)
--   AP004 (existing) unknown account, also for the account a sale is linked to

-- ── Columns and checks ─────────────────────────────────────────────────────
alter table public.business_sales
  -- The admin who made the sale, and their name at the time (a snapshot, as
  -- buyer_name is). Null only on sales recorded before this migration.
  add column seller_id uuid references public.profiles (id) on delete restrict,
  add column seller_name text,
  -- Set once, by link_business_sale: the outside buyer's name as recorded,
  -- when and by which admin the sale was linked to an account.
  add column original_buyer_name text,
  add column linked_at timestamptz,
  add column linked_by uuid references public.profiles (id) on delete restrict;

alter table public.business_sales
  add constraint business_sales_seller check (
    (seller_id is null) = (seller_name is null)
    and (seller_name is null or (seller_name = public.trim_whitespace(seller_name) and char_length(seller_name) between 1 and 120))
  ),
  -- A linked sale is an account sale that remembers its outside buyer.
  add constraint business_sales_link check (
    (linked_at is null) = (linked_by is null)
    and (linked_at is null) = (original_buyer_name is null)
    and (linked_at is null or buyer_type = 'account')
    and (original_buyer_name is null
      or (original_buyer_name = public.trim_whitespace(original_buyer_name) and char_length(original_buyer_name) between 1 and 120))
  );

create index business_sales_by_seller on public.business_sales (seller_id, sold_on);
create index business_sales_outside_by_name on public.business_sales (buyer_name) where buyer_type = 'outside';

-- ── Every new sale names a current admin as its seller ─────────────────────
-- The backstop for any insert (only record_business_sale inserts through the
-- API); record_business_sale checks the same first to give its refusals.
create function public.business_sale_seller_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seller_id is null or new.seller_name is null then
    raise exception 'a sale records its seller' using errcode = '23502';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.seller_id and p.role = 'admin') then
    raise exception 'the seller must be a current admin' using errcode = 'AP029';
  end if;
  if new.linked_at is not null or new.linked_by is not null or new.original_buyer_name is not null then
    raise exception 'a new sale cannot be recorded as linked' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.business_sale_seller_check() from public, anon, authenticated, service_role;

create trigger business_sales_seller before insert on public.business_sales
  for each row execute function public.business_sale_seller_check();

-- ── The append-only guard, with its one exception ──────────────────────────
-- Same triggers (on all four tables, row and statement level). The only
-- change a recorded row may take is a sale's link from an outside buyer to an
-- account, made by link_business_sale, which marks the sale it is linking in
-- a transaction-local setting first (nothing reachable through the API can
-- set it). Even then every other column must stay exactly as recorded.
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
  raise exception 'recorded business stock, purchases and sales cannot be changed' using errcode = '42501';
end;
$$;

revoke all on function public.business_records_guard() from public, anon, authenticated, service_role;

-- ── Admin: record a sale (A6), now with its seller ─────────────────────────
-- As before (20260926160100_business_inventory_writes.sql), plus p_seller_id:
-- required (22023 without it), and for a new sale a current admin (AP029),
-- whose name is kept as seller_name. A replay compares the seller too: the
-- same key with another seller is refused (AP005). As before, the replay
-- lookup comes before any check against current data, so a retried sale
-- replays even if its seller has since stopped being an admin. The previous
-- signature is dropped: every caller must name a seller.
drop function public.record_business_sale(uuid, uuid, date, integer, text, uuid, text);

create function public.record_business_sale(
  p_idempotency_key uuid,
  p_stock_item_id uuid,
  p_sold_on date,
  p_quantity integer,
  p_unit_price text,
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

  perform pg_advisory_xact_lock(hashtextextended('business_sale:' || p_idempotency_key::text, 0));

  -- Replay: compared with the details as submitted, the seller included. A
  -- sale linked to an account since (link_business_sale) keeps its outside
  -- buyer's name as original_buyer_name, so its own resubmission (outside,
  -- that name) still replays.
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

  -- FIFO: oldest remaining purchase quantities first, by received date, then
  -- recording order (unchanged).
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

revoke all on function public.record_business_sale(uuid, uuid, date, integer, text, uuid, text, uuid) from public, anon;
grant execute on function public.record_business_sale(uuid, uuid, date, integer, text, uuid, text, uuid) to authenticated;

-- ── Admin: link an outside-buyer sale to an account ────────────────────────
-- Converts the sale to buyer_type 'account' with p_buyer_profile_id (any
-- researcher account, admins included: admins are researchers), keeping the
-- outside name as original_buyer_name and recording linked_at and linked_by.
-- The buyer_name becomes the account's current name, as for a sale recorded
-- to an account. Nothing else changes (the guard checks it). p_same_name
-- also links every other outside sale recorded with exactly the same buyer
-- name. Returns how many sales were linked now: 0 when this sale is already
-- linked to that account (a repeated request). Refusals: 42501 not an admin;
-- 22023 missing input; AP030 unknown sale, or its buyer is not an outside
-- buyer (an account sale, or linked to another account); AP004 unknown account.
create function public.link_business_sale(p_sale_id uuid, p_buyer_profile_id uuid, p_same_name boolean default false)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sale public.business_sales;
  v_name text;
  v_id uuid;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_sale_id is null or p_buyer_profile_id is null then
    raise exception 'sale and account required' using errcode = '22023';
  end if;

  -- Serializes links of this sale: a second request waits, then sees it linked.
  select * into v_sale from public.business_sales s where s.id = p_sale_id for update;
  if not found then
    raise exception 'unknown sale' using errcode = 'AP030';
  end if;
  if v_sale.buyer_type <> 'outside' then
    if v_sale.linked_at is not null and v_sale.buyer_profile_id = p_buyer_profile_id then
      return 0;
    end if;
    raise exception 'only an outside buyer''s sale can be linked' using errcode = 'AP030';
  end if;

  select left(public.trim_whitespace(pr.name), 120) into v_name
  from public.profiles pr where pr.id = p_buyer_profile_id and pr.role in ('researcher', 'admin');
  if not found then
    raise exception 'unknown account' using errcode = 'AP004';
  end if;

  for v_id in
    select s.id from public.business_sales s
    where s.id = p_sale_id
       or (coalesce(p_same_name, false) and s.buyer_type = 'outside' and s.buyer_name = v_sale.buyer_name)
    order by s.id
    for update
  loop
    perform set_config('app.business_sale_link', v_id::text, true);
    update public.business_sales s
    set buyer_type = 'account',
        buyer_profile_id = p_buyer_profile_id,
        buyer_name = v_name,
        original_buyer_name = s.buyer_name,
        linked_at = now(),
        linked_by = (select auth.uid())
    where s.id = v_id and s.buyer_type = 'outside';
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  perform set_config('app.business_sale_link', '', true);
  return v_count;
end;
$$;

revoke all on function public.link_business_sale(uuid, uuid, boolean) from public, anon;
grant execute on function public.link_business_sale(uuid, uuid, boolean) to authenticated;

-- ── Admin: the sellers A6 offers (current admins) ──────────────────────────
create function public.business_sellers()
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
    where pr.role = 'admin'
    order by lower(pr.name), pr.email;
end;
$$;

revoke all on function public.business_sellers() from public, anon;
grant execute on function public.business_sellers() to authenticated;

-- ── Admin: sales totals per seller (A7) ────────────────────────────────────
-- Sales dated p_from..p_to (inclusive; null = open) for one item or all,
-- summed exactly in the database, one row per seller: so the totals never
-- depend on how many sale rows a page fetches. seller_key is the seller's id,
-- or the nil UUID for sales recorded before sellers existed (seller_id null),
-- so the rows can be paged by a key that is never null. seller_name is the
-- seller's current name (their name when they last sold, if the profile has
-- none). Amounts as exact decimal text.
create function public.admin_business_seller_totals(
  p_from date default null,
  p_to date default null,
  p_stock_item_id uuid default null
)
returns table (
  seller_key uuid,
  seller_id uuid,
  seller_name text,
  sales bigint,
  vials bigint,
  revenue text,
  cost text,
  gross_profit text
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
    select coalesce(t.seller_id, '00000000-0000-0000-0000-000000000000'::uuid), t.seller_id,
           coalesce(left(public.trim_whitespace(pr.name), 120), t.last_name),
           t.sales, t.vials, t.revenue::text, t.cost::text, t.gross_profit::text
    from (
      select s.seller_id, count(*)::bigint as sales, sum(s.quantity)::bigint as vials,
             sum(s.revenue) as revenue, sum(s.cost) as cost, sum(s.gross_profit) as gross_profit,
             (array_agg(s.seller_name order by s.recorded_at desc))[1] as last_name
      from public.business_sales s
      where (p_from is null or s.sold_on >= p_from)
        and (p_to is null or s.sold_on <= p_to)
        and (p_stock_item_id is null or s.stock_item_id = p_stock_item_id)
      group by s.seller_id
    ) t
    left join public.profiles pr on pr.id = t.seller_id;
end;
$$;

revoke all on function public.admin_business_seller_totals(date, date, uuid) from public, anon;
grant execute on function public.admin_business_seller_totals(date, date, uuid) to authenticated;

-- ── Invitations carry the role the account is created with ─────────────────
alter table public.invitations
  add column role public.app_role not null default 'researcher';

-- Admin: invite (or refresh an expired or failed invitation for) an email,
-- as a researcher (the default) or an admin. Only admins can call it at all,
-- so only admins create admin invitations. As before otherwise: returns
-- outcome 'ok' (with the row id), 'account_exists' or 'pending_exists' (a
-- pending invitation keeps its role; nothing changes). Refreshing an expired
-- or failed invitation sends it with the role chosen now.
drop function public.invite_researcher(text, text, text);

create function public.invite_researcher(p_name text, p_email text, p_token_hash text, p_role public.app_role default 'researcher')
returns table (outcome text, invitation_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_open public.invitations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'role required' using errcode = '22023';
  end if;

  -- Serialize concurrent invitations for the same address.
  perform pg_advisory_xact_lock(hashtext('invitation:' || v_email));

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return query select 'account_exists'::text, null::uuid;
    return;
  end if;

  select * into v_open from public.invitations i
  where i.email = v_email and i.state in ('pending', 'failed')
  for update;

  if found and v_open.state = 'pending' and v_open.expires_at > now() then
    return query select 'pending_exists'::text, v_open.id;
    return;
  end if;

  if found then
    update public.invitations i
    set name = btrim(coalesce(p_name, '')), token_hash = p_token_hash, state = 'pending', role = p_role,
        sent_at = now(), expires_at = now() + interval '30 days',
        last_send_error = null, invited_by = (select auth.uid())
    where i.id = v_open.id;
    return query select 'ok'::text, v_open.id;
    return;
  end if;

  return query
    insert into public.invitations (name, email, token_hash, invited_by, role)
    values (btrim(coalesce(p_name, '')), v_email, p_token_hash, (select auth.uid()), p_role)
    returning 'ok'::text, id;
end;
$$;

revoke all on function public.invite_researcher(text, text, text, public.app_role) from public, anon;
grant execute on function public.invite_researcher(text, text, text, public.app_role) to authenticated;

-- resend_invitation (unchanged) keeps the row's role: it only renews the
-- token and dates.

-- Server only (secret key): create the profile for the account made from a
-- claimed invitation, with the invitation's role and email.
create or replace function public.complete_invitation(p_id uuid, p_user_id uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role public.app_role;
begin
  update public.invitations i
  set accepted_user_id = p_user_id
  where i.id = p_id and i.state = 'accepted' and i.accepted_user_id is null
  returning i.email, i.role into v_email, v_role;

  if v_email is null then
    raise exception 'invitation is not claimed' using errcode = 'P0002';
  end if;

  insert into public.profiles (id, name, email, role)
  values (p_user_id, btrim(p_name), v_email, v_role);
end;
$$;

revoke all on function public.complete_invitation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_invitation(uuid, uuid, text) to service_role;
