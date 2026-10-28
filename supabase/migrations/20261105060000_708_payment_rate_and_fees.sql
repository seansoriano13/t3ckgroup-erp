-- #708 (spec #699): a payment is its amount x the forex rate paid, plus fees.
--
-- ipas_payments gains
--   forex_rate      pesos per unit of the PO's currency actually paid (null on a PHP PO)
--   doc_stamp_php   documentary stamp, PHP
--   misc_fee_php    any other fee, PHP
-- charge_fee_php stays what it was and now holds ALL the fees (bank charge + doc stamp + misc), so
-- Landed Cost, the printed form and the summaries keep reading one column. The bank charge shown on
-- screen is charge_fee_php - doc_stamp_php - misc_fee_php.
-- php_debited stays for history and is what Landed Cost reads: the app writes amount x forex_rate there.
-- Old payments get their rate worked out from their pesos (php_debited / amount).
--
-- ipas_set_payment_money writes the three new columns of a payment (same access and open-IPAS rule as
-- the other payment functions). BDO joins the payment methods (editable in Settings > Purchasing).
--
-- SAFE TO RUN AT ANY TIME: new nullable/defaulted columns, one new function, one idempotent insert.

alter table public.ipas_payments
  add column if not exists forex_rate numeric(14, 6),
  add column if not exists doc_stamp_php numeric(14, 2) not null default 0,
  add column if not exists misc_fee_php numeric(14, 2) not null default 0;

alter table public.ipas_payments drop constraint if exists ipas_payments_money_chk;
alter table public.ipas_payments add constraint ipas_payments_money_chk check (
  (forex_rate is null or forex_rate > 0) and doc_stamp_php >= 0 and misc_fee_php >= 0
);

comment on column public.ipas_payments.forex_rate is
  'Pesos per unit of the PO currency this payment was paid at (#708). Backfilled from php_debited / amount.';
comment on column public.ipas_payments.charge_fee_php is
  'All fees on the payment in PHP: bank charge + doc_stamp_php + misc_fee_php (#708).';

update public.ipas_payments
   set forex_rate = round(php_debited / amount, 6)
 where forex_rate is null and php_debited is not null and amount > 0;

create or replace function public.ipas_set_payment_money(
  p_payment_id uuid,
  p_forex_rate numeric,
  p_doc_stamp_php numeric,
  p_misc_fee_php numeric
) returns public.ipas_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_money_writer('ipas_set_payment_money');
  v_ipas_id uuid;
  v_before public.ipas_payments;
  v_row public.ipas_payments;
  v_rate numeric := round(p_forex_rate, 6);
  v_stamp numeric := round(coalesce(p_doc_stamp_php, 0), 2);
  v_misc numeric := round(coalesce(p_misc_fee_php, 0), 2);
begin
  select ipas_id into v_ipas_id from public.ipas_payments where id = p_payment_id;
  if v_ipas_id is null then
    raise exception 'ipas_set_payment_money: payment % not found', p_payment_id using errcode = '22023';
  end if;
  perform public._ipas_lock_open('ipas_set_payment_money', v_ipas_id);
  select * into v_before from public.ipas_payments where id = p_payment_id for update;
  if v_rate is not null and v_rate <= 0 then
    raise exception 'ipas_set_payment_money: the forex rate must be more than zero' using errcode = '22023';
  end if;
  if v_stamp < 0 or v_misc < 0 then
    raise exception 'ipas_set_payment_money: a fee can''t be negative' using errcode = '22023';
  end if;
  if v_before.forex_rate is not distinct from v_rate
     and v_before.doc_stamp_php = v_stamp and v_before.misc_fee_php = v_misc then
    return v_before;
  end if;

  update public.ipas_payments
     set forex_rate = v_rate, doc_stamp_php = v_stamp, misc_fee_php = v_misc
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas_id, v_actor, 'payment_changed', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'changes', jsonb_build_object(
      'forex_rate', jsonb_build_object('from', v_before.forex_rate, 'to', v_rate),
      'doc_stamp_php', jsonb_build_object('from', v_before.doc_stamp_php, 'to', v_stamp),
      'misc_fee_php', jsonb_build_object('from', v_before.misc_fee_php, 'to', v_misc)
    )
  ));
  return v_row;
end;
$$;

revoke all on function public.ipas_set_payment_money(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.ipas_set_payment_money(uuid, numeric, numeric, numeric) to authenticated;

insert into public.ipas_options (list, label, sort)
select 'payment_method', 'BDO', 35
 where not exists (
   select 1 from public.ipas_options where list = 'payment_method' and lower(btrim(label)) = 'bdo'
 );
