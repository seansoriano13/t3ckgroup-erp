-- 20261226130000_1211_payment_rows_others_and_proof_files.sql
-- #1211 (spec #1205): payment rows.
--
--   * The payment method "Others" is in the list (seeded when missing). Picking it needs a typed method,
--     stored on the payment as method_other and shown instead of the word "Others".
--   * A payment's proof is a list of files: ipas_payment_files, the same shape as ipas_document_files (#1153).
--     Every existing single proof_url moves in as that payment's first file. ipas_payments.proof_url stays,
--     kept equal to the first file, so everything that only asks "has proof" keeps working.
--   * ipas_save_payment takes p_method_other and p_proof_urls (the whole list of files; null keeps the old
--     single p_proof_url reading).
--   * "Required before" (_ipas_missing_documents) counts a payment's proof as met by at least one file.
-- The 1st / 2nd / 3rd numbers are worked out on screen from the payment date, then the creation order.
-- They are never stored.

-- ---------------------------------------------------------------------------
-- "Others" in the method list
-- ---------------------------------------------------------------------------
insert into public.ipas_options (list, label, sort)
select 'payment_method', 'Others', 110
 where not exists (
   select 1 from public.ipas_options x
    where x.list = 'payment_method' and lower(btrim(x.label)) in ('others', 'other')
 );

-- ---------------------------------------------------------------------------
-- The typed method
-- ---------------------------------------------------------------------------
alter table public.ipas_payments add column if not exists method_other text;

alter table public.ipas_payments drop constraint if exists ipas_payments_method_other_chk;
alter table public.ipas_payments add constraint ipas_payments_method_other_chk
  check (method_other is null or (btrim(method_other) <> '' and char_length(method_other) <= 100));

comment on column public.ipas_payments.method_other is
  '#1211: what the method was, typed when the method is Others. Shown instead of the word "Others". Null for every other method.';

-- ---------------------------------------------------------------------------
-- The proof files
-- ---------------------------------------------------------------------------
create table if not exists public.ipas_payment_files (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.ipas_payments(id) on delete cascade,
  url text not null,
  file_name text not null,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  constraint ipas_payment_files_url_chk check (url ~* '^https?://'),
  constraint ipas_payment_files_name_chk check (btrim(file_name) <> '' and char_length(file_name) <= 200)
);

comment on table public.ipas_payment_files is
  '#1211: the proof-of-payment files of a payment, any number. Written only through ipas_save_payment.';

create index if not exists ipas_payment_files_payment_id_idx on public.ipas_payment_files (payment_id);
create index if not exists ipas_payment_files_created_by_idx on public.ipas_payment_files (created_by);

alter table public.ipas_payment_files enable row level security;

drop policy if exists ipas_payment_files_read on public.ipas_payment_files;
create policy ipas_payment_files_read on public.ipas_payment_files
  for select to authenticated
  using ((select public.ipas_can_read()));

revoke insert, update, delete, truncate on public.ipas_payment_files from anon, authenticated;

-- Same own-file-store link check as the other link columns (#1128).
drop trigger if exists ipas_payment_files_file_link on public.ipas_payment_files;
create trigger ipas_payment_files_file_link
  before insert or update of url on public.ipas_payment_files
  for each row execute function public.ipas_file_link_guard('url');

-- Move what is there: each proof_url becomes the payment's first file.
insert into public.ipas_payment_files (payment_id, url, file_name, created_by, created_at)
select p.id, btrim(p.proof_url), public._ipas_file_name_from_url(btrim(p.proof_url)), p.created_by, p.created_at
  from public.ipas_payments p
 where p.proof_url is not null
   and btrim(p.proof_url) <> ''
   and not exists (select 1 from public.ipas_payment_files f where f.payment_id = p.id);

-- ---------------------------------------------------------------------------
-- ipas_save_payment: the typed method and the list of proof files
-- ---------------------------------------------------------------------------
drop function if exists public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric);

create or replace function public.ipas_save_payment(
  p_ipas_id uuid,
  p_payment_id uuid,
  p_kind text,
  p_paid_on date,
  p_amount numeric,
  p_forex_rate numeric,
  p_doc_stamp_php numeric,
  p_misc_fee_php numeric,
  p_charge_fee_php numeric,
  p_method_id uuid,
  p_check_no text,
  p_proof_url text,
  p_percent_of_order numeric default null,
  p_method_other text default null,
  p_proof_urls text[] default null
) returns public.ipas_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ipas public.ipas;
  v_php boolean;
  v_rate numeric := round(p_forex_rate, 6);
  v_pesos numeric;
  v_row public.ipas_payments;
  v_label text;
  v_other text := nullif(btrim(p_method_other), '');
  v_urls text[];
  v_url text;
begin
  perform public._ipas_check_date('ipas_save_payment', p_paid_on, 'the payment date');
  if p_payment_id is null then
    v_ipas := public._ipas_lock_open('ipas_save_payment', p_ipas_id);
  else
    select i.* into v_ipas
      from public.ipas i join public.ipas_payments p on p.ipas_id = i.id
     where p.id = p_payment_id;
    if v_ipas.id is null then
      raise exception 'ipas_save_payment: payment % not found', p_payment_id using errcode = '22023';
    end if;
  end if;
  v_php := upper(btrim(coalesce(v_ipas.odoo_copy #>> '{po,currency}', ''))) = 'PHP';
  if v_php then
    v_rate := null;
  elsif v_rate is not null and v_rate <= 0 then
    raise exception 'ipas_save_payment: the forex rate must be more than zero' using errcode = '22023';
  end if;
  v_pesos := case when v_rate is null then null else round(p_amount * v_rate, 2) end;

  -- The method: Others needs what it was; any other method keeps no typed text.
  select lower(btrim(label)) into v_label from public.ipas_options where id = p_method_id;
  if v_label in ('others', 'other') then
    if v_other is null then
      raise exception 'ipas_save_payment: type the payment method when it is Others' using errcode = '22023';
    end if;
    if char_length(v_other) > 100 then
      raise exception 'ipas_save_payment: the payment method can be at most 100 characters' using errcode = '22023';
    end if;
  else
    v_other := null;
  end if;

  -- The proof files: the whole list, or the one p_proof_url when no list is sent. No duplicates, no blanks.
  select coalesce(array_agg(s.u order by s.first_at), '{}'::text[])
    into v_urls
    from (
      select btrim(x.u) as u, min(x.n) as first_at
        from unnest(coalesce(p_proof_urls, case when nullif(btrim(p_proof_url), '') is null then '{}'::text[] else array[p_proof_url] end))
             with ordinality as x(u, n)
       where nullif(btrim(x.u), '') is not null
       group by btrim(x.u)
    ) s;

  -- One transaction: if any step refuses, nothing is kept.
  if p_payment_id is null then
    v_row := public.ipas_add_payment(v_ipas.id, p_kind, p_paid_on, p_amount, v_pesos, p_charge_fee_php,
                                     p_method_id, p_check_no, v_urls[1], p_percent_of_order);
  else
    v_row := public.ipas_update_payment(p_payment_id, p_kind, p_paid_on, p_amount, v_pesos, p_charge_fee_php,
                                        p_method_id, p_check_no, v_urls[1], p_percent_of_order);
  end if;

  -- Files that left the list go; new ones come in.
  delete from public.ipas_payment_files where payment_id = v_row.id and not (url = any (v_urls));
  foreach v_url in array v_urls loop
    if v_url !~* '^https?://' then
      raise exception 'ipas_save_payment: the proof must be a link to the uploaded file' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ipas_payment_files where payment_id = v_row.id and url = v_url) then
      insert into public.ipas_payment_files (payment_id, url, file_name, created_by)
      values (v_row.id, v_url, public._ipas_file_name_from_url(v_url), auth.uid());
    end if;
  end loop;

  update public.ipas_payments set method_other = v_other where id = v_row.id and method_other is distinct from v_other;

  return public.ipas_set_payment_money(v_row.id, v_rate, p_doc_stamp_php, p_misc_fee_php);
end;
$$;

revoke all on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric, text, text[]) from public, anon;
grant execute on function public.ipas_save_payment(uuid, uuid, text, date, numeric, numeric, numeric, numeric, numeric, uuid, text, text, numeric, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- "Required before": a payment's proof is met by at least one file.
-- ---------------------------------------------------------------------------
create or replace function public._ipas_missing_documents(p_ipas_id uuid, p_section integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source text;
  v_screen smallint;
  v_proof boolean;
  v_missing text[] := '{}';
  v_pay record;
begin
  select source into v_source from public.ipas where id = p_ipas_id;
  if v_source is null then
    return '[]'::jsonb;
  end if;

  if p_section = 3 then
    select proof_on_every_payment into v_proof from public.ipas_file_rules limit 1;
    if coalesce(v_proof, true) then
      for v_pay in
        select p.paid_on from public.ipas_payments p
         where p.ipas_id = p_ipas_id
           and not exists (select 1 from public.ipas_payment_files f where f.payment_id = p.id)
         order by p.paid_on, p.created_at
      loop
        v_missing := v_missing || ('Proof of payment of ' || to_char(v_pay.paid_on, 'Mon DD, YYYY'));
      end loop;
    end if;
    return to_jsonb(v_missing);
  end if;

  v_screen := case p_section when 1 then 1 when 6 then 3 when 7 then 6 else null end;
  if v_screen is null then
    return '[]'::jsonb;
  end if;

  select coalesce(array_agg(o.label order by o.sort, o.label), '{}')
    into v_missing
    from public.ipas_options o
   where o.list = 'document_kind'
     and o.active
     and o.required_before = v_screen
     and o.applies_to in (v_source, 'both')
     and not exists (
       select 1
         from public.ipas_documents d
         join public.ipas_document_files f on f.document_id = d.id
        where d.ipas_id = p_ipas_id
          and d.kind_id = o.id
     );

  return to_jsonb(v_missing);
end;
$$;

revoke all on function public._ipas_missing_documents(uuid, integer) from public, anon, authenticated;
