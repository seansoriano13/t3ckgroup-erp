-- #725 (spec #718): New Transmittal accepts an IPAS and gets its PO lines back
-- as draft lines. The preparer unticks what did not arrive or edits a quantity on
-- the screen; the slip is still written by transmittal_create, so no Transmittal
-- rule changes. Same columns as transmittal_pickable_po_lines: no price, supplier
-- or bank column.

create or replace function public.transmittal_ipas_po_lines(p_ipas_number text)
returns table (
  ipas_id uuid,
  ipas_number text,
  po_number text,
  odoo_po_line_id integer,
  product_name text,
  quantity numeric,
  unit text,
  entity text,
  sors jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ipas public.ipas%rowtype;
begin
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_ipas_po_lines: only a Transmittal preparer picks PO lines' using errcode = '42501';
  end if;

  select * into v_ipas
    from public.ipas i
   where lower(btrim(i.number)) = lower(btrim(coalesce(p_ipas_number, '')))
     and i.state <> 'cancelled';
  if not found then
    raise exception 'transmittal_ipas_po_lines: that IPAS doesn''t exist or is cancelled' using errcode = 'P0002';
  end if;

  return query
  select
    v_ipas.id,
    v_ipas.number,
    v_ipas.po_number,
    (l->>'line_id')::integer,
    nullif(btrim(l->>'name'), ''),
    nullif(l->>'quantity', '')::numeric,
    nullif(btrim(l->>'unit'), ''),
    coalesce(nullif(btrim(v_ipas.entity_override), ''), nullif(btrim(v_ipas.odoo_copy #>> '{po,company}'), '')),
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'sales_reference', o.sales_reference, 'project_title', o.project_title
        ) order by o.sales_reference)
        from public.ipas_sors s
        join public.sales_opportunities o on o.id = s.opportunity_id
       where s.ipas_id = v_ipas.id
    ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(v_ipas.odoo_copy -> 'lines', '[]'::jsonb)) as l
  order by (l->>'line_id')::integer;
end;
$$;

comment on function public.transmittal_ipas_po_lines(text) is
  '#725: every PO line of one live IPAS, by IPAS number, for a New Transmittal to fill as draft lines. Never returns a price, supplier or bank column.';

revoke all on function public.transmittal_ipas_po_lines(text) from public, anon;
grant execute on function public.transmittal_ipas_po_lines(text) to authenticated;
