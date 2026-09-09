/**
 * Row triggers, mirrored by hand from the migrations.
 *
 * Unlike tables and constraints — which are parsed straight out of the SQL —
 * these are plpgsql function bodies, so they are transcribed rather than
 * derived. Each one names the migration it comes from; if that migration
 * changes, this file has to change with it.
 *
 * They matter because the services lean on them: opportunityService never
 * computes `expected_value` (a trigger sums the item rows) and never sets
 * `sales_reference` defaults (a trigger normalises and gates them). Without
 * these, a service test would be asserting against rows production would never
 * produce.
 */

import { pgrstError } from "./schema"

/** Raises the way `raise exception` in plpgsql does. */
function raise(message) {
  throw pgrstError("P0001", message, { status: 400 })
}


export const TRIGGERS = {
  sales_opportunities: {
    beforeInsert: [
      // 0012 dropped sales_opportunities_set_no(): opportunity_no shared the
      // S0#### format with Odoo's sales references while identifying an
      // unrelated record, so it is no longer minted. New rows leave it null.
      // 0011 — sales_opportunities_require_sales_ref(), INSERT branch.
      // Rewritten in 0034 to read flags from crm_pipeline_stages, and in 0036
      // to gate the ITB Number the same way — by the is_itb_gate flag's own
      // sort_order, never a literal, so reordering the gate stage moves the
      // gate with it instead of leaving a stale threshold behind. 0038 added
      // the outright exemption: an award won with no bidding has no ITB
      // Number to give, so itb_exempt satisfies the gate in its place.
      function requireSalesReferenceOnInsert(row, context) {
        row.sales_reference = row.sales_reference?.trim()
          ? row.sales_reference.trim().toUpperCase()
          : null
        row.itb_number = row.itb_number?.trim() ? row.itb_number.trim() : null

        const stages = context.rowsOf("crm_pipeline_stages")
        const stage = stages.find((s) => s.code === row.status)
        const gate = stages.find((s) => s.is_itb_gate)
        const isLead = stage?.is_default
        const isLost = stage?.is_lost

        if (!isLead && !isLost && row.sales_reference == null) {
          raise(
            "A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.",
          )
        }
        if (
          gate &&
          stage?.sort_order >= gate.sort_order &&
          !isLost &&
          row.itb_number == null &&
          !row.itb_exempt
        ) {
          raise(
            "An ITB Number (Invitation to Bid) is required to register an opportunity at For Bidding or beyond, unless it is marked outright (no bidding required).",
          )
        }
      },
    ],
    beforeUpdate: [
      // 0011 — sales_opportunities_require_sales_ref(), UPDATE branch.
      // Rewritten in 0034/0036 — see the INSERT branch above.
      function requireSalesReferenceOnStageMove(row, old, context) {
        row.sales_reference = row.sales_reference?.trim()
          ? row.sales_reference.trim().toUpperCase()
          : null
        row.itb_number = row.itb_number?.trim() ? row.itb_number.trim() : null

        const stages = context.rowsOf("crm_pipeline_stages")
        const stage = stages.find((s) => s.code === row.status)
        const oldStage = stages.find((s) => s.code === old.status)
        const gate = stages.find((s) => s.is_itb_gate)

        const isLead = stage?.is_default
        const isLost = stage?.is_lost
        const oldIsLead = oldStage?.is_default

        if (row.status === old.status) return

        if (oldIsLead && !isLead && !isLost && row.sales_reference == null) {
          raise(
            "A Sales Reference (Odoo quotation no., e.g. S01237) is required before this opportunity can leave Lead.",
          )
        }

        if (
          gate &&
          oldStage?.sort_order < gate.sort_order &&
          stage?.sort_order >= gate.sort_order &&
          !isLost &&
          row.itb_number == null &&
          !row.itb_exempt
        ) {
          raise(
            "An ITB Number (Invitation to Bid) is required before this opportunity can move to For Bidding or beyond, unless it is marked outright (no bidding required).",
          )
        }
      },
      // 0001 — sales_opportunities_guard(), as amended by 0012: ownership
      // disputes are settled on these two columns, so they never change once
      // the row exists. opportunity_no was released from the guard in 0012.
      function guardImmutableColumns(row, old) {
        if (row.registration_date !== old.registration_date) {
          raise("registration_date is immutable — it determines deal ownership")
        }
        if (row.registered_by !== old.registered_by) {
          raise("registered_by is immutable")
        }
        row.updated_at = new Date().toISOString()
      },
    ],
  },

  sales_opportunity_items: {
    // 0003 — sales_opportunity_items_touch()
    beforeUpdate: [
      function touchUpdatedAt(row) {
        row.updated_at = new Date().toISOString()
      },
    ],
    // 0003 — sor_recalc_expected_value()
    afterWrite: [
      function recalcExpectedValue(row, _old, context) {
        const opportunityId = row.opportunity_id
        const total = context
          .rowsOf("sales_opportunity_items")
          .filter((item) => item.opportunity_id === opportunityId)
          .reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0)

        const parent = context
          .rowsOf("sales_opportunities")
          .find((opportunity) => opportunity.id === opportunityId)
        if (parent) parent.expected_value = total
      },
    ],
  },

  sor_procurement_requests: {
    // 0017 — sor_procurement_requests_touch()
    //
    // 0023's sor_procurement_requests_guard() is deliberately NOT mirrored. It
    // decides what to reject from public.get_employee_id() — who the caller is
    // — and the fake has no notion of an authenticated actor, so a transcription
    // of it could only ever return NEW unchanged. Its effect is checked against
    // a real database, like the RLS policies it narrows.
    beforeUpdate: [
      function touchUpdatedAt(row) {
        row.updated_at = new Date().toISOString()
      },
    ],
  },

  // sil_leaves / offset_leaves / overtime_requests:
  // guard_head_status_change() (20260908110000_department_head_approval_stage.sql,
  // broadened by 20260908140000_broaden_head_status_guard.sql for issue #139)
  // is deliberately NOT mirrored here, for the same reason as
  // sor_procurement_requests_guard() above: it decides whether to reject a
  // write to head_status/head_note/head_decided_at/head_signature_version
  // based on public.is_hr()/is_super_admin()/is_head()/get_employee_id() —
  // who the caller is — and the fake has no authenticated actor to answer
  // with. The guarantee it enforces (an ordinary employee cannot record a
  // head decision on their own application) is checked against a real
  // database, like the RLS policies it sits alongside; it is not provable by
  // `npm run test:unit` / `test:integration`.
}

export function runBeforeInsert(table, row, context) {
  for (const trigger of TRIGGERS[table]?.beforeInsert ?? []) trigger(row, context)
}

export function runBeforeUpdate(table, row, old, context) {
  for (const trigger of TRIGGERS[table]?.beforeUpdate ?? []) trigger(row, old, context)
}

export function runAfterWrite(table, row, old, context) {
  for (const trigger of TRIGGERS[table]?.afterWrite ?? []) trigger(row, old, context)
}
