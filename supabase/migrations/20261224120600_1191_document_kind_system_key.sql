-- 1191 follow-up (spec #1187): the P.I and the Quotation document kinds are known by a fixed
-- key, not by their label.
--
-- src/utils/ipasStatusSuggestion.js found them by label regex, so renaming a kind in Purchasing
-- Settings silently broke the "suggest Payment Approval" fact. ipas_options.system_key is a fixed
-- key the app reads; a rename no longer touches it. Mirrors sale_types.system_key (856).
--
--   'proforma_invoice'  the P.I an Import order is paid against
--   'quotation'         the Quotation a Local order is paid against
--
-- Only document kinds carry a key, and only a migration or the service role sets one: the settings
-- screen's writes (Purchasing access, Super Admins) can neither add nor change it.
-- The label is read once here, to place the keys, and never again. Nothing is deleted.

alter table public.ipas_options add column if not exists system_key text;

alter table public.ipas_options drop constraint if exists ipas_options_system_key_list_chk;
alter table public.ipas_options
  add constraint ipas_options_system_key_list_chk
  check (system_key is null or list = 'document_kind');

create unique index if not exists ipas_options_system_key_key
  on public.ipas_options (system_key)
  where system_key is not null;

-- Place each key on one row: the oldest active row the old label rule matched (else the oldest
-- matching row). Rows past the first stay null.
update public.ipas_options o
   set system_key = 'proforma_invoice'
 where o.id = (
         select m.id from public.ipas_options m
          where m.list = 'document_kind'
            and btrim(m.label) ~* '(proforma|^p\.?i(\s|$))'
          order by m.active desc, m.created_at, m.id
          limit 1
       )
   and not exists (select 1 from public.ipas_options where system_key = 'proforma_invoice');

update public.ipas_options o
   set system_key = 'quotation'
 where o.id = (
         select m.id from public.ipas_options m
          where m.list = 'document_kind'
            and m.label ~* 'quotation'
            and m.system_key is null
          order by m.active desc, m.created_at, m.id
          limit 1
       )
   and not exists (select 1 from public.ipas_options where system_key = 'quotation');

create or replace function public.ipas_options_system_key_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and (
       (tg_op = 'INSERT' and new.system_key is not null)
       or (tg_op = 'UPDATE' and new.system_key is distinct from old.system_key)
     ) then
    raise exception 'ipas_options: the system key is fixed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_options_system_key_guard on public.ipas_options;
create trigger ipas_options_system_key_guard
  before insert or update on public.ipas_options
  for each row execute function public.ipas_options_system_key_guard();
