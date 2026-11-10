-- #711 (spec #699): IPAS documents are required at the section they belong to.
--
-- Stored sections are 1, 3, 6, 7 (screen 1, 2, 3, 4). A section's first sign-off is
-- refused while a document it needs has no file:
--   screen 1 (stored 1)  the Proforma Invoice (Import) or the Quotation (Local)
--   screen 2 (stored 3)  proof of payment on every payment
--   screen 3 (stored 6)  Import only: BL or Waybill, Packing List, Commercial Invoice,
--                        Freight Billing
--   screen 4 (stored 7)  BIR 2307
-- "Has a file" means an ipas_documents row of that kind with an attachment_url. The
-- landed cost sheet is made by the app and never asked for.
-- The first sign-off is Submit (prepared) for 1, 3 and 6, and Received for 7.
-- The check is a trigger on ipas_signoffs, so ipas_sign needs no edit.
-- Idempotent: create or replace, drop trigger if exists.

-- The labels of the documents a section still lacks, as a jsonb array of text.
create or replace function public._ipas_missing_documents(p_ipas_id uuid, p_section integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source text;
  v_kinds text[];
  v_kind text;
  v_missing text[] := '{}';
  v_pay record;
begin
  select source into v_source from public.ipas where id = p_ipas_id;
  if v_source is null then
    return '[]'::jsonb;
  end if;

  if p_section = 3 then
    for v_pay in
      select paid_on from public.ipas_payments
       where ipas_id = p_ipas_id and proof_url is null
       order by paid_on, created_at
    loop
      v_missing := v_missing || ('Proof of payment of ' || to_char(v_pay.paid_on, 'Mon DD, YYYY'));
    end loop;
    return to_jsonb(v_missing);
  end if;

  v_kinds := case p_section
    when 1 then case when v_source = 'import' then array['Proforma Invoice'] else array['Quotation (Local)'] end
    when 6 then case when v_source = 'import'
                     then array['BL or Waybill', 'Packing List', 'Commercial Invoice', 'Freight Billing']
                     else '{}'::text[] end
    when 7 then array['BIR 2307']
    else '{}'::text[]
  end;

  foreach v_kind in array v_kinds loop
    if not exists (
      select 1
        from public.ipas_documents d
        join public.ipas_options o on o.id = d.kind_id
       where d.ipas_id = p_ipas_id
         and o.list = 'document_kind'
         and lower(btrim(o.label)) = lower(v_kind)
         and d.attachment_url is not null
    ) then
      v_missing := v_missing || v_kind;
    end if;
  end loop;

  return to_jsonb(v_missing);
end;
$$;

revoke all on function public._ipas_missing_documents(uuid, integer) from public, anon, authenticated;

-- A section's first sign-off may not be given while its documents are missing.
create or replace function public._ipas_signoff_documents_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_missing jsonb;
begin
  if (new.section in (1, 3, 6) and new.role = 'prepared')
     or (new.section = 7 and new.role = 'received') then
    v_missing := public._ipas_missing_documents(new.ipas_id, new.section::integer);
    if jsonb_array_length(v_missing) > 0 then
      raise exception 'ipas_sign: section % needs % first',
        public._ipas_section_no(new.section::integer),
        (select string_agg(x, ', ') from jsonb_array_elements_text(v_missing) as x)
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._ipas_signoff_documents_guard() from public, anon, authenticated;

drop trigger if exists ipas_signoffs_documents_guard on public.ipas_signoffs;
create trigger ipas_signoffs_documents_guard
  before insert on public.ipas_signoffs
  for each row execute function public._ipas_signoff_documents_guard();
