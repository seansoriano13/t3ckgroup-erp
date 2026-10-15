-- ==============================================================================
-- 20261015130000_ipas_transmittal_reads.sql
--
-- Issue #256 (IPAS reads Transmittals: section 5, Delivered and Actual
-- Checking, spec #251). Builds on 20261015100000 (#252) to 20261015120000 (#254).
--
-- WHAT IT ADDS
-- - ipas: a trigger refusing a hand stamp of Actual Checking (actual_checking_by
--   or _at set) once a submitted, uncancelled Transmittal carries a PO line of
--   that IPAS. Clearing the stamp is still allowed. With no such slip, the hand
--   stamp works as before (#246).
--
-- Reads (Section 5 list, Item Location, Delivered and Actual Checking) are
-- derived in the app from the slips (utils/ipasTransmittals.js). Nothing here
-- writes the v1 columns delivered_on, actual_checking_by/at or item_location_id.
--
-- SAFE TO RUN AT ANY TIME: a trigger function replaced in place. Idempotent.
-- ==============================================================================

create or replace function public.ipas_actual_checking_hand_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.actual_checking_by is not null
     and (new.actual_checking_by is distinct from old.actual_checking_by
          or new.actual_checking_at is distinct from old.actual_checking_at)
     and exists (
       select 1
         from public.transmittal_lines l
         join public.transmittals t on t.id = l.transmittal_id
        where l.ipas_id = new.id
          and t.state not in ('draft', 'cancelled')
     ) then
    raise exception 'Actual Checking is stamped by the Transmittals once one is submitted for this IPAS'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.ipas_actual_checking_hand_guard() is
  '#256: refuses a hand stamp of Actual Checking on an IPAS that a submitted, uncancelled Transmittal carries a line of. Clearing is allowed.';

drop trigger if exists ipas_actual_checking_hand_guard on public.ipas;
create trigger ipas_actual_checking_hand_guard
  before update on public.ipas
  for each row
  execute function public.ipas_actual_checking_hand_guard();
