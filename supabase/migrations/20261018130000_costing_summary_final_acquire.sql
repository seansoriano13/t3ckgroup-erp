-- Costing Matrix, part 3: the summary's inputs, the rates and the signer lists (#270, spec #266).
--
-- WHAT THIS ADDS
--   costing_settings        a single row of rates Finance edits: vat_divisor (1.12),
--                           tax_rate (0.06), retention_rate (0.01), itr_rate (0.08) and
--                           itr_allowance (250000). costingMath.summary reads them; a rate
--                           change needs no rebuild.
--   costing_matrix_money    gains marketing and opex (typed by Finance access or the Final
--                           Acquire list, read at the closed_book tier only).
--   costing_signer_lists    the final_acquire list is seeded with the employee whose call
--                           sign is 101 (nothing is seeded, and nothing fails, when they
--                           are absent). The list is now readable by any signed-in employee.
--
--   The summary itself is not stored and not computed here: costingMath.summary works it
--   out in the browser from the Final Offers, Final Acquire figures and the rates the
--   caller's tier received, so only a closed_book read has the figures to compute it with
--   (#319). Final Acquire on a Component and on a cost-only row was already registered by
--   #268 (Management band, closed_book read).
--
--   One change to a #267/#268 generic function (behaviour, not a registry row):
--     costing_set_money lets an employee with Finance access write the columns whose band
--     list includes 'finance' (Marketing and OPEX) even though Finance access alone gives
--     no read tier on the SOR. Every other column still needs a tier, and the band trigger
--     still judges each column.
--
-- ACCESS
--   costing_settings: read by any signed-in employee (the rates are not secret); the rates
--   are written by Finance access or a Super Admin. costing_signer_lists: written by Super
--   Admins only (unchanged). marketing and opex: band finance + management.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: every statement is create-if-missing,
-- create-or-replace, drop-then-create or insert-on-conflict.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.costing_settings (
  id             smallint primary key default 1,
  vat_divisor    numeric(10,6) not null default 1.12,
  tax_rate       numeric(10,6) not null default 0.06,
  retention_rate numeric(10,6) not null default 0.01,
  itr_rate       numeric(10,6) not null default 0.08,
  itr_allowance  numeric(18,2) not null default 250000,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.employees (id) on delete set null,

  constraint costing_settings_single_chk check (id = 1),
  constraint costing_settings_vat_chk check (vat_divisor >= 1),
  constraint costing_settings_tax_chk check (tax_rate >= 0 and tax_rate <= 1),
  constraint costing_settings_retention_chk check (retention_rate >= 0 and retention_rate <= 1),
  constraint costing_settings_itr_chk check (itr_rate >= 0 and itr_rate <= 1),
  constraint costing_settings_allowance_chk check (itr_allowance >= 0)
);

comment on table public.costing_settings is
  '#270: the Costing Matrix summary''s rates, a single row (id = 1). Written by Finance access or a Super Admin; read by any signed-in employee. #271 keeps the Evaluation of Specification template in its own table.';

alter table public.costing_matrix_money
  add column if not exists marketing numeric(18,2),
  add column if not exists opex numeric(18,2);

alter table public.costing_matrix_money drop constraint if exists costing_matrix_money_marketing_chk;
alter table public.costing_matrix_money
  add constraint costing_matrix_money_marketing_chk check (marketing is null or marketing >= 0);
alter table public.costing_matrix_money drop constraint if exists costing_matrix_money_opex_chk;
alter table public.costing_matrix_money
  add constraint costing_matrix_money_opex_chk check (opex is null or opex >= 0);

comment on column public.costing_matrix_money.marketing is
  '#270: the summary''s Marketing figure, typed by Finance access or the Final Acquire list. Closed Book read.';
comment on column public.costing_matrix_money.opex is
  '#270: the summary''s OPEX figure, typed by Finance access or the Final Acquire list. Closed Book read.';

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Who stamped the rates, and when.
create or replace function public.costing_settings_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id = 1;
  new.updated_at = now();
  new.updated_by = public.get_employee_id();
  return new;
end;
$$;

revoke all on function public.costing_settings_stamp() from public, anon, authenticated;

-- #268's money write, with one change: Finance access alone may write the columns of the
-- Finance band (Marketing and OPEX), see the header.
create or replace function public.costing_set_money(p_table text, p_row uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def    public.costing_tables;
  v_matrix uuid;
  v_opp    uuid;
  v_key    text;
  v_sets   text;
  v_cols   text;
  v_count  integer;
  v_found  jsonb;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_set_money: sign in first' using errcode = '42501';
  end if;
  select * into v_def from public.costing_tables where table_name = p_table and money;
  if not found then
    raise exception 'costing_set_money: % is not a money table', p_table using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'costing_set_money: nothing to change' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = '*' or not exists (
      select 1 from public.costing_column_bands where table_name = p_table and column_name = v_key
    ) then
      raise exception 'costing_set_money: % is not a column of %', v_key, p_table using errcode = '22023';
    end if;
  end loop;

  if v_def.parent_table is null and v_def.key_column <> 'matrix_id' then
    execute format('select to_jsonb(t) from public.%I t where t.%I = $1', p_table, v_def.key_column)
      into v_found using p_row;
    v_matrix := public.costing_matrix_of(p_table, v_found);
  else
    v_matrix := public.costing_matrix_of(p_table, jsonb_build_object(v_def.key_column, p_row));
  end if;
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    raise exception 'costing_set_money: not found' using errcode = 'P0002';
  end if;
  -- A read tier is needed, with one exception (#270): Finance access alone has no tier on
  -- the SOR, yet Finance types Marketing and OPEX. That passes only when every column in the
  -- patch is one a Finance-band caller may write; the band trigger still judges each of them.
  if not public.costing_can_read(v_opp) then
    if not (
      public.has_finance_access()
      and not exists (
        select 1
        from jsonb_object_keys(p_patch) k
        where not exists (
          select 1 from public.costing_column_bands b
          where b.table_name = p_table and b.column_name = k and 'finance' = any (b.bands)
        )
      )
    ) then
      raise exception 'costing_set_money: not allowed' using errcode = '42501';
    end if;
  end if;

  select string_agg(format('%I = r.%I', k, k), ', '), string_agg(format('%I', k), ', ')
    into v_sets, v_cols
    from jsonb_object_keys(p_patch) k;

  execute format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I = $2',
    p_table, v_sets, p_table, v_def.key_column
  ) using p_patch, p_row;
  get diagnostics v_count = row_count;

  if v_count = 0 and (v_def.parent_table is not null or v_def.key_column = 'matrix_id') then
    execute format(
      'insert into public.%I (%I, %s) select $2, %s from jsonb_populate_record(null::public.%I, $1) r',
      p_table, v_def.key_column, v_cols,
      (select string_agg(format('r.%I', k), ', ') from jsonb_object_keys(p_patch) k),
      p_table
    ) using p_patch, p_row;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Triggers, row level security and grants
-- ---------------------------------------------------------------------------

drop trigger if exists costing_settings_stamp on public.costing_settings;
create trigger costing_settings_stamp before update on public.costing_settings
  for each row execute function public.costing_settings_stamp();

alter table public.costing_settings enable row level security;

revoke all on table public.costing_settings from anon, authenticated;
grant select, update on public.costing_settings to authenticated;

-- The rates are not secret: any signed-in employee reads them (the summary needs
-- them, and a Closed Book reader is not necessarily a Finance reader).
drop policy if exists costing_settings_read on public.costing_settings;
create policy costing_settings_read on public.costing_settings
  for select to authenticated using (true);

drop policy if exists costing_settings_update on public.costing_settings;
create policy costing_settings_update on public.costing_settings
  for update to authenticated
  using (public.has_finance_access() or coalesce(public.is_super_admin(), false))
  with check (public.has_finance_access() or coalesce(public.is_super_admin(), false));

-- The signer lists are readable by any signed-in employee (who is on the list is not
-- a secret: the Final Acquire list shows on the grid and the print); Super Admins write.
drop policy if exists costing_signer_lists_read on public.costing_signer_lists;
create policy costing_signer_lists_read on public.costing_signer_lists
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------

insert into public.costing_settings (id) values (1) on conflict (id) do nothing;

-- 101 on the Final Acquire list, by employee code (the call sign). A database without
-- that employee seeds nothing and does not fail.
do $seed$
declare
  v_employee uuid;
begin
  select e.id into v_employee
    from public.employees e
   where e.call_sign = '101'
     and not coalesce(e.is_deleted, false);

  if v_employee is null then
    raise notice 'costing_signer_lists: no employee has call sign 101, so final_acquire starts empty (add them in Costing Matrix settings)';
  else
    insert into public.costing_signer_lists (list_key, employee_id)
    values ('final_acquire', v_employee)
    on conflict (list_key, employee_id) do nothing;
  end if;
end;
$seed$;

-- ---------------------------------------------------------------------------
-- Registry rows
-- ---------------------------------------------------------------------------

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrix_money', 'matrix_id', '{closed_book}'),
  ('costing_matrix_money', 'marketing', '{closed_book}'),
  ('costing_matrix_money', 'opex', '{closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrix_money', 'marketing', '{finance,management}'),
  ('costing_matrix_money', 'opex', '{finance,management}')
on conflict (table_name, column_name) do update set bands = excluded.bands;
