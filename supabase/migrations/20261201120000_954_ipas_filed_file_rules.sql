-- #959 (spec #954) review fix: a filed IPAS is never changed or re-checked, so the file rules
-- it was filed under are frozen on the row.
--
--   ipas.file_rules_snapshot   jsonb, null while the IPAS is open (it follows the live settings).
--                              Written when the IPAS becomes filed:
--                              { "options": { "<document kind id>": required_before, ... },
--                                "proof_on_every_payment": bool, "file_on_every_charge": bool }
--                              Only kinds with a "Required before" are listed. Cleared on reopen.
-- Already-filed IPAS are backfilled from the current settings. Idempotent.

alter table public.ipas add column if not exists file_rules_snapshot jsonb;

comment on column public.ipas.file_rules_snapshot is
  '#959: the file rules (kinds'' required_before and the two switches) frozen when the IPAS was filed; null while open. Screens and the print read it instead of the live settings.';

create or replace function public._ipas_file_rules_now()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'options', coalesce(
      (select jsonb_object_agg(o.id::text, o.required_before)
         from public.ipas_options o
        where o.list = 'document_kind' and o.required_before is not null),
      '{}'::jsonb),
    'proof_on_every_payment', coalesce((select proof_on_every_payment from public.ipas_file_rules limit 1), true),
    'file_on_every_charge', coalesce((select file_on_every_charge from public.ipas_file_rules limit 1), true)
  );
$$;

revoke all on function public._ipas_file_rules_now() from public, anon, authenticated;

-- The filing step: ipas_sign sets state = 'filed'. A trigger writes the snapshot on that update,
-- so it holds for every way an IPAS becomes filed. Reopening clears it.
create or replace function public.ipas_file_rules_snapshot_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.state = 'filed' and old.state is distinct from 'filed' then
    new.file_rules_snapshot := public._ipas_file_rules_now();
  elsif new.state is distinct from 'filed' then
    new.file_rules_snapshot := null;
  end if;
  return new;
end;
$$;

revoke all on function public.ipas_file_rules_snapshot_guard() from public, anon, authenticated;

drop trigger if exists ipas_file_rules_snapshot on public.ipas;
create trigger ipas_file_rules_snapshot
  before update on public.ipas
  for each row execute function public.ipas_file_rules_snapshot_guard();

-- Backfill the IPAS already filed (the freeze trigger is switched off for this one statement).
alter table public.ipas disable trigger ipas_freeze;
alter table public.ipas disable trigger ipas_file_rules_snapshot;

update public.ipas
   set file_rules_snapshot = public._ipas_file_rules_now()
 where state = 'filed' and file_rules_snapshot is null;

alter table public.ipas enable trigger ipas_file_rules_snapshot;
alter table public.ipas enable trigger ipas_freeze;
