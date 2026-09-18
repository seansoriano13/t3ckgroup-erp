-- #330 (release/2026-09, #325): Legacy Pipeline backfill. CUTOVER STEP, NOT A
-- MIGRATION. It runs once against production after `migrate-prod` and never
-- against staging (see docs/production-cutover-runbook.md).
--
-- All live production SORs have a NULL sale_type_id. sor_always_sees resolves
-- through sales_flows.sale_type_id, so that branch of the SOR read policy can
-- never be true for them. This gives each one an identity, not a new process:
--
--   * production's one Sale Type, "Standard Pipeline", becomes "Legacy Pipeline"
--   * every non-deleted SOR with a NULL sale_type_id is attached to it
--
-- sales_opportunities_flow_pairing_chk requires sale_type_id and
-- flow_stage_id to be set together, so each SOR also gets the Legacy Pipeline
-- Stage it is already at: the one whose name is the label of its current
-- `status` in crm_pipeline_stages (production's 14 Stages mirror those labels
-- one to one). That records where the deal is; it is not a move, and `status`
-- itself is not touched. The first Stage Visit is recorded by the existing
-- trigger. No other column is written, and there's no link to Government or
-- Outright. An SOR whose status has no same-named Stage stops the run.
--
-- Stage changes are guarded by sor_guard_stage_move, which exempts only the
-- service role, so the block runs with that role claim (transaction-local).
--
-- Legacy Pipeline gets no Always sees configuration:
-- its SORs stay visible to their Deal Team and Super Admin only.
--
-- Idempotent and re-runnable. It targets production's Sale Type by id and does
-- nothing if that id isn't present, so running it against staging (or any
-- other database) is a no-op, not a mis-target.
--
-- Run:  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/cutover/legacy_pipeline_backfill.sql

do $$
declare
  -- Production ids (#330). The policy-tier test swaps this literal for a
  -- fixture Sale Type, so keep it the only occurrence in the file.
  v_sale_type_id constant uuid := 'f1d4e085-9a13-4c30-a2b7-b9f97f009608';
  v_flow_id uuid;
  v_attached integer;
  v_remaining integer;
  v_unmapped text;
begin
  if not exists (select 1 from public.sale_types where id = v_sale_type_id) then
    raise notice 'Legacy Pipeline backfill: Sale Type % not present, nothing to do (not production?)', v_sale_type_id;
    return;
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select id into v_flow_id from public.sales_flows where sale_type_id = v_sale_type_id;
  if v_flow_id is null then
    raise exception 'Legacy Pipeline backfill: Sale Type % has no Sales Flow', v_sale_type_id;
  end if;

  select string_agg(distinct coalesce(o.status, '(null)'), ', ') into v_unmapped
    from public.sales_opportunities o
    left join public.crm_pipeline_stages c on c.code = o.status
    left join public.flow_stages s on s.flow_id = v_flow_id and s.name = c.label
   where o.sale_type_id is null
     and coalesce(o.is_deleted, false) = false
     and s.id is null;
  if v_unmapped is not null then
    raise exception 'Legacy Pipeline backfill: no Legacy Pipeline Stage for status %', v_unmapped;
  end if;

  update public.sale_types
     set name = 'Legacy Pipeline'
   where id = v_sale_type_id
     and name is distinct from 'Legacy Pipeline';

  update public.sales_opportunities o
     set sale_type_id = v_sale_type_id,
         flow_stage_id = s.id
    from public.crm_pipeline_stages c
    join public.flow_stages s on s.flow_id = v_flow_id and s.name = c.label
   where c.code = o.status
     and o.sale_type_id is null
     and coalesce(o.is_deleted, false) = false;
  get diagnostics v_attached = row_count;

  select count(*) into v_remaining
    from public.sales_opportunities
   where sale_type_id is null
     and coalesce(is_deleted, false) = false;
  if v_remaining > 0 then
    raise exception 'Legacy Pipeline backfill: % non-deleted SORs still have no Sale Type', v_remaining;
  end if;

  if exists (
    select 1
      from public.flow_access_settings fas
      join public.sales_flows f on f.id = fas.flow_id
     where f.sale_type_id = v_sale_type_id
       and jsonb_array_length(coalesce(fas.always_sees, '[]'::jsonb)) > 0
  ) then
    raise exception 'Legacy Pipeline backfill: Legacy Pipeline has an Always sees configuration; it must have none';
  end if;

  raise notice 'Legacy Pipeline backfill: attached % SORs', v_attached;
end
$$;
