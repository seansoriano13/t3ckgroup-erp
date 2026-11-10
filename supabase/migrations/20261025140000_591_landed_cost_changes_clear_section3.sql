-- #591 (spec #584): Landed Cost changes clear IPAS section 3; Return and Undo work on it.
--
-- Section 3 (stored 6) vouches only for the Landed Cost that was checked. The database
-- clears its live Submitted and Approved (kept as history, reason recorded) when that
-- Landed Cost changes: a payment or charge added, changed or removed, the spread
-- changed, an Odoo refresh that changes the PO lines or total, or the status moving
-- below LC Odoo Done. The people who signed are told. Payments and charges still never
-- clear sections 1 or 2.
--
-- How: every Submitted/Approved row of section 6 records a fingerprint of the Landed
-- Cost it was given on (per-line and total money). Row triggers on payments, charges
-- and the IPAS call one helper that clears when the fingerprint no longer matches. A
-- payment proof upload or a document tick changes no money, so nothing clears.
-- Triggers (not rewritten RPCs) keep #586's ipas_set_header and the payment, charge and
-- Odoo functions untouched.
--
-- Also: Return (ipas_send_back) and Undo approval (ipas_undo_approval) accept section 6,
-- with the same section 4 consequence as sections 1 and 2.
--
-- SAFE TO RUN AT ANY TIME ONCE 586 AND 590 HAVE RUN. Idempotent.

alter table public.ipas_signoffs add column if not exists lc_fingerprint text;
comment on column public.ipas_signoffs.lc_fingerprint is
  'Section 6 only: a fingerprint of the Landed Cost this sign-off vouched for (#591). A change to it clears the sign-off.';

-- The Landed Cost reduced to what an approver checks: each line's goods, spread and
-- landed money, and the totals. Rounded so the same money always gives the same text.
create or replace function public._ipas_lc_fingerprint(p_ipas_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select md5(
    coalesce((
      select string_agg(
               concat_ws('|',
                 coalesce(e.l ->> 'lineId', ''),
                 round(coalesce((e.l ->> 'quantity')::numeric, 0), 4)::text,
                 round(coalesce((e.l ->> 'goodsPhp')::numeric, 0), 2)::text,
                 round(coalesce((e.l ->> 'spreadPhp')::numeric, 0), 2)::text,
                 round(coalesce((e.l ->> 'landedPhp')::numeric, 0), 2)::text),
               ';' order by e.ord)
        from jsonb_array_elements(coalesce(x.lc -> 'lines', '[]'::jsonb)) with ordinality as e(l, ord)
    ), '')
    || '#' ||
    case
      when jsonb_typeof(x.lc -> 'totals') = 'object' then
        concat_ws('|',
          round(coalesce((x.lc #>> '{totals,goodsPhp}')::numeric, 0), 2)::text,
          round(coalesce((x.lc #>> '{totals,spreadPhp}')::numeric, 0), 2)::text,
          round(coalesce((x.lc #>> '{totals,landedPhp}')::numeric, 0), 2)::text)
      else 'none'
    end
  )
  from (select public._ipas_landed_cost(p_ipas_id) as lc) x;
$$;

revoke all on function public._ipas_lc_fingerprint(uuid) from public, anon, authenticated;

-- Records the fingerprint on a new section 6 Submitted or Approved.
create or replace function public.ipas_signoffs_lc_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.section = 6 and new.role in ('prepared', 'approved') and new.lc_fingerprint is null then
    new.lc_fingerprint := public._ipas_lc_fingerprint(new.ipas_id);
  end if;
  return new;
end;
$$;

revoke all on function public.ipas_signoffs_lc_fingerprint() from public, anon, authenticated;

drop trigger if exists ipas_signoffs_lc_fingerprint on public.ipas_signoffs;
create trigger ipas_signoffs_lc_fingerprint
  before insert on public.ipas_signoffs
  for each row execute function public.ipas_signoffs_lc_fingerprint();

-- Clears section 3's live Submitted and Approved when the Landed Cost moved from what they
-- vouched for (or always, with p_force). Writes one approvals_cleared event and tells the
-- people who signed (never the person who made the change).
create or replace function public._ipas_clear_section_3_for_lc(
  p_ipas_id uuid,
  p_reason text,
  p_force boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ipas public.ipas;
  v_actor uuid := public.get_employee_id();
  v_fingerprint text;
  v_notify uuid[];
begin
  select * into v_ipas from public.ipas where id = p_ipas_id;
  if not found or v_ipas.state <> 'open' then
    return;
  end if;
  if not exists (
    select 1 from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id and s.section = 6 and s.role in ('prepared', 'approved') and s.cleared_at is null
  ) then
    return;
  end if;

  if not p_force then
    v_fingerprint := public._ipas_lc_fingerprint(p_ipas_id);
    if not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = p_ipas_id and s.section = 6 and s.role in ('prepared', 'approved') and s.cleared_at is null
         and s.lc_fingerprint is distinct from v_fingerprint
    ) then
      return;
    end if;
  end if;

  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor, cleared_reason = p_reason
     where s.ipas_id = p_ipas_id
       and s.section = 6
       and s.role in ('prepared', 'approved')
       and s.cleared_at is null
    returning s.signed_by
  )
  select coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
    into v_notify
    from cleared;

  perform public._ipas_write_event(p_ipas_id, v_actor, 'approvals_cleared', jsonb_build_object(
    'reason', p_reason,
    'sections', jsonb_build_array(6)
  ));

  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select n, v_actor, 'IPAS_SECTION_3_CLEARED',
         'IPAS section ' || public._ipas_section_no(6) || ' cleared',
         format('Section %s of IPAS %s was cleared (%s). It needs to be submitted and approved again.',
                public._ipas_section_no(6), v_ipas.number, p_reason),
         p_ipas_id::text
    from unnest(v_notify) as n;
end;
$$;

revoke all on function public._ipas_clear_section_3_for_lc(uuid, text, boolean) from public, anon, authenticated;

-- Payments and charges: any row change asks the helper to compare the money.
create or replace function public.ipas_lc_money_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_what text := case when tg_table_name = 'ipas_payments' then 'Payment' else 'Charge' end;
  v_verb text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
begin
  perform public._ipas_clear_section_3_for_lc(
    case when tg_op = 'DELETE' then old.ipas_id else new.ipas_id end,
    v_what || ' ' || v_verb
  );
  return null;
end;
$$;

revoke all on function public.ipas_lc_money_changed() from public, anon, authenticated;

drop trigger if exists ipas_payments_lc_clear on public.ipas_payments;
create trigger ipas_payments_lc_clear
  after insert or update or delete on public.ipas_payments
  for each row execute function public.ipas_lc_money_changed();

drop trigger if exists ipas_charges_lc_clear on public.ipas_charges;
create trigger ipas_charges_lc_clear
  after insert or update or delete on public.ipas_charges
  for each row execute function public.ipas_lc_money_changed();

-- The IPAS itself: the status below LC Odoo Done always clears; an Odoo refresh or a
-- spread change clears when the Landed Cost really moved. The Odoo reason is the one
-- ipas_assert_unchanged (#585) already ignores, so a refresh never looks like "someone
-- else saved".
create or replace function public.ipas_lc_header_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.computation_status is distinct from old.computation_status
     and new.computation_status in ('encoding', 'encoded', 'lc_gs_done') then
    perform public._ipas_clear_section_3_for_lc(new.id, 'Status moved below LC Odoo Done', true);
  elsif new.odoo_copy is distinct from old.odoo_copy then
    perform public._ipas_clear_section_3_for_lc(new.id, 'PO changed in Odoo');
  elsif new.landed_cost_split is distinct from old.landed_cost_split then
    perform public._ipas_clear_section_3_for_lc(new.id, 'Spread changed');
  end if;
  return null;
end;
$$;

revoke all on function public.ipas_lc_header_changed() from public, anon, authenticated;

drop trigger if exists ipas_lc_clear on public.ipas;
create trigger ipas_lc_clear
  after update of landed_cost_split, computation_status, odoo_copy on public.ipas
  for each row execute function public.ipas_lc_header_changed();

-- Section 3 sign-offs given before this migration vouch for the Landed Cost as it is now.
update public.ipas_signoffs s
   set lc_fingerprint = public._ipas_lc_fingerprint(s.ipas_id)
 where s.section = 6 and s.role in ('prepared', 'approved') and s.cleared_at is null and s.lc_fingerprint is null;

-- ipas_send_back (latest: 20261025130000_590_filing_waits_for_section3.sql). #591 CHANGES
-- ONLY: section 6 can be returned, and the section 4 cascade reason names the screen number.
create or replace function public.ipas_send_back(
  p_ipas_id uuid,
  p_section integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_roles text[];
  v_preparers uuid[];
  v_notify uuid[];
  v_cascade text[] := '{}'::text[];
  v_cascade_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_send_back: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_send_back: give a reason, so the people who signed know what to fix' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_send_back: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3, 6, 7) then
    raise exception 'ipas_send_back: only sections 1, 2, 3 and 4 can be returned' using errcode = '22023';
  end if;

  -- Refuses a filed or cancelled IPAS (55000): a filed one is reopened, not returned.
  v_ipas := public._ipas_lock_open('ipas_send_back', p_ipas_id);

  if p_section = 7 then
    -- Anyone on a section 7 list, whichever sign-off they give.
    if not public._ipas_can_sign_section(7, v_actor) then
      raise exception 'ipas_send_back: only a signer of section % returns it', public._ipas_section_no(7) using errcode = '42501';
    end if;

    -- Section 7 is open once sections 1, 2 and 3 are approved (#590: the Filing gate
    -- now includes section 3, stored 6).
    if not public._ipas_filing_open(v_ipas.id) then
      raise exception 'ipas_send_back: section % isn''t open yet; sections %, % and % must be approved first', public._ipas_section_no(7), public._ipas_section_no(1), public._ipas_section_no(3), public._ipas_section_no(6) using errcode = '22023';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Returned: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = 7
         and s.role in ('received', 'noted', 'checked')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
      into v_roles, v_notify
      from cleared;

    v_preparers := '{}'::uuid[];
  else
    if not public._ipas_can_sign_section(p_section, v_actor) then
      raise exception 'ipas_send_back: only a signer of section % returns it', public._ipas_section_no(p_section) using errcode = '42501';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Returned: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = p_section
         and s.role in ('prepared', 'approved')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where role = 'prepared'), '{}'::uuid[])
      into v_roles, v_preparers
      from cleared;

    v_notify := v_preparers;

    -- Section 4 no longer has two approved sections behind it: its open sign-offs go too.
    if cardinality(v_roles) > 0 then
      with cleared as (
        update public.ipas_signoffs s
           set cleared_at = now(), cleared_by = v_actor,
               cleared_reason = 'Section ' || public._ipas_section_no(p_section) || ' returned: ' || v_reason
         where s.ipas_id = v_ipas.id
           and s.section = 7
           and s.role in ('received', 'noted', 'checked')
           and s.cleared_at is null
        returning s.role, s.signed_by
      )
      select coalesce(array_agg(role order by role), '{}'::text[]),
             coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
        into v_cascade, v_cascade_ids
        from cleared;
      v_notify := (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_notify || v_cascade_ids) as x);
    end if;
  end if;

  if cardinality(v_roles) = 0 then
    raise exception 'ipas_send_back: section % has nothing to return', public._ipas_section_no(p_section) using errcode = '22023';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'sent_back', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'cleared', to_jsonb(v_roles),
    'cleared_section_7', to_jsonb(v_cascade)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'cleared_roles', to_jsonb(v_roles),
    'cleared_section_7', to_jsonb(v_cascade),
    'preparer_ids', to_jsonb(v_preparers),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;
-- ipas_undo_approval (latest: 20261023210000_refusal_codes.sql). #591 CHANGES ONLY: section 6 can be undone, and the cascade reason names the screen number.
create or replace function public.ipas_undo_approval(
  p_ipas_id uuid,
  p_section integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_approver uuid;
  v_cascade text[] := '{}'::text[];
  v_cascade_ids uuid[] := '{}'::uuid[];
  v_notify uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_undo_approval: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_undo_approval: give a reason, so the approver knows why' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_undo_approval: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3, 6) then
    raise exception 'ipas_undo_approval: only sections 1, 2 and 3 have an approval to undo' using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_undo_approval', p_ipas_id);

  if not public._ipas_can_sign_section(p_section, v_actor) then
    raise exception 'ipas_undo_approval: only a signer of section % undoes its approval', public._ipas_section_no(p_section) using errcode = '42501';
  end if;

  update public.ipas_signoffs s
     set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Approval undone: ' || v_reason
   where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'approved' and s.cleared_at is null
  returning s.signed_by into v_approver;

  if not found then
    raise exception 'ipas_undo_approval: section % has no approval to undo', public._ipas_section_no(p_section) using errcode = '22023';
  end if;

  -- Section 4 stood on both approvals: its open sign-offs go too.
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor,
           cleared_reason = 'Section ' || public._ipas_section_no(p_section) || ' approval undone: ' || v_reason
     where s.ipas_id = v_ipas.id
       and s.section = 7
       and s.role in ('received', 'noted', 'checked')
       and s.cleared_at is null
    returning s.role, s.signed_by
  )
  select coalesce(array_agg(role order by role), '{}'::text[]),
         coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
    into v_cascade, v_cascade_ids
    from cleared;

  v_notify := v_cascade_ids;
  if v_approver is not null and v_approver is distinct from v_actor then
    v_notify := v_notify || v_approver;
  end if;
  v_notify := (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_notify) as x);

  perform public._ipas_write_event(v_ipas.id, v_actor, 'approval_undone', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'approver_id', v_approver,
    'cleared_section_7', to_jsonb(v_cascade)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'approver_id', v_approver,
    'cleared_section_7', to_jsonb(v_cascade),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;
