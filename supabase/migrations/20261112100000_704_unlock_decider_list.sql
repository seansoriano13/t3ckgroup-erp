-- Review fix for #704 (spec #699): only the decider's list (the Final Acquire list, who take the Go)
-- and Super Admins can unlock a Go. Sales and Purchasing, who only reach the Closed Book through the
-- open-to-deal rule, can no longer unlock it. Same function as 20261108040000_704_go_locks_matrix.sql
-- with the one check changed.
--
-- SAFE TO RUN AT ANY TIME: function replacement only.

create or replace function public.costing_unlock_bid(p_matrix_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_opp   uuid := public.costing_matrix_opp(p_matrix_id);
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'costing_bid: sign in first' using errcode = '42501';
  end if;
  if v_opp is null then
    raise exception 'costing_bid: matrix not found' using errcode = '22023';
  end if;
  if not (coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire')) then
    raise exception 'costing_bid: only a Super Admin or the people on the decider''s list can unlock a bid' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'costing_bid: write the reason for unlocking' using errcode = '22023';
  end if;

  perform 1 from public.costing_matrices where id = p_matrix_id for update;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = 'Unlocked: ' || btrim(p_reason), unlocked_by = v_actor
   where matrix_id = p_matrix_id and cleared_at is null and verdict = 'go'
  returning id into v_id;
  if v_id is null then
    raise exception 'costing_bid: there is no Go to unlock' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

revoke all on function public.costing_unlock_bid(uuid, text) from public, anon;
grant execute on function public.costing_unlock_bid(uuid, text) to authenticated;
