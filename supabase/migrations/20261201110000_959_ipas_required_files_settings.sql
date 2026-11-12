-- #959 (spec #954): the files an IPAS needs before a sign-off are a setting, not code.
--
-- Before: the list lived twice, in the app (SECTION_DOCUMENT_KINDS) and in
-- _ipas_missing_documents. Now:
--   ipas_options.required_before   a document kind's "Required before": null (not
--                                  required), 1 (Order), 3 (Costs) or 6 (Sign-offs),
--                                  the screen numbers of the record. They are stored
--                                  sections 1, 6 and 7. It works with the kind's
--                                  Import / Local / Both and with it being active.
--   ipas_file_rules                two switches: proof of payment on every payment,
--                                  and a file on every charge. One row.
-- Only a Super Admin changes either. The sign-off checks read them live, so a
-- change applies to every open IPAS at once; a filed IPAS signs nothing more, so
-- it is never re-checked.
-- Seeds today's rules with one change: BIR 2307 starts as not required.
-- Idempotent.

alter table public.ipas_options add column if not exists required_before smallint;

alter table public.ipas_options drop constraint if exists ipas_options_required_before_chk;
alter table public.ipas_options add constraint ipas_options_required_before_chk check (
  required_before is null or (list = 'document_kind' and required_before in (1, 3, 6))
);

comment on column public.ipas_options.required_before is
  '#959: document kinds only. The screen (1 Order, 3 Costs, 6 Sign-offs) whose sign-off waits for a file of this kind; null = not required. Applies to IPAS whose Source matches applies_to. Super Admin only.';

-- Only a Super Admin sets "Required before" (Purchasing may still add and edit kinds).
create or replace function public.ipas_options_required_before_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not coalesce(public.is_super_admin(), false)
     and (
       (tg_op = 'INSERT' and new.required_before is not null)
       or (tg_op = 'UPDATE' and new.required_before is distinct from old.required_before)
     ) then
    raise exception 'ipas_options: only a Super Admin sets which files are required' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.ipas_options_required_before_guard() from public, anon, authenticated;

drop trigger if exists ipas_options_required_before_guard on public.ipas_options;
create trigger ipas_options_required_before_guard
  before insert or update on public.ipas_options
  for each row execute function public.ipas_options_required_before_guard();

-- The two switches: one row.
create table if not exists public.ipas_file_rules (
  id                     boolean primary key default true,
  proof_on_every_payment boolean not null default true,
  file_on_every_charge   boolean not null default true,
  updated_at             timestamptz not null default now(),
  constraint ipas_file_rules_one_row_chk check (id)
);

comment on table public.ipas_file_rules is
  '#959: IPAS file switches, one row. proof_on_every_payment = screen 2 waits for proof on each payment; file_on_every_charge = screen 3 waits for a file on each charge with an amount. Super Admin edits.';

alter table public.ipas_file_rules enable row level security;

drop policy if exists ipas_file_rules_read on public.ipas_file_rules;
create policy ipas_file_rules_read on public.ipas_file_rules
  for select to authenticated
  using (public.ipas_can_read());

drop policy if exists ipas_file_rules_update on public.ipas_file_rules;
create policy ipas_file_rules_update on public.ipas_file_rules
  for update to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));

revoke insert, delete, truncate on public.ipas_file_rules from anon, authenticated;
revoke update on public.ipas_file_rules from anon;

insert into public.ipas_file_rules (id) values (true) on conflict (id) do nothing;

-- Seed: today's rules, BIR 2307 not required.
update public.ipas_options
   set required_before = case
         when lower(btrim(label)) in ('proforma invoice', 'quotation (local)') then 1
         else 3
       end
 where list = 'document_kind'
   and required_before is null
   and lower(btrim(label)) in (
     'proforma invoice', 'quotation (local)',
     'bl or waybill', 'packing list', 'commercial invoice', 'freight billing'
   );

-- What a section still lacks, as a jsonb array of text. Stored 3 = proof of payment
-- (when the switch is on); stored 1, 6, 7 = the active kinds whose "Required before"
-- is screen 1, 3, 6 and whose Source matches, each lacking a file.
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
        select paid_on from public.ipas_payments
         where ipas_id = p_ipas_id and proof_url is null
         order by paid_on, created_at
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
       select 1 from public.ipas_documents d
        where d.ipas_id = p_ipas_id
          and d.kind_id = o.id
          and d.attachment_url is not null
     );

  return to_jsonb(v_missing);
end;
$$;

revoke all on function public._ipas_missing_documents(uuid, integer) from public, anon, authenticated;

-- A charge with an amount needs its file at screen 3 only while the switch is on.
-- A blank charge still blocks screens 2 and 3 either way.
create or replace function public._ipas_signoff_charges_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_blank integer;
  v_nofile integer;
  v_rule boolean;
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
    select file_on_every_charge into v_rule from public.ipas_file_rules limit 1;
    if new.section = 6 and v_nofile > 0 and coalesce(v_rule, true) then
      raise exception 'ipas_sign: % charge(s) with an amount have no file', v_nofile
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._ipas_signoff_charges_guard() from public, anon, authenticated;
