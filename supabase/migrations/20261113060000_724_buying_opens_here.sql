-- 20261113060000_724_buying_opens_here.sql
-- #724 (spec #718): "Buying opens here" and Order early.
--
-- 1. flow_stages.buying_opens_here: Operations flags at most one Stage per flow on Flow Canvas.
--    Flow Snapshots carry whole Stage rows, so the flag is frozen with each published version
--    (an older snapshot has no key, which reads as not flagged). restore_flow_snapshot carries it.
-- 2. purchase_request_items.ordered_early_reason: why a P0 was attached before the SOR reached
--    that Stage. Non-null means "Ordered early".
-- 3. purchase_request_item_attach_po gains p_order_early / p_order_early_reason. On a project
--    request (opportunity_id set), the SOR's pinned Flow Snapshot is read for its flagged Stage;
--    if the SOR has no Stage visit there yet the attach is refused (22023) unless p_order_early
--    is true with a non-blank reason. The reason is stored on the line, written to the request
--    history and sent to the Deal Owner. No flagged Stage, or a Direct request (no SOR), is not gated.
--
-- Additive; idempotent. The attach function changes signature, so the 4-argument one is dropped
-- (a call passing four named arguments still resolves to the new one through its defaults).

alter table public.flow_stages add column if not exists buying_opens_here boolean not null default false;

comment on column public.flow_stages.buying_opens_here is
  '#724: Buying opens here. A P0 is attached to a project line only once the SOR has entered this Stage, or with Order early and a reason. At most one per flow.';

create unique index if not exists flow_stages_one_buying_opens_here_key
  on public.flow_stages (flow_id) where buying_opens_here;

alter table public.purchase_request_items add column if not exists ordered_early_reason text;
alter table public.purchase_request_items drop constraint if exists purchase_request_items_ordered_early_reason_chk;
alter table public.purchase_request_items add constraint purchase_request_items_ordered_early_reason_chk
  check (ordered_early_reason is null or btrim(ordered_early_reason) <> '');

comment on column public.purchase_request_items.ordered_early_reason is
  '#724: set when a P0 was attached before the SOR reached the flow''s "Buying opens here" Stage; the typed reason. Null means not ordered early.';

-- Restore carries the flag (redefines 20261005132000; body unchanged but for buying_opens_here) ----

create or replace function public.restore_flow_snapshot(
  p_flow_id uuid,
  p_snapshot_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flow record;
  v_snapshot record;
  v_data jsonb;
  v_target_stage_ids uuid[];
  v_target_edge_ids uuid[];
  v_target_action_ids uuid[];
  v_target_condition_ids uuid[];
  v_target_field_ids uuid[];
  v_target_form_field_ids uuid[];
  v_target_follow_up_stage_ids uuid[];
  v_won_stage_id uuid;
  v_blockers text[] := array[]::text[];
  v_rec record;
  v_elem jsonb;
begin
  -- Lock the Sales Flow row first (ADR 0013 / lock_sales_flow).
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select * into v_snapshot from flow_snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'That Flow Snapshot does not exist.';
  end if;
  if v_snapshot.flow_id <> p_flow_id then
    raise exception 'That Flow Snapshot does not belong to this flow.';
  end if;

  v_data := v_snapshot.snapshot_data;
  v_won_stage_id := nullif(v_data->>'wonStageId', '')::uuid;

  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_stage_ids
  from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e;

  -- Refuse before writing anything if a live Stage the target drops is still
  -- referenced by an SOR. The foreign key sees soft-deleted SORs too, so they
  -- count, and the message says when they are the whole reason.
  for v_rec in
    select st.name as stage_name,
           count(*) as total,
           count(*) filter (where o.is_deleted is true) as soft_deleted
    from flow_stages st
    join sales_opportunities o on o.flow_stage_id = st.id
    where st.flow_id = p_flow_id
      and not (st.id = any(v_target_stage_ids))
    group by st.id, st.name
    order by st.name
  loop
    v_blockers := array_append(
      v_blockers,
      format(
        '"%s" is referenced by %s SOR%s%s',
        v_rec.stage_name,
        v_rec.total,
        case when v_rec.total = 1 then '' else 's' end,
        case
          when v_rec.soft_deleted = v_rec.total then format(' (all %s soft-deleted)', v_rec.total)
          when v_rec.soft_deleted > 0 then format(' (%s of them soft-deleted)', v_rec.soft_deleted)
          else ''
        end
      )
    );
  end loop;
  if array_length(v_blockers, 1) > 0 then
    raise exception 'This version cannot be restored yet: %. Move those deals to another Stage first.',
      array_to_string(v_blockers, '; ');
  end if;

  -- From here the draft is reshaped to match the target, keeping ids. Clear
  -- the Won Stage first so a dropped Stage that held it can be deleted.
  update sales_flows set won_stage_id = null, updated_at = now() where id = p_flow_id;

  -- Two Stages can swap names. The one-name-per-flow index is checked row by
  -- row, so park every surviving Stage on a unique placeholder first.
  -- The one-flag-per-flow index is checked row by row too, so clear the flag here and set it from the target.
  update flow_stages set name = '__restore__' || id::text, buying_opens_here = false where flow_id = p_flow_id;

  -- Drop the Stages the target does not have. Their edges, conditions and
  -- actions go by cascade; the check above proved no SOR is referenced.
  delete from flow_stages
   where flow_id = p_flow_id
     and not (id = any(v_target_stage_ids));

  -- Upsert every target Stage under its original id.
  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e
  loop
    insert into flow_stages (
      id, flow_id, name, sort_order, is_terminal, terminal_outcome, buying_opens_here, pos_x, pos_y, color, bracket_label, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'name',
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce((v_elem->>'is_terminal')::boolean, false),
      case when coalesce((v_elem->>'is_terminal')::boolean, false) then nullif(v_elem->>'terminal_outcome', '') end,
      coalesce((v_elem->>'buying_opens_here')::boolean, false),
      coalesce((v_elem->>'pos_x')::int, 0),
      coalesce((v_elem->>'pos_y')::int, 0),
      nullif(v_elem->>'color', ''),
      nullif(v_elem->>'bracket_label', ''),
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      sort_order = excluded.sort_order,
      is_terminal = excluded.is_terminal,
      terminal_outcome = excluded.terminal_outcome,
      buying_opens_here = excluded.buying_opens_here,
      pos_x = excluded.pos_x,
      pos_y = excluded.pos_y,
      color = excluded.color,
      bracket_label = excluded.bracket_label,
      updated_at = now();
  end loop;

  -- Moves.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_edge_ids
  from jsonb_array_elements(coalesce(v_data->'edges', '[]'::jsonb)) as e;

  delete from flow_edges
   where flow_id = p_flow_id
     and not (id = any(v_target_edge_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'edges', '[]'::jsonb)) as e
  loop
    insert into flow_edges (id, flow_id, from_stage_id, to_stage_id, created_at)
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      (v_elem->>'from_stage_id')::uuid,
      (v_elem->>'to_stage_id')::uuid,
      coalesce((v_elem->>'created_at')::timestamptz, now())
    )
    on conflict (id) do update set
      from_stage_id = excluded.from_stage_id,
      to_stage_id = excluded.to_stage_id;
  end loop;

  -- Stage Actions.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_action_ids
  from jsonb_array_elements(coalesce(v_data->'actions', '[]'::jsonb)) as e;

  delete from flow_stage_actions
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_action_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'actions', '[]'::jsonb)) as e
  loop
    insert into flow_stage_actions (id, stage_id, kind, config, sort_order, archived_at, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'kind',
      coalesce(v_elem->'config', '{}'::jsonb),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      kind = excluded.kind,
      config = excluded.config,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Stage Conditions.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_condition_ids
  from jsonb_array_elements(coalesce(v_data->'conditions', '[]'::jsonb)) as e;

  delete from stage_conditions
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_condition_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'conditions', '[]'::jsonb)) as e
  loop
    insert into stage_conditions (id, stage_id, kind, label, is_required, sort_order, config, archived_at, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'kind',
      v_elem->>'label',
      coalesce((v_elem->>'is_required')::boolean, true),
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce(v_elem->'config', '{}'::jsonb),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      kind = excluded.kind,
      label = excluded.label,
      is_required = excluded.is_required,
      sort_order = excluded.sort_order,
      config = excluded.config,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Stage Fields (#331). Values recorded against a field cascade from it, so
  -- a field the target lacks is archived, not deleted: the SOR data stays.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_field_ids
  from jsonb_array_elements(coalesce(v_data->'stageFields', '[]'::jsonb)) as e;

  update flow_stage_fields
     set archived_at = now(), updated_at = now()
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_field_ids))
     and archived_at is null;

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stageFields', '[]'::jsonb)) as e
  loop
    insert into flow_stage_fields (
      id, stage_id, label, help, source, sor_field, field_type, options, is_required, sort_order, archived_at, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'label',
      nullif(v_elem->>'help', ''),
      v_elem->>'source',
      nullif(v_elem->>'sor_field', ''),
      v_elem->>'field_type',
      coalesce(v_elem->'options', '[]'::jsonb),
      coalesce((v_elem->>'is_required')::boolean, true),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      label = excluded.label,
      help = excluded.help,
      source = excluded.source,
      sor_field = excluded.sor_field,
      field_type = excluded.field_type,
      options = excluded.options,
      is_required = excluded.is_required,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Registration form fields: same archive-don't-delete rule (sor_form_values).
  -- A 'default' row is unique per (flow, default_key). When the draft already
  -- has one for a key the target customizes, under a different id, that row
  -- is updated in place (keeping its id and its values) rather than replaced.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_form_field_ids
  from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e;

  update flow_form_fields
     set archived_at = now(), updated_at = now()
   where flow_id = p_flow_id
     and not (id = any(v_target_form_field_ids))
     and not (
       source = 'default'
       and default_key in (
         select e->>'default_key'
         from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e
         where e->>'source' = 'default'
       )
     )
     and archived_at is null;

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e
  loop
    if v_elem->>'source' = 'default' then
      update flow_form_fields set
        label = nullif(v_elem->>'label', ''),
        help = nullif(v_elem->>'help', ''),
        field_type = nullif(v_elem->>'field_type', ''),
        options = coalesce(v_elem->'options', '[]'::jsonb),
        is_required = (v_elem->>'is_required')::boolean,
        is_hidden = coalesce((v_elem->>'is_hidden')::boolean, false),
        sort_order = coalesce((v_elem->>'sort_order')::int, 0),
        archived_at = nullif(v_elem->>'archived_at', '')::timestamptz,
        updated_at = now()
      where flow_id = p_flow_id
        and source = 'default'
        and default_key = v_elem->>'default_key'
        and id <> (v_elem->>'id')::uuid;
      if found then
        continue;
      end if;
    end if;

    insert into flow_form_fields (
      id, flow_id, source, default_key, label, help, field_type, options, is_required, is_hidden, sort_order, archived_at, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'source',
      nullif(v_elem->>'default_key', ''),
      nullif(v_elem->>'label', ''),
      nullif(v_elem->>'help', ''),
      nullif(v_elem->>'field_type', ''),
      coalesce(v_elem->'options', '[]'::jsonb),
      (v_elem->>'is_required')::boolean,
      coalesce((v_elem->>'is_hidden')::boolean, false),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      source = excluded.source,
      default_key = excluded.default_key,
      label = excluded.label,
      help = excluded.help,
      field_type = excluded.field_type,
      options = excluded.options,
      is_required = excluded.is_required,
      is_hidden = excluded.is_hidden,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Follow-up Cadence: one row per Stage, carried in the snapshot keyed by
  -- its Stage id (`id` = stage_id), in followUpService's camelCase shape
  -- (everyDays, proofRequired). Nothing hangs off it, so plain replace.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_follow_up_stage_ids
  from jsonb_array_elements(coalesce(v_data->'followUps', '[]'::jsonb)) as e;

  delete from flow_stage_follow_ups
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (stage_id = any(v_target_follow_up_stage_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'followUps', '[]'::jsonb)) as e
  loop
    insert into flow_stage_follow_ups (stage_id, enabled, every_days, recipients, proof_required, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      coalesce((v_elem->>'enabled')::boolean, false),
      nullif(coalesce(v_elem->>'everyDays', v_elem->>'every_days'), '')::int,
      coalesce(v_elem->'recipients', '[{"type":"role","role":"deal_owner"}]'::jsonb),
      coalesce(coalesce(v_elem->>'proofRequired', v_elem->>'proof_required')::boolean, true),
      coalesce(coalesce(v_elem->>'createdAt', v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (stage_id) do update set
      enabled = excluded.enabled,
      every_days = excluded.every_days,
      recipients = excluded.recipients,
      proof_required = excluded.proof_required,
      updated_at = now();
  end loop;

  -- Access configuration (snapshot `access`) is deliberately NOT restored:
  -- who sees a flow's SORs is set per environment, and the release transfer
  -- (#331) must land Government and Outright with no flow_access_settings.

  update sales_flows
     set won_stage_id = v_won_stage_id,
         updated_at = now()
   where id = p_flow_id
  returning * into v_flow;

  return json_build_object('flow', row_to_json(v_flow), 'version', v_snapshot.version);
end;
$$;

grant execute on function public.restore_flow_snapshot(uuid, uuid) to authenticated;


-- The name of the "Buying opens here" Stage the SOR has not entered yet, or null when buying is open:
-- a Direct request, an SOR with no pinned version, a version with no flagged Stage, or a Stage the SOR has visited.
create or replace function public._purchase_request_buying_closed_stage(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select x.st->>'name'
    from public.purchase_requests r
    join public.sales_opportunities o on o.id = r.opportunity_id
    join public.flow_snapshots fs on fs.id = o.flow_snapshot_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(fs.snapshot_data->'stages') = 'array' then fs.snapshot_data->'stages' else '[]'::jsonb end
    ) as x(st)
   where r.id = p_request_id
     and coalesce((x.st->>'buying_opens_here')::boolean, false)
     and not exists (
       select 1 from public.sor_stage_visits v
        where v.opportunity_id = o.id and v.flow_stage_id = (x.st->>'id')::uuid
     )
   limit 1;
$$;

revoke all on function public._purchase_request_buying_closed_stage(uuid) from public, anon, authenticated;

-- Attach P0 (redefines 20261104190000) ----------------------------------------------------------
drop function if exists public.purchase_request_item_attach_po(text, uuid, text, jsonb);

create or replace function public.purchase_request_item_attach_po(
  p_actor_email text,
  p_item_id uuid,
  p_po_number text,
  p_facts jsonb,
  p_order_early boolean default false,
  p_order_early_reason text default null
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po text := nullif(upper(btrim(p_po_number)), '');
  v_actor uuid;
  v_item public.purchase_request_items;
  v_state text := p_facts->>'state';
  v_ordered numeric;
  v_received numeric;
  v_bought text := nullif(btrim(p_facts->>'bought_as'), '');
  v_to text;
  v_text text;
  v_closed_stage text;
  v_early text;
  v_deal_owner uuid;
begin
  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'purchase_request_item_attach_po: % isn''t an Odoo P0 number ("P" then digits, e.g. P01234)', coalesce(p_po_number, '') using errcode = '22023';
  end if;
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'purchase_request_item_attach_po: not signed in' using errcode = '42501';
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'object' or v_state is null or v_state not in ('rfq', 'confirmed') then
    raise exception 'purchase_request_item_attach_po: the P0 facts must say rfq or confirmed' using errcode = '22023';
  end if;
  v_ordered := coalesce((p_facts->>'ordered')::numeric, 0);
  v_received := coalesce((p_facts->>'received')::numeric, 0);

  -- Act as the caller the edge function authenticated: identity is the JWT email claim.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);

  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'purchase_request_item_attach_po: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_item_attach_po: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if coalesce(public.purchase_request_actor_side(v_item.request_id), '') <> 'purchasing' then
    raise exception 'purchase_request_item_attach_po: only Purchasing attaches a P0' using errcode = '42501';
  end if;
  if v_item.status in ('cancelled', 'received') then
    raise exception 'purchase_request_item_attach_po: nothing to attach to this line; % is %',
      v_item.name, public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;

  -- #724: Buying opens here. Refused before the SOR has entered the flagged Stage unless ordered early with a reason.
  v_closed_stage := public._purchase_request_buying_closed_stage(v_item.request_id);
  if v_closed_stage is not null then
    if not coalesce(p_order_early, false) then
      raise exception 'purchase_request_item_attach_po: buying opens at % and this SOR has not reached it; choose Order early and give a reason to attach now', v_closed_stage
        using errcode = '22023';
    end if;
    v_early := nullif(btrim(coalesce(p_order_early_reason, '')), '');
    if v_early is null then
      raise exception 'purchase_request_item_attach_po: Order early needs a reason' using errcode = '22023';
    end if;
  end if;

  v_to := case
    when v_state = 'rfq' then 'to_purchase'
    when v_ordered > 0 and v_received >= v_ordered then 'received'
    else 'purchased'
  end;

  update public.purchase_request_items
     set status = v_to,
         status_changed_by = case when status is distinct from v_to then v_actor else status_changed_by end,
         status_changed_at = case when status is distinct from v_to then now() else status_changed_at end,
         po_number = v_po,
         po_verification = 'VERIFIED',
         po_state = v_state,
         po_ordered = v_ordered,
         po_received = v_received,
         bought_as = v_bought,
         -- A reason sent with an attach that was not early is ignored; an earlier one stays.
         ordered_early_reason = coalesce(v_early, ordered_early_reason),
         -- Lines picked on another P0 do not carry over.
         odoo_po_line_ids = case when po_number is distinct from v_po then '{}' else odoo_po_line_ids end
   where id = v_item.id
  returning * into v_item;

  v_text := case v_to
    when 'to_purchase' then format('%s: RFQ %s attached; still To purchase.', v_item.name, v_po)
    else format('%s: P0 %s attached; %s.', v_item.name, v_po, public._purchase_request_item_status_label(v_to))
  end;
  if v_early is not null then
    v_text := v_text || format(' Ordered early: %s', v_early);
  end if;
  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    v_text,
    jsonb_build_object(
      'event', 'item_po_attached',
      'item_id', v_item.id,
      'to', v_to,
      'po_number', v_po,
      'po_state', v_state,
      'bought_as', v_bought,
      'ordered_early', v_early is not null,
      'ordered_early_reason', v_early
    )
  );

  -- Tell the Deal Owner that money is out before the Stage that opens buying.
  if v_early is not null then
    select o.deal_owner_id into v_deal_owner
      from public.purchase_requests r
      join public.sales_opportunities o on o.id = r.opportunity_id
     where r.id = v_item.request_id;
    perform public._purchase_request_notify(
      v_item.request_id, array[v_deal_owner], v_actor, 'PURCHASE_REQUEST_ORDERED_EARLY',
      'Ordered early on your deal',
      format('%s: %s was ordered before %s. Reason: %s', public._purchase_request_label(v_item.request_id), v_item.name, v_closed_stage, v_early),
      false
    );
  end if;

  return v_item;
end;
$$;

comment on function public.purchase_request_item_attach_po(text, uuid, text, jsonb, boolean, text) is
  '#684/#724: server-only (service role). Attaches an Odoo P0 to a Requested Item as the given signed-in Purchasing member, from the facts the odoo-po-verify edge function read in Odoo: state rfq (line stays To purchase) or confirmed (Purchased, or Received once everything arrived). Refused on Cancelled and Received lines. On a project line, refused before the SOR has entered the flow''s "Buying opens here" Stage unless p_order_early is true with a non-blank reason (stored on the line, written to history, sent to the Deal Owner).';

revoke all on function public.purchase_request_item_attach_po(text, uuid, text, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.purchase_request_item_attach_po(text, uuid, text, jsonb, boolean, text) to service_role;
