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
import { windowClosesOnMove } from "../../utils/stageParticipantWindow"

/** Raises the way `raise exception` in plpgsql does. */
function raise(message) {
  throw pgrstError("P0001", message, { status: 400 })
}


/**
 * sor_canvasses (20261019100000_canvass_repoint.sql, #276): the number comes from a sequence in
 * the database (CNV_ and four digits; here, one past the highest held) and a Canvass has exactly one subject. The
 * fake parses simple CHECKs only, so the cross-column one is mirrored here; the policy tier proves
 * the real one (90-canvass-tables.test.js).
 */
function assignCanvassNumber(row, context) {
  const taken = context.rowsOf("sor_canvasses").map((r) => Number(String(r.number ?? "").replace(/\D/g, "")) || 0)
  row.number = `CNV_${String(Math.max(0, ...taken) + 1).padStart(4, "0")}`
}

function requireOneCanvassSubject(row) {
  if ((row.component_id ? 1 : 0) + (row.requested_item_id ? 1 : 0) !== 1) {
    throw pgrstError(
      "23514",
      'new row for relation "sor_canvasses" violates check constraint "sor_canvasses_exactly_one_subject_chk"',
      { status: 400 },
    )
  }
}

function keepCanvassNumber(row, old) {
  if (row.number !== old.number) throw pgrstError("42501", "A Canvass number is never changed.", { status: 403 })
}

/** sor_canvass_offer_prices_check_rate(): a PHP Offer takes no comparison rate. */
function refusePhpRate(row, context) {
  if (row.comparison_rate === null || row.comparison_rate === undefined) return
  const offer = context.rowsOf("sor_canvass_offers").find((o) => o.id === row.offer_id)
  if (offer?.currency === "PHP") throw pgrstError("23514", "A PHP Offer takes no comparison rate.", { status: 400 })
}

/** sor_canvass_offers_check_currency(): the rate goes before an Offer turns PHP. */
function refuseRateOnPhpOffer(row, old, context) {
  if (row.currency !== "PHP" || row.currency === old.currency) return
  const price = context.rowsOf("sor_canvass_offer_prices").find((p) => p.offer_id === row.id)
  if (price?.comparison_rate !== null && price?.comparison_rate !== undefined) {
    throw pgrstError("23514", "Clear the comparison rate before changing an Offer to PHP.", { status: 400 })
  }
}

/**
 * canvass_null_fill_mark() (20261019120000_canvass_winner_fills_matrix.sql, #278): a "from
 * Canvass" mark goes when its field changes by any route but canvass_apply_winner. The RPC's
 * stand-in (src/test/stubs/canvassRpc.js) sets `canvassFill.on` while it writes, as the real
 * one sets canvass.fill.
 */
export const canvassFill = { on: false }

function nullFillMark(markColumn, fieldColumn) {
  return (row, old) => {
    if (canvassFill.on) return
    if (row[fieldColumn] !== old[fieldColumn]) row[markColumn] = null
  }
}

/**
 * canvass_clear_signoff() and its triggers (20261019130000_canvass_signoff.sql, #279): any insert,
 * update or delete on a Canvass's Offers or their prices (bar a plain re-ordering), a winner
 * change, or a change to the reason, while the Canvass is signed, unsigns it and appends a
 * "cleared" event with the reason. The fake has no caller, so the actor is null. `old` is null for
 * an insert and the row itself for a delete.
 */
function clearCanvassSignoff(canvassId, reason, context) {
  const canvass = context.rowsOf("sor_canvasses").find((c) => c.id === canvassId)
  if (!canvass || !canvass.signed_off_at) return
  canvass.signed_off_by = null
  canvass.signed_off_at = null
  context.rowsOf("sor_canvass_signoff_events").push({
    id: globalThis.crypto.randomUUID(),
    canvass_id: canvassId,
    kind: "cleared",
    actor_id: null,
    reason,
    offer_count: context.rowsOf("sor_canvass_offers").filter((o) => o.canvass_id === canvassId).length,
    created_at: new Date().toISOString(),
  })
}

function clearOnOfferChange(row, old, context) {
  let reason
  if (old === null) reason = "An Offer was added"
  else if (old === row) reason = "An Offer was removed"
  else {
    const { sort_order: _a, updated_at: _b, ...now } = row
    const { sort_order: _c, updated_at: _d, ...before } = old
    if (JSON.stringify(now) === JSON.stringify(before)) return
    reason = row.is_winner !== old.is_winner ? "The winner changed" : "An Offer was changed"
  }
  clearCanvassSignoff(row.canvass_id, reason, context)
}

function clearOnPriceChange(row, old, context) {
  if (old && old !== row && row.unit_price === old.unit_price && row.comparison_rate === old.comparison_rate) return
  const offer = context.rowsOf("sor_canvass_offers").find((o) => o.id === row.offer_id)
  if (offer) clearCanvassSignoff(offer.canvass_id, "A price changed", context)
}

function clearOnReasonChange(row, old, context) {
  if (old && old !== row && row.reason !== old.reason) clearCanvassSignoff(row.id, "The reason changed", context)
}

/** sor_canvass_signoff_events_append_only(): the history is never edited or removed. */
function refuseHistoryEdit() {
  throw pgrstError("42501", "The sign-off history is append-only.", { status: 403 })
}

function requireBundleParent(row, context) {
  const parent = context.rowsOf("costing_components").find((c) => c.id === row.component_id)
  if (!parent?.is_bundle) {
    throw pgrstError("23514", "costing_inclusion: an Inclusion can only sit under a bundle Component", { status: 400 })
  }
}

/**
 * costing_components_deviation_note_chk (20261018140000_costing_matrix_evaluation.sql, #271): a
 * Component that deviates carries a note. The fake parses simple CHECKs only, so this cross-column
 * one is mirrored here; the policy tier proves the real one (82-costing-evaluation.test.js).
 */
function requireDeviationNote(row) {
  if (row.compliance === "deviates" && !String(row.compliance_note ?? "").trim()) {
    throw pgrstError(
      "23514",
      'new row for relation "costing_components" violates check constraint "costing_components_deviation_note_chk"',
      { status: 400 },
    )
  }
}

/**
 * costing_clear_evaluation_approval() (same migration): a change to a Tender Specification, an
 * Offer Specification, a verdict or its note, or a Tender Line or Component added or removed,
 * clears the live "Evaluation approved" with a reason, and the clearing is in the history
 * (costing_events: a changed event for cleared_at and for cleared_reason, as the real trigger
 * writes them). `old` is null for an insert and the row itself for a delete.
 */
function clearEvaluationApproval(table, row, old, context) {
  const insert = old === null
  const remove = old === row
  let reason
  if (insert || remove) {
    const what = table === "costing_tender_lines" ? "Tender Line" : "Component"
    reason = `A ${what} was ${insert ? "added" : "removed"}`
  } else if (table === "costing_tender_lines") {
    if (row.tender_specification === old.tender_specification) return
    reason = "A Tender Specification changed"
  } else if (row.offer_specification !== old.offer_specification) {
    reason = "An Offer Specification changed"
  } else if (row.compliance !== old.compliance) {
    reason = "A Compliance verdict changed"
  } else if (row.compliance_note !== old.compliance_note) {
    reason = "A Compliance note changed"
  } else {
    return
  }

  const lineId = table === "costing_tender_lines" ? row.id : row.tender_line_id
  const line = context.rowsOf("costing_tender_lines").find((l) => l.id === lineId)
  const matrixId = table === "costing_tender_lines" ? row.matrix_id : line?.matrix_id
  if (!matrixId) return
  for (const signoff of context.rowsOf("costing_signoffs")) {
    if (signoff.matrix_id !== matrixId || signoff.role !== "evaluation_approved" || signoff.cleared_at) continue
    const at = new Date().toISOString()
    signoff.cleared_at = at
    signoff.cleared_reason = reason
    for (const [column, value] of [["cleared_at", at], ["cleared_reason", reason]]) {
      context.rowsOf("costing_events").push({
        id: globalThis.crypto.randomUUID(),
        matrix_id: matrixId,
        actor_id: null,
        kind: "changed",
        detail: { table: "costing_signoffs", row: signoff.id, column, old: null, new: value },
        created_at: at,
      })
    }
  }
}

/**
 * costing_log_final_offer_change() (20261018180000_costing_settled_condition.sql, #272): once the
 * matrix's bid_submitted_at is set, a Final Offer that is added or changed writes a SYSTEM entry on
 * the SOR's timeline, on the open Stage Visit, with the Tender Line's number and no figures. Before
 * the bid is submitted it writes nothing. The actor is not mirrored (the fake has none).
 */
function logFinalOfferChange(row, old, context) {
  if (old === row) return // a delete
  if (old === null ? row.final_offer_unit == null : row.final_offer_unit === old.final_offer_unit) return
  const line = context.rowsOf("costing_tender_lines").find((l) => l.id === row.tender_line_id)
  const matrix = line && context.rowsOf("costing_matrices").find((m) => m.id === line.matrix_id)
  if (!matrix?.bid_submitted_at) return
  const visit = context
    .rowsOf("sor_stage_visits")
    .find((v) => v.opportunity_id === matrix.opportunity_id && !v.left_at && !v.undone_at)
  context.rowsOf("sales_opportunity_logs").push({
    id: globalThis.crypto.randomUUID(),
    opportunity_id: matrix.opportunity_id,
    author_id: null,
    type: "SYSTEM",
    content: `Final Offer changed on Tender Line ${line.position} after the bid was submitted.`,
    metadata: { event: "COSTING_FINAL_OFFER_CHANGED", tender_line_id: row.tender_line_id },
    created_at: new Date().toISOString(),
    stage_visit_id: visit?.id ?? null,
  })
}

export const TRIGGERS = {
  sales_opportunities: {
    beforeInsert: [
      // 0012 dropped sales_opportunities_set_no(): opportunity_no shared the
      // S0#### format with Odoo's sales references while identifying an
      // unrelated record, so it is no longer minted. New rows leave it null.
      // 0011 — sales_opportunities_require_sales_ref(), INSERT branch.
      // Rewritten in 0034 to read flags from crm_pipeline_stages, in 0036 to
      // add the ITB gate, and in the #206 migration to drop that gate again —
      // Sales Flows replaced it (ADR 0004 D12). itb_number/itb_exempt stay on
      // the row, still trimmed, just no longer enforced.
      function requireSalesReferenceOnInsert(row, context) {
        row.sales_reference = row.sales_reference?.trim()
          ? row.sales_reference.trim().toUpperCase()
          : null
        row.itb_number = row.itb_number?.trim() ? row.itb_number.trim() : null

        const stages = context.rowsOf("crm_pipeline_stages")
        const stage = stages.find((s) => s.code === row.status)
        const isLead = stage?.is_default
        const isLost = stage?.is_lost

        if (!isLead && !isLost && row.sales_reference == null) {
          raise(
            "A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.",
          )
        }
      },
    ],
    beforeUpdate: [
      // 0011 — sales_opportunities_require_sales_ref(), UPDATE branch.
      // Rewritten in 0034/0036, then again by the #206 migration — see the
      // INSERT branch above.
      function requireSalesReferenceOnStageMove(row, old, context) {
        row.sales_reference = row.sales_reference?.trim()
          ? row.sales_reference.trim().toUpperCase()
          : null
        row.itb_number = row.itb_number?.trim() ? row.itb_number.trim() : null

        const stages = context.rowsOf("crm_pipeline_stages")
        const stage = stages.find((s) => s.code === row.status)
        const oldStage = stages.find((s) => s.code === old.status)

        const isLead = stage?.is_default
        const isLost = stage?.is_lost
        const oldIsLead = oldStage?.is_default

        if (row.status === old.status) return

        if (oldIsLead && !isLead && !isLost && row.sales_reference == null) {
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
    // 20260915030000_stage_fields_and_visits.sql — record_stage_visit(),
    // fired on insert and on update of flow_stage_id. Opens a Stage Visit
    // for a flow-built deal on insert; on a stage change, closes whatever
    // visit was open and opens a new one. Legacy-pipeline deals
    // (flow_stage_id null) get no visit, matching the real trigger's guard.
    afterWrite: [
      function recordStageVisit(row, old, context) {
        if (old === null) {
          if (row.flow_stage_id == null) return
          context.rowsOf("sor_stage_visits").push({
            id: crypto.randomUUID(),
            opportunity_id: row.id,
            flow_stage_id: row.flow_stage_id,
            flow_snapshot_id: row.flow_snapshot_id ?? null,
            sequence: 1,
            entered_at: row.created_at ?? new Date().toISOString(),
            entered_by: row.registered_by ?? null,
            left_at: null,
            left_by: null,
          })
          return
        }

        if (row.flow_stage_id === old.flow_stage_id) return

        const visits = context.rowsOf("sor_stage_visits")
        const now = new Date().toISOString()
        for (const visit of visits) {
          if (visit.opportunity_id === row.id && visit.left_at == null) {
            visit.left_at = now
          }
        }

        if (row.flow_stage_id != null) {
          const nextSequence =
            Math.max(0, ...visits.filter((v) => v.opportunity_id === row.id).map((v) => v.sequence)) + 1
          visits.push({
            id: crypto.randomUUID(),
            opportunity_id: row.id,
            flow_stage_id: row.flow_stage_id,
            flow_snapshot_id: row.flow_snapshot_id ?? null,
            sequence: nextSequence,
            entered_at: now,
            entered_by: null,
            left_at: null,
            left_by: null,
          })
        }
      },
      // 20260925000000_stage_participants.sql — close_stage_participant_windows(),
      // fired on the same update-of-flow_stage_id as recordStageVisit above.
      // Closes every open sor_stage_participants row whose rule this move
      // satisfies; a move into a Terminal Stage closes all of them at once.
      function closeStageParticipantWindows(row, old, context) {
        if (old === null) return
        if (row.flow_stage_id === old.flow_stage_id) return

        const stages = context.rowsOf("flow_stages")
        const toStage = stages.find((s) => s.id === row.flow_stage_id)
        const isTerminalMove = Boolean(toStage?.is_terminal)

        const visits = context.rowsOf("sor_stage_visits")
        const now = new Date().toISOString()

        for (const participant of context.rowsOf("sor_stage_participants")) {
          if (participant.opportunity_id !== row.id) continue
          if (participant.closed_at != null) continue

          if (isTerminalMove) {
            participant.closed_at = now
            participant.closed_reason = "terminal"
            continue
          }

          const openedVisit = visits.find((v) => v.id === participant.opened_visit_id)
          const callingStageId = openedVisit?.flow_stage_id ?? null

          const closes = windowClosesOnMove(
            {
              untilRule: participant.until_rule,
              untilStageId: participant.until_stage_id,
              callingStageId,
            },
            { fromStageId: old.flow_stage_id, toStageId: row.flow_stage_id },
          )

          if (closes) {
            participant.closed_at = now
            participant.closed_reason = "rule_met"
          }
        }
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

  costing_tender_lines: {
    afterWrite: [(row, old, context) => clearEvaluationApproval("costing_tender_lines", row, old, context)],
  },

  costing_tender_line_prices: {
    afterWrite: [logFinalOfferChange],
  },

  costing_components: {
    beforeInsert: [requireDeviationNote],
    beforeUpdate: [requireDeviationNote, nullFillMark("offer_specification_from_offer_id", "offer_specification")],
    afterWrite: [(row, old, context) => clearEvaluationApproval("costing_components", row, old, context)],
  },

  costing_component_costs: {
    beforeUpdate: [nullFillMark("acquire_from_offer_id", "acquire_unit")],
  },

  sor_canvasses: {
    beforeInsert: [assignCanvassNumber, requireOneCanvassSubject],
    beforeUpdate: [requireOneCanvassSubject, keepCanvassNumber],
    afterWrite: [clearOnReasonChange],
  },

  sor_canvass_signoff_events: {
    beforeUpdate: [refuseHistoryEdit],
  },

  sor_canvass_offer_prices: {
    beforeInsert: [(row, context) => refusePhpRate(row, context)],
    beforeUpdate: [(row, old, context) => refusePhpRate(row, context)],
    afterWrite: [clearOnPriceChange],
  },

  sor_canvass_offers: {
    beforeUpdate: [refuseRateOnPhpOffer],
    afterWrite: [clearOnOfferChange],
  },

  // costing_inclusions: costing_inclusion_needs_bundle() (20261018110000_costing_matrix_components.sql,
  // #268). An Inclusion sits under a bundle Component, only. It does not depend on who the
  // caller is, so it is mirrored; the band triggers (who may write which column) are not and
  // belong to the policy tier (79-costing-components.test.js).
  costing_inclusions: {
    beforeInsert: [requireBundleParent],
    beforeUpdate: [
      function requireBundleParentOnMove(row, old, context) {
        if (row.component_id !== old.component_id) requireBundleParent(row, context)
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
