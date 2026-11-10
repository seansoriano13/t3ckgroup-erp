-- #919 (spec #926): Landed Cost can't be marked final while a charge is blank.
-- Setting the computation status to LC Odoo Done is refused while any charge of the IPAS has no
-- amount. A trigger (not just ipas_set_header) so no other route can slip past it. Only the move
-- INTO lc_odoo_done is checked: an IPAS already there is not blocked from other edits.

-- Keep in step with isBlankCharge in src/utils/ipasDocuments.js: a charge is blank when amount_php is null
-- (0 counts as filled). The rail, the Remove blank charges button and the missing-files list use that helper.
create or replace function public.ipas_lc_final_needs_charges()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_blank int;
begin
  select count(*) into v_blank
    from public.ipas_charges c
   where c.ipas_id = new.id and c.amount_php is null;
  if v_blank > 0 then
    raise exception 'Landed Cost can''t be marked final while % % no amount. Fill in or remove % in 3 · Costs first.',
      v_blank,
      case when v_blank = 1 then 'charge has' else 'charges have' end,
      case when v_blank = 1 then 'it' else 'them' end
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_lc_final_needs_charges on public.ipas;
create trigger ipas_lc_final_needs_charges
  before update of computation_status on public.ipas
  for each row
  when (new.computation_status = 'lc_odoo_done' and old.computation_status is distinct from 'lc_odoo_done')
  execute function public.ipas_lc_final_needs_charges();
