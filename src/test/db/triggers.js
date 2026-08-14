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
      // 0011 — sales_opportunities_require_sales_ref(), INSERT branch
      function requireSalesReferenceOnInsert(row) {
        row.sales_reference = row.sales_reference?.trim()
          ? row.sales_reference.trim().toUpperCase()
          : null
        if (!["LEAD", "CLOSED_LOST"].includes(row.status) && row.sales_reference == null) {
          raise(
            "A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.",
          )
        }
      },
    ],
    beforeUpdate: [
      // 0011 — sales_opportunities_require_sales_ref(), UPDATE branch
      function requireSalesReferenceOnStageMove(row, old) {
        row.sales_reference = row.sales_reference?.trim()
          ? row.sales_reference.trim().toUpperCase()
          : null
        if (
          row.status !== old.status &&
          old.status === "LEAD" &&
          !["LEAD", "CLOSED_LOST"].includes(row.status) &&
          row.sales_reference == null
        ) {
          raise(
            "A Sales Reference (Odoo quotation no., e.g. S01237) is required before this opportunity can leave Lead.",
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
}

export function runBeforeInsert(table, row) {
  for (const trigger of TRIGGERS[table]?.beforeInsert ?? []) trigger(row)
}

export function runBeforeUpdate(table, row, old) {
  for (const trigger of TRIGGERS[table]?.beforeUpdate ?? []) trigger(row, old)
}

export function runAfterWrite(table, row, old, context) {
  for (const trigger of TRIGGERS[table]?.afterWrite ?? []) trigger(row, old, context)
}
