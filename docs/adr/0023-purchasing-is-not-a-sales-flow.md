# Purchasing is not a Sales Flow

**Status:** accepted (2026-09-17)

Purchasing described its work to us as five stages — Sourcing, Costing Matrix,
IPAS, Order Monitoring, Transmittal — and asked for that process to be built on
the Flow Canvas as a reusable, configurable flow. We decided **not** to
generalise the flow engine, and to keep Purchasing as its own Module with its
own records. The five words became the derived groupings of the Purchasing
Dashboard instead.

## Why

**The five stages are not stages of one record.** A Stage holds one record at one
point; purchasing is one-to-many at every hop. The Costing Matrix exists from SOR
registration, so nothing ever arrives at it. Canvasses are per Component and a
dozen run in parallel. An IPAS is per purchase order — one SOR has many, and one
IPAS can name several SORs. Transmittals are per slip, one delivery splits across
slips, one slip carries several orders. Order Monitoring is not a stage at all;
it is a view across every IPAS in the company.

On a real project, purchasing is canvassing component 7, ordering component 3 and
receiving component 1 at the same time. There is no position for a flow to hold.
Modelling it as one would force a lie into the data on day one.

**Purchasing's configurability is not flow-shaped.** What the business varies is
who signs and what is on the option lists — charge kinds, required documents,
freight services, locations, markup presets. The step order is fixed by Odoo, by
the paper forms and by Philippine procurement law. Issue #210 had already settled
this: developers change fields, the business edits lists, and there is no form
builder.

The one genuinely flow-shaped thing in purchasing already exists as a plain state
machine: the Requested Item status path (#306).

## The cost that was measured, and rejected

The flow engine splits cleanly in two, and only one half is reusable.

*Already record-agnostic:* `sale_types`, `sales_flows`, `flow_stages`,
`flow_edges`, `flow_snapshots`, `stage_conditions`, `flow_stage_actions`,
`flow_access_settings`, `flow_stage_access`, `employee_groups` — **not one has a
foreign key to `sales_opportunities`**. `src/constants/salesFlow.js` and most of
`src/constants/stageGate.js` are pure functions over stages and edges.

*Welded to the SOR:*

- Six runtime tables, every one `opportunity_id uuid NOT NULL REFERENCES
  sales_opportunities(id)`: `sor_stage_visits`, `sor_stage_field_values`,
  `sor_condition_status`, `sor_action_runs`, `sor_form_values`,
  `sor_stage_participants`.
- Four triggers **on `sales_opportunities`** carrying the engine's
  writes-that-cannot-be-forgotten: `record_stage_visit`,
  `close_stage_participant_windows`, `sor_guard_stage_move`,
  `sor_set_log_stage_visit`.
- ~13 `SECURITY DEFINER` functions typed on `public.sales_opportunities`, with
  the five Deal Team role→column mappings duplicated inline in four of them.
- ~8 RLS policies calling `sor_visible_visit_ids(...opportunity_id)`.
- The move path is `moveAlongFlow` inside `src/services/opportunityService.js`
  (3,538 lines) — it takes an SOR row, writes `sales_opportunities.flow_stage_id`
  literally, and stamps `contract_date` on the won stage.
- `flow_stage_fields.source = 'sor'`, `flow_form_fields.default_key`, and their
  JS allow-lists.
- `sales_flows.sale_type_id` is UNIQUE: one flow per Sale Type, no second axis.

**There is no polymorphic seam.** No `subject_type`, no `entity_type`, no
`flow_instances` table. Nothing anywhere anticipated a second record type.

Generalising therefore means rewriting the entire runtime half while live CRM
deals run on it in production, with nothing to do it behind. That is a programme
of its own, and it would block every open purchasing ticket while it ran.

## Considered and rejected

- **Generalise the engine first, then build purchasing on it.** Rejected on the
  cost above — but rejected *primarily* on the cardinality argument, which no
  amount of engineering removes. A generic engine would still have no position
  to store.
- **Build purchasing on the Flow Canvas as-is, with a purchasing record
  pretending to be an SOR.** Rejected: a fake SOR inherits Deal Team roles,
  commission, Contract Date and the registration form, and you fight that
  forever.

## Consequences

- The Purchasing Dashboard's groupings — To source, To price, To order, On
  order, To check — are **derived and never stored**, and one SOR appears in as
  many as apply. Anything that later tries to compute a single "current stage"
  for an SOR's purchasing is reintroducing the bug this ADR avoids.
- Purchasing gets no Flow Canvas, no Stage Conditions and no Stage Actions. Where
  purchasing work must gate a *sales* decision, it does so through a Stage
  Condition on the Sales Flow — `purchasing settled` and `costing settled` — not
  by having a flow of its own. *(Amended 2026-10-05 by ADR 0033: purchasing's
  one-per-SOR tools — Purchase Request, Costing Matrix, Packing List request —
  do mount as Sales Flow Stage Actions; purchasing still has no flow of its own.)*
- The record-agnostic half of the engine stays reusable if a genuinely
  flow-shaped second record type ever appears. This ADR rejects generalising it
  *for purchasing*, not forever.
- `docs/crm-pipeline-redesign.md` already recorded "Purchase Request,
  deliberately outside the SOR". This decision is consistent with that, and
  supersedes nothing.

## Amendment (2026-11-13, spec #718, ticket #730): an IPAS is raised by attaching the P0, and its SOR list can grow

"The SOR list is fixed after raising" (#551) is relaxed for additions only.

- **Attaching a P0 to a project line raises its IPAS.** After `odoo-po-verify` attaches a verified P0, the server reads
  the PO from Odoo itself (the same read as `odoo-po-ipas`) and calls `purchase_request_item_auto_ipas` (service role
  only). With no live IPAS for the P0 it raises one: Source from the PO's currency (PHP is Local, anything else Import),
  Purpose Project, Priority Medium (editable later), SORs = the line's SOR. A forged copy still cannot be stored.
- **A live IPAS that is not filed gets this SOR added.** One P0 serving two deals stays one IPAS. The history records
  it as "SOR added". Nobody can remove an SOR or edit the list by hand; `ipas_set_purpose_and_sors` is unchanged.
- **A filed IPAS gets nothing.** The answer says so and the filed record stays frozen. The same holds for a live
  IPAS that is not a Project IPAS.
- **Odoo not answering never undoes the attach.** The P0 stays attached, the line is flagged `ipas_pending` and shows
  "IPAS to create" with a Retry button.
- **Manual raising stays** for Inventory, Supplies and Events, and for a line with no SOR (a Direct request).
