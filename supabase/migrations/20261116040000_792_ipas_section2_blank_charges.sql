-- #792: IPAS screen 2 (stored section 3, Purchasing & Finance) was accepted with blank charges;
-- only screen 3 (stored section 6) refused them.
-- Rule: a blank charge (no amount) blocks BOTH screen 2 and screen 3 submissions. Fill it or remove it.
-- A charge's file is still checked only at screen 3. Documents and bank details stay optional here;
-- screen 2 still needs proof on every payment (existing rule, run sheet 6.8).
-- Safe to run at any time: create or replace of a trigger function.

create or replace function public._ipas_signoff_charges_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_blank integer;
  v_nofile integer;
begin
  if new.section in (3, 6) and new.role = 'prepared' then
    select count(*) filter (where amount_php is null),
           count(*) filter (where amount_php is not null and attachment_url is null)
      into v_blank, v_nofile
      from public.ipas_charges where ipas_id = new.ipas_id;
    if v_blank > 0 then
      raise exception 'ipas_sign: % charge(s) are blank. Fill each in or remove it first', v_blank
        using errcode = '22023';
    end if;
    if new.section = 6 and v_nofile > 0 then
      raise exception 'ipas_sign: % charge(s) with an amount have no file', v_nofile
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._ipas_signoff_charges_guard() from public, anon, authenticated;
