import { supabase } from "../lib/supabase";
import { IPAS_STATE } from "../constants/ipas";
import { buildBuyerTrack } from "../utils/ipasDocuments";
import { deriveTransmittalTrack } from "../utils/ipasTransmittals";
import { orderStanding } from "../utils/orderStanding";
import { orderStandingInput, submittedSlips } from "../utils/orderAgeing";
import { ipasService } from "./ipasService";
import { orderAgeingRulesService } from "./orderAgeingRulesService";

/**
 * Where an SOR's own orders stand (#265, spec #261). The SOR's IPAS summary
 * (`ipasService.summariesForSor`, unchanged) gains five fields per row, computed
 * here by the same pure `orderStanding` the Order Monitoring page calls, with
 * the same ageing rules, so the two always agree:
 *
 *   nextThing    the one next thing ("Delivered — no Transmittal raised")
 *   owner        who owes it (an ORDER_OWNER key), or null when filed/cancelled
 *   daysWaiting  whole Asia/Manila days it has waited, or null
 *   late         true once it has waited past its step's rule
 *
 * The facts orderStanding needs (dates, each Transmittal's stages and ratings)
 * come from `ipas_standing_for_sor`, which gives the SOR's readers dates and
 * ratings only: never money, a bank detail, a remark or a picture.
 *
 * Self-contained: the PMS page takes the SOR's IPAS section over in build
 * step 5 and can call this as it is.
 */

/** The statuses `buildBuyerTrack` reads, taken from the summary's own ticks. */
function odooStatusesOf(summary) {
  const item = (key) => summary.buyerTrack.find((entry) => entry.key === key);
  return {
    purchaseOrder: { ticked: Boolean(item("purchase_order")?.ticked) },
    receivedInOdoo: { ticked: Boolean(item("received_in_odoo")?.ticked), partial: Boolean(item("received_in_odoo")?.partial) },
    createBill: { ticked: Boolean(item("create_bill")?.ticked) },
  };
}

function standingOf(summary, facts, rules, today) {
  if (!facts || summary.state === IPAS_STATE.CANCELLED) {
    return { nextThing: null, owner: null, daysWaiting: null, late: false };
  }
  const named = facts.slips ?? [];
  const derived = deriveTransmittalTrack(submittedSlips(named), {
    deliveredOn: facts.delivered_on,
    actualCheckingBy: facts.actual_checking_stamped,
    actualCheckingAt: facts.actual_checking_at,
  });
  const buyerTrack = buildBuyerTrack(
    {
      source: facts.source,
      import_clearance_on: facts.import_clearance_on,
      delivered_on: facts.delivered_on,
      actual_checking_by: facts.actual_checking_stamped ? "stamped" : null,
      actual_checking_at: facts.actual_checking_at,
    },
    odooStatusesOf(summary),
    {
      hasProof: Boolean(summary.buyerTrack.find((entry) => entry.key === "with_pop")?.ticked),
      transmittal: derived.governed ? derived : null,
    },
  );
  const standing = orderStanding(
    orderStandingInput({
      id: summary.id,
      state: summary.state,
      source: facts.source,
      createdAt: facts.created_at,
      updatedAt: facts.updated_at,
      computationStatus: summary.computationStatus,
      costsCompletedAt: facts.costs_completed_at,
      buyerTrack,
      proofPaidOn: facts.proof_paid_on,
      arrivedInPhOn: facts.arrived_in_ph_on,
      origins: facts,
      slips: named,
    }),
    rules,
    today,
  );
  return {
    nextThing: standing.next.label,
    owner: standing.next.owner,
    daysWaiting: standing.daysWaiting,
    late: standing.late,
  };
}

export const ipasSorStandingService = {
  /**
   * The Project IPAS naming an SOR, as `ipasService.summariesForSor` gives
   * them, each with `nextThing`, `owner`, `daysWaiting` and `late`. `today` is
   * the day waits are counted to (Asia/Manila), defaulting to now. No SOR
   * access is an empty list. Never calls Odoo.
   */
  async summariesForSor(opportunityId, { today = new Date() } = {}) {
    if (!opportunityId) return [];
    const summaries = await ipasService.summariesForSor(opportunityId);
    if (summaries.length === 0) return [];

    const [{ data, error }, rules] = await Promise.all([
      supabase.rpc("ipas_standing_for_sor", { p_opportunity_id: opportunityId }),
      orderAgeingRulesService.getRules(),
    ]);
    if (error) throw error;
    const factsById = new Map((data ?? []).map((row) => [row.ipas_id, row]));

    return summaries.map((summary) => ({
      ...summary,
      ...standingOf(summary, factsById.get(summary.id), rules, today),
    }));
  },
};
