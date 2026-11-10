-- Costing Matrix, the printed matrix's sign-offs (#274, spec #266).
--
-- WHAT THIS ADDS
--   costing_signoffs.signature_version
--                       the signer's stored signature (employees.signature_path) as it was
--                       when they signed, so a later upload never rewrites an old print;
--                       null when they declined to apply it or have none. Set by costing_sign
--                       for every role.
--   costing_sign        now signs the other three roles as well (evaluation_approved is
--                       exactly as #271 built it):
--                         prepared        the matrix's Sales incharge
--                         costed          the matrix's Purchasing incharge
--                         final_approved  a member of the final_acquire list
--                       Each needs a read tier on the SOR, like the evaluation does.
--   Clearing triggers   a sign-off goes stale when the figures it vouched for change, and
--                       is cleared with a reason (the row stays as history):
--                         prepared        a Final Offer (or a Tender Line's quantity, which
--                                         moves the Final Offer total)
--                         costed          an Acquire, or a markup factor (the matrix default,
--                                         or a Component's or cost-only row's own)
--                         final_approved  a Final Acquire, or a Final Offer (or quantity)
--
-- ACCESS
--   costing_sign is granted to authenticated as before; the checks are inside it. The
--   clearing function is internal. No new table, no new band, no new tier.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: every statement is create-if-missing,
-- create-or-replace, drop-then-create or insert-on-conflict.

alter table public.costing_signoffs add column if not exists signature_version text;

comment on column public.costing_signoffs.signature_version is
  '#274: employees.signature_path as it was when the sign-off was made; null when the signer declined the signature or had none.';

-- Functions

-- Signs the matrix off for one role (ADR 0013: one function checks and writes).
--   prepared             the matrix's Sales incharge
--   costed               the matrix's Purchasing incharge
--   evaluation_approved  the evaluation list, every Component carrying a verdict (#271)
--   final_approved       the final_acquire list
-- Returns {signoff: <the new row>}.
create or replace function public.costing_sign(p_matrix_id uuid, p_role text, p_decline_signature boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := public.get_employee_id();
  v_opp       uuid;
  v_incharge  uuid;
  v_missing   integer;
  v_signature text;
  v_row       public.costing_signoffs;
begin
  if v_actor is null then
    raise exception 'costing_sign: sign in first' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('prepared', 'costed', 'evaluation_approved', 'final_approved') then
    raise exception 'costing_sign: % is not a sign-off', coalesce(p_role, 'that') using errcode = '22023';
  end if;

  v_opp := public.costing_matrix_opp(p_matrix_id);
  if v_opp is null then
    raise exception 'costing_sign: not found' using errcode = 'P0002';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_sign: not allowed' using errcode = '42501';
  end if;

  if p_role = 'evaluation_approved' then
    if not public.costing_on_list('evaluation') then
      raise exception 'costing_sign: only someone on the evaluation list can approve the evaluation' using errcode = '42501';
    end if;
  elsif p_role = 'prepared' then
    select m.sales_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Sales incharge can sign Prepared by' using errcode = '42501';
    end if;
  elsif p_role = 'costed' then
    select m.purchasing_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Purchasing incharge can sign Costed by' using errcode = '42501';
    end if;
  elsif not public.costing_on_list('final_acquire') then
    raise exception 'costing_sign: only someone on the Final Acquire list can approve the Final Acquire and offer' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_sign:' || p_matrix_id::text));

  if exists (
    select 1 from public.costing_signoffs s
    where s.matrix_id = p_matrix_id and s.role = p_role and s.cleared_at is null
  ) then
    if p_role = 'evaluation_approved' then
      raise exception 'costing_sign: the evaluation is already approved' using errcode = '55000';
    end if;
    raise exception 'costing_sign: that sign-off is already signed' using errcode = '55000';
  end if;

  if p_role = 'evaluation_approved' then
    select count(*) into v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    where l.matrix_id = p_matrix_id and c.compliance is null;
    if v_missing > 0 then
      raise exception 'costing_sign: % Component% no verdict yet',
        v_missing, case when v_missing = 1 then ' has' else 's have' end
        using errcode = '55000';
    end if;
  end if;

  if not coalesce(p_decline_signature, false) then
    select nullif(btrim(e.signature_path), '') into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.costing_signoffs (matrix_id, role, signed_by, signature_declined, signature_version)
  values (p_matrix_id, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  return jsonb_build_object('signoff', to_jsonb(v_row));
end;
$$;

-- A change to a figure a sign-off vouched for clears it. Trigger arguments: the roles to
-- clear (comma separated), the reason to record, then the column whose change counts
-- ('' = any insert, delete or update of the row).
create or replace function public.costing_clear_print_signoffs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roles  text[] := string_to_array(tg_argv[0], ',');
  v_reason text := tg_argv[1];
  v_column text := coalesce(tg_argv[2], '');
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_matrix uuid;
begin
  if v_column <> '' then
    if tg_op = 'INSERT' and coalesce(v_new -> v_column, 'null'::jsonb) = 'null'::jsonb then
      return null;
    elsif tg_op = 'DELETE' and coalesce(v_old -> v_column, 'null'::jsonb) = 'null'::jsonb then
      return null;
    elsif tg_op = 'UPDATE' and (v_new -> v_column) is not distinct from (v_old -> v_column) then
      return null;
    end if;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, coalesce(v_new, v_old));
  -- The matrix is going (an SOR cascade): nothing left to clear.
  if v_matrix is null or not exists (select 1 from public.costing_matrices where id = v_matrix) then
    return null;
  end if;

  perform public.costing_clear_signoffs(v_matrix, v_roles, v_reason);
  return null;
end;
$$;

revoke all on function public.costing_clear_print_signoffs() from public, anon, authenticated;
revoke all on function public.costing_sign(uuid, text, boolean) from public, anon;
grant execute on function public.costing_sign(uuid, text, boolean) to authenticated;

-- Prepared by and Final Acquire and offer approved: the Final Offer.
drop trigger if exists costing_print_clear_offer on public.costing_tender_line_prices;
create trigger costing_print_clear_offer after insert or update or delete on public.costing_tender_line_prices
  for each row execute function public.costing_clear_print_signoffs('prepared,final_approved', 'The Final Offer changed', 'final_offer_unit');

drop trigger if exists costing_print_clear_quantity on public.costing_tender_lines;
create trigger costing_print_clear_quantity after update on public.costing_tender_lines
  for each row execute function public.costing_clear_print_signoffs('prepared,final_approved', 'The Final Offer changed', 'quantity');

-- Costed by: an Acquire or a markup factor.
drop trigger if exists costing_print_clear_acquire on public.costing_component_costs;
create trigger costing_print_clear_acquire after insert or update or delete on public.costing_component_costs
  for each row execute function public.costing_clear_print_signoffs('costed', 'An Acquire changed', 'acquire_unit');

drop trigger if exists costing_print_clear_factor on public.costing_component_costs;
create trigger costing_print_clear_factor after insert or update or delete on public.costing_component_costs
  for each row execute function public.costing_clear_print_signoffs('costed', 'A markup factor changed', 'markup_factor');

drop trigger if exists costing_print_clear_acquire on public.costing_cost_rows;
create trigger costing_print_clear_acquire after insert or update or delete on public.costing_cost_rows
  for each row execute function public.costing_clear_print_signoffs('costed', 'An Acquire changed', 'acquire_unit');

drop trigger if exists costing_print_clear_factor on public.costing_cost_rows;
create trigger costing_print_clear_factor after insert or update or delete on public.costing_cost_rows
  for each row execute function public.costing_clear_print_signoffs('costed', 'A markup factor changed', 'markup_factor');

drop trigger if exists costing_print_clear_default_factor on public.costing_matrix_money;
create trigger costing_print_clear_default_factor after update on public.costing_matrix_money
  for each row execute function public.costing_clear_print_signoffs('costed', 'A markup factor changed', 'default_factor');

-- Final Acquire and offer approved: a Final Acquire.
drop trigger if exists costing_print_clear_final_acquire on public.costing_component_costs;
create trigger costing_print_clear_final_acquire after insert or update or delete on public.costing_component_costs
  for each row execute function public.costing_clear_print_signoffs('final_approved', 'A Final Acquire changed', 'final_acquire_unit');

drop trigger if exists costing_print_clear_final_acquire on public.costing_cost_rows;
create trigger costing_print_clear_final_acquire after insert or update or delete on public.costing_cost_rows
  for each row execute function public.costing_clear_print_signoffs('final_approved', 'A Final Acquire changed', 'final_acquire_unit');

-- ---------------------------------------------------------------------------
-- Registry rows
-- ---------------------------------------------------------------------------

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_signoffs', 'signature_version', '{participant,price,cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;
