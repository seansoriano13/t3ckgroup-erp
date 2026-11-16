-- #966 (spec #955, decision 7): an S0 Evaluation can start from just an S0 number.
--
-- The rule, in one place (ADR 0052):
--   * costing_matrices.opportunity_id may be null. A matrix with no SOR is "standalone" and names its S0 in s0_number.
--   * Everything in the costing layer is keyed by a "subject" id: the SOR's id, or, for a standalone matrix, the
--     matrix's own id. costing_matrix_opp(matrix) now returns that subject, so every policy and function that already
--     goes matrix -> subject -> costing_tier keeps working unchanged.
--   * costing_tier(subject) asks costing_standalone_tier for a standalone matrix:
--       Super Admin or the decider list ......... closed_book (everything)
--       starter, named Sales incharge ........... price
--       named PMS incharge, Purchasing access ... cost
--       named Technical in-charge, Evaluation list  participant (a Go waits for the Technical verdict)
--     First match wins, so a person who is on two lists gets the first tier that fits.
--   * Linking to a SOR sets opportunity_id. From then on the id is the SOR's, and the SOR's rules decide.

-- ---------------------------------------------------------------------------
-- The matrix may stand alone
-- ---------------------------------------------------------------------------

alter table public.costing_matrices alter column opportunity_id drop not null;
alter table public.costing_matrices add column if not exists s0_number text;
alter table public.costing_matrices add column if not exists created_by uuid references public.employees (id) on delete set null;

alter table public.costing_matrices drop constraint if exists costing_matrices_has_subject_chk;
alter table public.costing_matrices add constraint costing_matrices_has_subject_chk
  check (opportunity_id is not null or s0_number is not null);

-- One evaluation per S0, whether it stands alone or sits on a SOR.
create unique index if not exists costing_matrices_s0_uidx
  on public.costing_matrices (upper(btrim(s0_number))) where s0_number is not null;

comment on column public.costing_matrices.s0_number is
  '#966: the S0 a standalone evaluation was started from (kept after it is linked to a SOR). Null on a matrix a SOR opened.';

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrices', 's0_number', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'created_by', '{participant,price,cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrices', 's0_number', '{super_admin_only}'),
  ('costing_matrices', 'created_by', '{super_admin_only}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- ---------------------------------------------------------------------------
-- Subject id, tier
-- ---------------------------------------------------------------------------

-- The id the costing layer keys a matrix by: its SOR, or its own id while it stands alone.
create or replace function public.costing_matrix_opp(p_matrix_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(opportunity_id, id) from public.costing_matrices where id = p_matrix_id
$$;

-- The matrix a subject id names (a SOR's, or a standalone one's own id).
create or replace function public.costing_subject_matrix(p_subject uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.costing_matrices where opportunity_id = p_subject or (opportunity_id is null and id = p_subject)
$$;

create or replace function public.costing_is_standalone(p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.costing_matrices where id = p_subject and opportunity_id is null)
$$;

-- The caller's tier on a standalone matrix; null for anyone else, and for a matrix that sits on a SOR.
create or replace function public.costing_standalone_tier(p_matrix_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire') then 'closed_book'
    when public.get_employee_id() is null then null
    when m.created_by = public.get_employee_id() or m.sales_incharge_id = public.get_employee_id() then 'price'
    when m.purchasing_incharge_id = public.get_employee_id() or public.has_purchasing_access() then 'cost'
    when m.technical_incharge_id = public.get_employee_id() or public.costing_on_list('evaluation') then 'participant'
    else null
  end
  from public.costing_matrices m
  where m.id = p_matrix_id and m.opportunity_id is null
$$;

-- costing_tier (latest: 20261121050004_908): a standalone matrix is judged by its own readers.
create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.costing_is_standalone(p_opportunity_id) then public.costing_standalone_tier(p_opportunity_id)
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when public.costing_on_list('final_acquire') or public.costing_is_open(p_opportunity_id) then 'closed_book'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'price'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    when exists (
      select 1 from public.costing_matrices m
      where m.opportunity_id = p_opportunity_id
        and (
          m.technical_incharge_id = public.get_employee_id()
          or public.costing_on_list('evaluation')
        )
    ) then 'participant'
    else null
  end
$$;

-- The matrix row's own policies read its subject, not its (possibly null) SOR.
drop policy if exists costing_matrices_read on public.costing_matrices;
create policy costing_matrices_read on public.costing_matrices
  for select to authenticated using (public.costing_can_read(coalesce(opportunity_id, id)));

drop policy if exists costing_matrices_update on public.costing_matrices;
create policy costing_matrices_update on public.costing_matrices
  for update to authenticated
  using (public.costing_can_read(coalesce(opportunity_id, id)))
  with check (public.costing_can_read(coalesce(opportunity_id, id)));

-- ---------------------------------------------------------------------------
-- Bands: who writes on a standalone matrix
-- ---------------------------------------------------------------------------

-- costing_in_band: Sales is the starter and the named Sales incharge; Purchasing adds the named PMS incharge.
-- The list-based bands do not look at the SOR, so they are unchanged.
create or replace function public.costing_in_band(p_opportunity_id uuid, p_band text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_band
    when 'sales' then
      coalesce(public.is_super_admin(), false)
      or exists (
        select 1 from public.sales_opportunities o
        where o.id = p_opportunity_id and public.sor_is_deal_team(o, public.get_employee_id())
      )
      or exists (
        select 1 from public.costing_matrices m
        where m.id = p_opportunity_id and m.opportunity_id is null
          and (m.created_by = public.get_employee_id() or m.sales_incharge_id = public.get_employee_id())
      )
    when 'purchasing' then
      coalesce(public.is_super_admin(), false)
      or public.has_purchasing_access()
      or exists (
        select 1 from public.costing_matrices m
        where m.id = p_opportunity_id and m.opportunity_id is null
          and m.purchasing_incharge_id = public.get_employee_id()
      )
    when 'management' then public.costing_on_list('final_acquire')
    when 'technical' then coalesce(public.is_super_admin(), false) or public.costing_is_technical(p_opportunity_id)
    when 'finance' then public.has_finance_access() or public.costing_on_list('final_acquire')
    when 'super_admin_only' then coalesce(public.is_super_admin(), false)
    when 'markup' then coalesce(public.is_super_admin(), false) or public.costing_on_list('markup')
    else false
  end
$$;

create or replace function public.costing_is_technical(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_purchasing_access()
    or exists (
      select 1 from public.costing_matrices m
      where coalesce(m.opportunity_id, m.id) = p_opportunity_id
        and m.technical_incharge_id = public.get_employee_id()
    )
$$;

-- Who may fill from Odoo: on a standalone matrix, the readers who write.
create or replace function public.costing_actor_can_fill(p_opportunity_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.costing_is_standalone(p_opportunity_id) then exists (
      select 1
      from public.employees e
      join public.costing_matrices m on m.id = p_opportunity_id
      where e.id = p_actor
        and not coalesce(e.is_deleted, false)
        and (
          coalesce(e.is_super_admin, false)
          or public._employee_has_purchasing_access(e.id)
          or m.created_by = e.id
          or m.sales_incharge_id = e.id
          or m.purchasing_incharge_id = e.id
          or exists (select 1 from public.costing_signer_lists l where l.list_key = 'final_acquire' and l.employee_id = e.id)
        )
    )
    else exists (
      select 1
      from public.employees e
      join public.sales_opportunities o on o.id = p_opportunity_id
      where e.id = p_actor
        and not coalesce(e.is_deleted, false)
        and (
          coalesce(e.is_super_admin, false)
          or public._employee_has_purchasing_access(e.id)
          or public.sor_is_deal_team(o, e.id)
          or exists (select 1 from public.costing_signer_lists l where l.list_key = 'final_acquire' and l.employee_id = e.id)
        )
    )
  end
$$;

create or replace function public.costing_odoo_cost_targets(p_actor uuid, p_opportunity_id uuid)
returns table (component_id uuid, odoo_product_id integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.costing_actor_can_fill(p_opportunity_id, p_actor) then
    raise exception 'costing_fill: only Sales or Purchasing can fill the matrix from Odoo' using errcode = '42501';
  end if;
  return query
  select c.id, c.odoo_product_id
  from public.costing_components c
  join public.costing_tender_lines l on l.id = c.tender_line_id
  join public.costing_matrices m on m.id = l.matrix_id
  where coalesce(m.opportunity_id, m.id) = p_opportunity_id
    and c.odoo_product_id is not null;
end;
$$;

-- The incharges on a standalone matrix may be anyone (they are named for reading, not for the Deal Team or Purchasing).
create or replace function public.costing_check_incharge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid;
  v_sor public.sales_opportunities;
begin
  -- A new matrix is not there to look up yet; it names its SOR itself.
  v_opp := case
    when tg_table_name = 'costing_matrices' then (to_jsonb(new) ->> 'opportunity_id')::uuid
    else public.costing_matrix_opp(public.costing_matrix_of(tg_table_name, to_jsonb(new)))
  end;
  if v_opp is null then
    return new;
  end if;
  -- costing_open_matrix inserts "on conflict do nothing": a row that is about to be
  -- dropped for the matrix the SOR already has is not judged.
  if tg_op = 'INSERT' and tg_table_name = 'costing_matrices'
     and exists (select 1 from public.costing_matrices m where m.opportunity_id = v_opp) then
    return new;
  end if;
  select * into v_sor from public.sales_opportunities where id = v_opp;
  -- A row of a standalone matrix has no SOR to check the names against.
  if v_sor.id is null then
    return new;
  end if;

  if new.sales_incharge_id is not null
     and (tg_op = 'INSERT' or new.sales_incharge_id is distinct from old.sales_incharge_id)
     and not coalesce(public.sor_is_deal_team(v_sor, new.sales_incharge_id), false) then
    raise exception 'costing_incharge: the Sales incharge must be on the SOR''s Deal Team'
      using errcode = '22023';
  end if;

  if new.purchasing_incharge_id is not null
     and (tg_op = 'INSERT' or new.purchasing_incharge_id is distinct from old.purchasing_incharge_id)
     and not public._employee_has_purchasing_access(new.purchasing_incharge_id) then
    raise exception 'costing_incharge: the Purchasing incharge must have Purchasing access'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- The header the window shows: a standalone evaluation is its S0, with no SOR code or client.
create or replace function public.costing_matrix_header(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier text := public.costing_tier(p_opportunity_id);
  v_opp record;
  v_m   record;
begin
  if v_tier is null then
    return null;
  end if;
  select m.id, m.s0_number, m.sales_incharge_id into v_m
    from public.costing_matrices m where m.id = p_opportunity_id and m.opportunity_id is null;
  if v_m.id is not null then
    return jsonb_build_object(
      'id', v_m.id,
      'sor_code', null,
      'client_name', null,
      'project_title', v_m.s0_number,
      'sales_reference', v_m.s0_number,
      'deal_owner_id', v_m.sales_incharge_id,
      'standalone', true
    );
  end if;
  select id, sor_code, client_name, project_title, sales_reference, deal_owner_id
    into v_opp
    from public.sales_opportunities
   where id = p_opportunity_id;
  if v_opp.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_opp.id,
    'sor_code', v_opp.sor_code,
    'client_name', v_opp.client_name,
    'project_title', v_opp.project_title,
    'sales_reference', v_opp.sales_reference,
    'deal_owner_id', v_opp.deal_owner_id
  );
end;
$$;

-- The standalone evaluations the caller may read, one row each, with the figures their tier may see.
create or replace function public.costing_standalone_page()
returns table (
  matrix_id uuid,
  s0_number text,
  created_by uuid,
  created_at timestamptz,
  sales_incharge_id uuid,
  purchasing_incharge_id uuid,
  tier text,
  line_count integer,
  final_offer_total numeric,
  final_acquire_total numeric,
  project_expenses_total numeric,
  marketing numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'costing_standalone_page: not signed in' using errcode = '42501';
  end if;
  return query
  select
    m.id, m.s0_number, m.created_by, m.created_at, m.sales_incharge_id, m.purchasing_incharge_id,
    t.tier,
    lines.n,
    case when t.tier in ('price', 'closed_book') then offer.total end,
    case when t.tier in ('cost', 'closed_book') then acquire.total end,
    case when t.tier in ('cost', 'closed_book') then public.costing_project_expenses_total(m.id) end,
    case when t.tier = 'closed_book' then mm.marketing end
  from public.costing_matrices m
  cross join lateral (select public.costing_standalone_tier(m.id) as tier) t
  left join public.costing_matrix_money mm on mm.matrix_id = m.id
  cross join lateral (select count(*)::integer as n from public.costing_tender_lines l where l.matrix_id = m.id) lines
  cross join lateral (
    select case when count(*) > 0 and bool_and(p.final_offer_unit is not null)
                then sum(round(p.final_offer_unit * l.quantity, 2)) end as total
    from public.costing_tender_lines l
    left join public.costing_tender_line_prices p on p.tender_line_id = l.id
    where l.matrix_id = m.id
  ) offer
  cross join lateral (
    select case when count(*) > 0 and bool_and(x.fa is not null)
                then sum(round(x.fa * x.q, 2)) end as total
    from (
      select cc.final_acquire_unit as fa, c.quantity as q
      from public.costing_components c
      join public.costing_tender_lines l on l.id = c.tender_line_id
      left join public.costing_component_costs cc on cc.component_id = c.id
      where l.matrix_id = m.id
    ) x
  ) acquire
  where m.opportunity_id is null
    and t.tier is not null
  order by m.created_at desc;
end;
$$;

-- True when the caller reads at least one standalone evaluation (the page's door for someone named on one).
create or replace function public.costing_standalone_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.costing_matrices m
    where m.opportunity_id is null and public.costing_standalone_tier(m.id) is not null
  )
$$;

-- ---------------------------------------------------------------------------
-- Writes: start, rename the incharges, link to a SOR
-- ---------------------------------------------------------------------------

-- The evaluation an S0 already has, standalone or on a SOR: {subject_id, matrix_id, standalone}, or null.
create or replace function public.costing_s0_existing(p_s0_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s0    text := upper(btrim(coalesce(p_s0_number, '')));
  v_found record;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_standalone: sign in first' using errcode = '42501';
  end if;
  select m.id, coalesce(m.opportunity_id, m.id) as subject, (m.opportunity_id is null) as standalone into v_found
    from public.costing_matrices m
   where upper(btrim(m.s0_number)) = v_s0
   limit 1;
  if v_found.id is null then
    select m.id, o.id as subject, false as standalone into v_found
      from public.sales_opportunities o
      join public.costing_matrices m on m.opportunity_id = o.id
     where upper(btrim(o.sales_reference)) = v_s0
       and not coalesce(o.is_deleted, false)
     order by o.created_at
     limit 1;
  end if;
  if v_found.id is null then
    return null;
  end if;
  return jsonb_build_object('subject_id', v_found.subject, 'matrix_id', v_found.id, 'standalone', v_found.standalone);
end;
$$;

-- Starts an evaluation from an S0 number, with the lines pulled from Odoo. One per S0: if the S0 already has one
-- (standalone, or on a SOR), nothing is made and the existing subject is returned with existed = true.
-- p_lines: [{name, quantity, unit, odoo_product_id, odoo_line_id}]. Returns {subject_id, matrix_id, existed, standalone}.
create or replace function public.costing_standalone_open(
  p_s0_number text,
  p_sales_incharge uuid,
  p_pms_incharge uuid,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := public.get_employee_id();
  v_s0     text := upper(btrim(coalesce(p_s0_number, '')));
  v_prior  text := current_setting('costing.bypass', true);
  v_existing jsonb;
  v_matrix uuid;
  v_line   uuid;
  v_pos    integer := 0;
  v_item   jsonb;
  v_qty    numeric;
  v_unit   text;
  v_name   text;
begin
  if v_actor is null then
    raise exception 'costing_standalone: sign in first' using errcode = '42501';
  end if;
  if not (coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire') or public.costing_is_open_anywhere()) then
    raise exception 'costing_standalone: only Super Admins, Purchasing, the Deal Team and the decider list start an evaluation' using errcode = '42501';
  end if;
  if v_s0 !~ '^S0[0-9]+$' then
    raise exception 'costing_standalone: % is not an S0 number', coalesce(nullif(v_s0, ''), 'that') using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_standalone:' || v_s0));

  -- One evaluation per S0: a standalone one, or one on a SOR that carries this S0.
  v_existing := public.costing_s0_existing(v_s0);
  if v_existing is not null then
    return v_existing || jsonb_build_object('existed', true);
  end if;

  if p_sales_incharge is null or p_pms_incharge is null then
    raise exception 'costing_standalone: name a Sales incharge and a PMS incharge' using errcode = '22023';
  end if;
  if (select count(*) from public.employees e where e.id in (p_sales_incharge, p_pms_incharge) and not coalesce(e.is_deleted, false))
     < (select count(distinct x) from (values (p_sales_incharge), (p_pms_incharge)) v(x)) then
    raise exception 'costing_standalone: that incharge is not an active employee' using errcode = '22023';
  end if;

  perform set_config('costing.bypass', 'on', true);

  insert into public.costing_matrices (opportunity_id, s0_number, created_by, sales_incharge_id, purchasing_incharge_id)
  values (null, v_s0, v_actor, p_sales_incharge, p_pms_incharge)
  returning id into v_matrix;

  insert into public.costing_matrix_money (matrix_id) values (v_matrix) on conflict (matrix_id) do nothing;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) = 'array' then
    for v_item in select * from jsonb_array_elements(p_lines) loop
      v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
      if v_name is null then
        continue;
      end if;
      v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1);
      if v_qty <= 0 then v_qty := 1; end if;
      v_unit := nullif(btrim(coalesce(v_item ->> 'unit', '')), '');
      v_pos := v_pos + 1;
      insert into public.costing_tender_lines (matrix_id, position, source, odoo_line_id, odoo_product_id, tender_specification, unit, quantity, created_by)
      values (v_matrix, v_pos, 'typed', nullif(v_item ->> 'odoo_line_id', '')::bigint, nullif(v_item ->> 'odoo_product_id', '')::integer,
              v_name, v_unit, v_qty, v_actor)
      returning id into v_line;
      -- The product is its own first Component, as it is when a SOR's line is filled in.
      insert into public.costing_components (tender_line_id, position, name, quantity, unit, odoo_product_id)
      values (v_line, 1, v_name, v_qty, v_unit, nullif(v_item ->> 'odoo_product_id', '')::integer);
    end loop;
  end if;

  perform set_config('costing.bypass', coalesce(v_prior, ''), true);
  return jsonb_build_object('subject_id', v_matrix, 'matrix_id', v_matrix, 'existed', false, 'standalone', true);
end;
$$;

-- Changes the two names on a standalone evaluation. The starter, the Sales incharge, the decider list and Super Admins may.
create or replace function public.costing_standalone_set_incharge(p_matrix_id uuid, p_sales_incharge uuid, p_pms_incharge uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior text := current_setting('costing.bypass', true);
begin
  if public.get_employee_id() is null then
    raise exception 'costing_standalone: sign in first' using errcode = '42501';
  end if;
  if not public.costing_is_standalone(p_matrix_id) then
    raise exception 'costing_standalone: this evaluation sits on a SOR, whose own incharges apply' using errcode = '22023';
  end if;
  if coalesce(public.costing_standalone_tier(p_matrix_id), '') not in ('closed_book', 'price') then
    raise exception 'costing_standalone: only the starter, the Sales incharge or the decider list can change the incharges' using errcode = '42501';
  end if;
  if p_sales_incharge is null or p_pms_incharge is null then
    raise exception 'costing_standalone: name a Sales incharge and a PMS incharge' using errcode = '22023';
  end if;
  if (select count(*) from public.employees e where e.id in (p_sales_incharge, p_pms_incharge) and not coalesce(e.is_deleted, false))
     < (select count(distinct x) from (values (p_sales_incharge), (p_pms_incharge)) v(x)) then
    raise exception 'costing_standalone: that incharge is not an active employee' using errcode = '22023';
  end if;
  perform set_config('costing.bypass', 'on', true);
  update public.costing_matrices
     set sales_incharge_id = p_sales_incharge, purchasing_incharge_id = p_pms_incharge
   where id = p_matrix_id;
  perform set_config('costing.bypass', coalesce(v_prior, ''), true);
end;
$$;

-- Attaches a standalone evaluation to a SOR that has none. The SOR's rules decide access from then on.
create or replace function public.costing_standalone_link(p_matrix_id uuid, p_opportunity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior text := current_setting('costing.bypass', true);
  v_s0    text;
  v_sor   public.sales_opportunities;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_standalone: sign in first' using errcode = '42501';
  end if;
  select s0_number into v_s0 from public.costing_matrices where id = p_matrix_id and opportunity_id is null;
  if not found then
    raise exception 'costing_standalone: this evaluation is already on a SOR' using errcode = '22023';
  end if;
  if coalesce(public.costing_standalone_tier(p_matrix_id), '') not in ('closed_book', 'price') then
    raise exception 'costing_standalone: only the starter, the Sales incharge or the decider list can link it' using errcode = '42501';
  end if;
  select * into v_sor from public.sales_opportunities where id = p_opportunity_id and not coalesce(is_deleted, false);
  if v_sor.id is null then
    raise exception 'costing_standalone: SOR not found' using errcode = '22023';
  end if;
  -- The caller must be someone the SOR's own rules let into its evaluation.
  if not (public.costing_on_list('final_acquire') or public.costing_is_open(p_opportunity_id)) then
    raise exception 'costing_standalone: you cannot open the S0 Evaluation of that SOR' using errcode = '42501';
  end if;
  if exists (select 1 from public.costing_matrices where opportunity_id = p_opportunity_id) then
    raise exception 'costing_standalone: that SOR already has an S0 Evaluation' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_sor.sales_reference, '')), '') is not null
     and upper(btrim(v_sor.sales_reference)) <> upper(btrim(v_s0)) then
    raise exception 'costing_standalone: that SOR is on %, not %', v_sor.sales_reference, v_s0 using errcode = '22023';
  end if;

  perform set_config('costing.bypass', 'on', true);
  update public.costing_matrices set opportunity_id = p_opportunity_id where id = p_matrix_id;
  -- The SOR's own products join the lines already here (matched by Odoo line, then by Odoo product), never by name.
  if exists (select 1 from public.sales_opportunity_items where opportunity_id = p_opportunity_id and not coalesce(removed_from_s0, false)) then
    perform public.costing_fill_from_sor(p_opportunity_id);
  end if;
  perform set_config('costing.bypass', coalesce(v_prior, ''), true);
  return jsonb_build_object('opportunity_id', p_opportunity_id, 'matrix_id', p_matrix_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.costing_subject_matrix(uuid) from public, anon;
grant execute on function public.costing_subject_matrix(uuid) to authenticated;
revoke all on function public.costing_is_standalone(uuid) from public, anon;
grant execute on function public.costing_is_standalone(uuid) to authenticated;
revoke all on function public.costing_standalone_tier(uuid) from public, anon;
grant execute on function public.costing_standalone_tier(uuid) to authenticated;
revoke all on function public.costing_standalone_page() from public, anon;
grant execute on function public.costing_standalone_page() to authenticated;
revoke all on function public.costing_standalone_anywhere() from public, anon;
grant execute on function public.costing_standalone_anywhere() to authenticated;
revoke all on function public.costing_s0_existing(text) from public, anon;
grant execute on function public.costing_s0_existing(text) to authenticated;
revoke all on function public.costing_standalone_open(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.costing_standalone_open(text, uuid, uuid, jsonb) to authenticated;
revoke all on function public.costing_standalone_set_incharge(uuid, uuid, uuid) from public, anon;
grant execute on function public.costing_standalone_set_incharge(uuid, uuid, uuid) to authenticated;
revoke all on function public.costing_standalone_link(uuid, uuid) from public, anon;
grant execute on function public.costing_standalone_link(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The two reads that find a matrix by its subject (bodies as they stood; only the lookup line changes)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.costing_matrix_read(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tier   text := public.costing_tier(p_opportunity_id);
  v_matrix uuid;
  v_def    public.costing_tables;
  v_cols   text[];
  v_virtual text;
  v_rows   jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_bands  text[];
begin
  if v_tier is null then
    return null;
  end if;
  select public.costing_subject_matrix(p_opportunity_id) into v_matrix;
  if v_matrix is null then
    return null;
  end if;

  for v_def in select * from public.costing_tables order by table_name loop
    select coalesce(array_agg(c.column_name), '{}') into v_cols
    from public.costing_column_tiers c
    where c.table_name = v_def.table_name and c.column_name <> '*' and v_tier = any (c.tiers);
    if cardinality(v_cols) = 0 then
      continue;
    end if;

    -- Computed columns, only those this tier may read.
    select coalesce(string_agg(format('%L, %s', vc.column_name, vc.expression), ', '), '') into v_virtual
    from public.costing_virtual_columns vc
    where vc.table_name = v_def.table_name and vc.column_name = any (v_cols);

    execute format(
      'select coalesce(jsonb_agg(public.costing_pick(to_jsonb(t) %s, $2) order by %s), ''[]''::jsonb) from public.%I t where %s',
      case when v_virtual = '' then '' else '|| jsonb_build_object(' || v_virtual || ')' end,
      v_def.order_by,
      v_def.table_name,
      public.costing_matrix_filter(v_def.table_name)
    ) into v_rows using v_matrix, v_cols;

    v_tables := v_tables || jsonb_build_object(v_def.table_name, v_rows);
  end loop;

  -- The write bands the caller is in, so the screen can show a cell read-only.
  select coalesce(array_agg(b), '{}') into v_bands
    from unnest(array['sales', 'purchasing', 'management', 'technical', 'finance', 'super_admin_only', 'markup']) b
   where public.costing_in_band(p_opportunity_id, b);

  return jsonb_build_object('tier', v_tier, 'matrix_id', v_matrix, 'bands', to_jsonb(v_bands), 'tables', v_tables);
end;
$function$;

CREATE OR REPLACE FUNCTION public.costing_history(p_opportunity_id uuid, p_table text DEFAULT NULL::text, p_row uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tier   text := public.costing_tier(p_opportunity_id);
  v_matrix uuid;
  v_result jsonb;
begin
  if v_tier is null then
    return null;
  end if;
  select public.costing_subject_matrix(p_opportunity_id) into v_matrix;
  if v_matrix is null then
    return null;
  end if;

  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id), '[]'::jsonb) into v_result
  from (
    select e.id, e.created_at,
      jsonb_build_object(
        'id', e.id,
        'at', e.created_at,
        'actor_id', e.actor_id,
        'kind', e.kind,
        'detail', case
          when e.detail ? 'column' then e.detail
          else jsonb_build_object('table', e.detail -> 'table', 'row', e.detail -> 'row')
            || jsonb_build_object('values', public.costing_pick(
              e.detail -> 'values',
              (select coalesce(array_agg(c.column_name), '{}') from public.costing_column_tiers c
                where c.table_name = e.detail ->> 'table' and c.column_name <> '*' and v_tier = any (c.tiers))
            ))
        end
      ) as item
    from public.costing_events e
    where e.matrix_id = v_matrix
      and (p_table is null or e.detail ->> 'table' = p_table)
      and (p_row is null or e.detail ->> 'row' = p_row::text)
      and (
        case
          when e.detail ? 'column' then exists (
            select 1 from public.costing_column_tiers c
            where c.table_name = e.detail ->> 'table' and c.column_name = e.detail ->> 'column' and v_tier = any (c.tiers)
          )
          else exists (
            select 1 from public.costing_column_tiers c
            where c.table_name = e.detail ->> 'table' and c.column_name <> '*' and v_tier = any (c.tiers)
          )
        end
      )
    order by e.created_at desc, e.id
    limit greatest(coalesce(p_limit, 100), 1)
  ) x;

  return v_result;
end;
$function$;
