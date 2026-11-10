-- #728 (spec #718, ADR 0047): a Canvass is no longer signed off.
--
--   canvass_sign                    re-created to refuse every caller (42501). Kept, not dropped, so
--                                   an old client gets a clear answer instead of "function not found".
--   canvass_pending_signoffs        dropped (the Approval Center queue)
--   canvass_signoff_audience        dropped (the "ready to sign" notice)
--   canvass_is_ready                dropped (only the two above used it)
--   canvass_clear_signoff and the   dropped: with no new signing, an edit must not unsign an old
--   canvass_clear_on_* triggers     Canvass or write a "cleared" row. Old sign-offs are read-only history.
--   sor_canvasses_guard_signoff     re-created: a client can no longer write signed_off_by /
--                                   signed_off_at at all. The service role and migrations still can
--                                   (maintenance, seeding old history in tests); the app never does.
--
-- Kept as they are, read-only: sor_canvasses.signed_off_by / signed_off_at and the
-- sor_canvass_signoff_events table (append-only). Old signed Canvasses still say who signed and when.
--
-- canvass_clear_winner is re-created without the sign-off steps (it unsigned a signed Canvass and wrote a
-- "cleared" row; neither happens now).
--
-- SAFE TO RUN AT ANY TIME: idempotent.

drop trigger if exists trg_canvass_clear_on_offer_change on public.sor_canvass_offers;
drop trigger if exists trg_canvass_clear_on_price_change on public.sor_canvass_offer_prices;
drop trigger if exists trg_canvass_clear_on_reason_change on public.sor_canvasses;

drop function if exists public.canvass_clear_on_offer_change();
drop function if exists public.canvass_clear_on_price_change();
drop function if exists public.canvass_clear_on_reason_change();
drop function if exists public.canvass_clear_signoff(uuid, text);
drop function if exists public.canvass_pending_signoffs();
drop function if exists public.canvass_signoff_audience(uuid);
drop function if exists public.canvass_is_ready(uuid);

create or replace function public.canvass_sign(p_canvass_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'canvass_sign: a Canvass is no longer signed off' using errcode = '42501';
end
$$;

revoke all on function public.canvass_sign(uuid) from public, anon;
grant execute on function public.canvass_sign(uuid) to authenticated;

create or replace function public.sor_canvasses_guard_signoff()
returns trigger
language plpgsql
as $$
begin
  -- current_user tells a person at a client apart from the service role and migrations.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.signed_off_by is not null or new.signed_off_at is not null then
      raise exception 'A Canvass is no longer signed off.' using errcode = '42501';
    end if;
  elsif new.signed_off_by is distinct from old.signed_off_by
     or new.signed_off_at is distinct from old.signed_off_at then
    raise exception 'A Canvass is no longer signed off.' using errcode = '42501';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- canvass_clear_winner: no sign-off to clear, no history row written
-- ---------------------------------------------------------------------------

-- Re-created from 20261024110000_561_review_fixes.sql without the sign-off steps (it unsigned a
-- signed Canvass and always wrote a "cleared" row). Un-picking only un-picks now; an old signed
-- Canvass keeps its read-only sign-off.
create or replace function public.canvass_clear_winner(p_canvass_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared integer;
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_clear_winner: sign in first' using errcode = '42501';
  end if;

  -- The same lock canvass_apply_winner takes, so a pick and an un-pick never interleave.
  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  if not exists (select 1 from public.sor_canvasses where id = p_canvass_id) then
    raise exception 'canvass_clear_winner: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_clear_winner: not allowed' using errcode = '42501';
  end if;

  -- The Costing Matrix keeps what the winner filled, marked, until canvass_apply_winner replaces it.
  update public.sor_canvass_offers set is_winner = false
   where canvass_id = p_canvass_id and is_winner;
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('canvass_id', p_canvass_id, 'cleared', v_cleared > 0);
end;
$$;

revoke all on function public.canvass_clear_winner(uuid) from public, anon;
grant execute on function public.canvass_clear_winner(uuid) to authenticated;
