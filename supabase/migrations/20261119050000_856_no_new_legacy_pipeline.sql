-- 856 (spec #844, decision 12): no new deals on the Legacy Pipeline.
--
-- 1. The Legacy Pipeline Sale Type is archived (never deleted). Existing legacy
--    SORs keep their sale_type_id, so they open, move and report as before.
-- 2. The database refuses a new SOR with no Sale Type or with the Legacy
--    Pipeline, and a Sale Type change to either. Callers with no signed-in user
--    (migrations, cutover scripts, service role) and Retail rows (which come
--    from Odoo's queue) are exempt.

update public.sale_types
   set archived_at = now()
 where lower(btrim(name)) = 'legacy pipeline'
   and archived_at is null;

create or replace function public.sor_require_live_sale_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(NEW.is_retail, false) then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.sale_type_id is not distinct from OLD.sale_type_id then
    return NEW;
  end if;

  if NEW.sale_type_id is null then
    raise exception 'Choose a Sale Type for this SOR.';
  end if;

  if exists (
    select 1 from public.sale_types st
    where st.id = NEW.sale_type_id and lower(btrim(st.name)) = 'legacy pipeline'
  ) then
    raise exception 'The Legacy Pipeline is closed to new deals. Choose another Sale Type.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sor_require_live_sale_type on public.sales_opportunities;
create trigger trg_sor_require_live_sale_type
  before insert or update of sale_type_id on public.sales_opportunities
  for each row execute function public.sor_require_live_sale_type();
