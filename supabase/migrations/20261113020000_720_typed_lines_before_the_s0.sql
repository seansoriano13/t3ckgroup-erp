-- S0 Evaluation, lines typed before the S0 exists (#720, spec #718 "Tender-first lines").
--
-- A Tender Line may already exist with no SOR line: source 'typed', sor_item_id null, the
-- client's words, unit and quantity, and an optional Odoo product (all of this was in #267).
-- What this adds:
--
-- 1. Purchasing may name the Odoo product on a typed line (costing_tender_lines.odoo_product_id
--    was a Sales-only column). A line already picked from the S0 (sor_item_id set) keeps the
--    S0's product: a caller who is not in the Sales band cannot change it there.
-- 2. A Tender Line cannot be removed once anything has been bought or compared on it: a Canvass
--    on one of its Components, or on a Requested Item of its Components or of its SOR line, or a
--    P0 (a Requested Item's po_number, or a typed P.O./RFQ No. on a Component). The refusal is
--    "costing_line: ..." with 22023, like the other matrix rules, and it applies to every line,
--    typed or from the S0. Sessions with no signed-in user and a matrix going away (an SOR
--    cascade) pass, as they do for the band and Go-lock triggers.
--
-- No new columns: "Not on the S0" is source = 'typed' and sor_item_id is null.
-- Idempotent.

-- 1. Who may write the Odoo product -------------------------------------------------------------

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_tender_lines', 'odoo_product_id', '{sales,purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

create or replace function public.costing_tender_line_product_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid;
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role'
     or coalesce(current_setting('costing.bypass', true), '') = 'on' then
    return new;
  end if;
  if new.odoo_product_id is not distinct from old.odoo_product_id or old.sor_item_id is null then
    return new;
  end if;
  v_opp := public.costing_matrix_opp(old.matrix_id);
  if v_opp is not null and not public.costing_in_band(v_opp, 'sales') then
    raise exception 'costing_line: a line picked from the S0 keeps the S0''s Odoo product' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.costing_tender_line_product_guard() from public, anon, authenticated;

drop trigger if exists costing_tender_line_product_guard on public.costing_tender_lines;
create trigger costing_tender_line_product_guard before update of odoo_product_id on public.costing_tender_lines
  for each row execute function public.costing_tender_line_product_guard();

-- 2. A line with a Canvass or a P0 stays ------------------------------------------------------

create or replace function public.costing_tender_line_removal_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role'
     or coalesce(current_setting('costing.bypass', true), '') = 'on' then
    return old;
  end if;
  -- The matrix is going (an SOR cascade): nothing left to protect.
  if not exists (select 1 from public.costing_matrices m where m.id = old.matrix_id) then
    return old;
  end if;

  if exists (
    select 1
      from public.sor_canvasses v
     where v.component_id in (select c.id from public.costing_components c where c.tender_line_id = old.id)
        or v.requested_item_id in (
             select i.id
               from public.purchase_request_items i
              where i.component_id in (select c.id from public.costing_components c where c.tender_line_id = old.id)
                 or (old.sor_item_id is not null and i.sor_item_id = old.sor_item_id))
  ) then
    raise exception 'costing_line: a line with a Canvass can''t be removed' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.purchase_request_items i
     where nullif(btrim(i.po_number), '') is not null
       and (i.component_id in (select c.id from public.costing_components c where c.tender_line_id = old.id)
            or (old.sor_item_id is not null and i.sor_item_id = old.sor_item_id))
  ) or exists (
    select 1
      from public.costing_components c
     where c.tender_line_id = old.id and nullif(btrim(c.po_rfq_no), '') is not null
  ) then
    raise exception 'costing_line: a line with a P0 can''t be removed' using errcode = '22023';
  end if;

  return old;
end;
$$;

revoke all on function public.costing_tender_line_removal_guard() from public, anon, authenticated;

drop trigger if exists costing_tender_line_removal_guard on public.costing_tender_lines;
create trigger costing_tender_line_removal_guard before delete on public.costing_tender_lines
  for each row execute function public.costing_tender_line_removal_guard();
