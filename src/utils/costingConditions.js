import { costingEvaluationApproved, costingPriced, costingSettled } from "./costingMath";

/**
 * The costing Stage Conditions' evaluator, one module for every costing kind (#272, #463).
 *
 * Evidence is `costing_condition_inputs(opportunity)`: booleans and counts the database worked
 * out (no peso figure). Each kind is a pure function of that evidence returning
 * `{ met, failing }`; `describeFailing` words the failing checks for the Stage checklist. A new
 * kind (Costing priced, #463) adds an entry to EVALUATORS and to WORDING, and its keys to the SQL.
 */

export const COSTING_CONDITION_KINDS = ["costing_settled", "costing_priced", "costing_evaluation_approved"];

export const isCostingKind = (kind) => COSTING_CONDITION_KINDS.includes(kind);

export const EVALUATORS = {
  costing_settled: costingSettled,
  costing_priced: costingPriced,
  costing_evaluation_approved: costingEvaluationApproved,
};

const plural = (n, one, many) => (n === 1 ? one : many);

/** Plain words per failing check, given the evidence (for counts and the Bid verdict). */
export const WORDING = {
  no_matrix: () => "No Costing Matrix has been opened for this SOR.",
  not_settled: () => "Costing not settled.",
  no_tender_lines: () => "The Costing Matrix has no Tender Lines.",
  missing_final_offer: (i) => {
    const n = Number(i?.missing_offer) || 0;
    return `${n} Tender ${plural(n, "Line has", "Lines have")} no Final Offer.`;
  },
  incomplete_summary: (i) => {
    const costed = Number(i?.costed_rows) || 0;
    const n = Number(i?.missing_cost) || 0;
    return costed === 0
      ? "The summary is incomplete: there is nothing costed yet."
      : `The summary is incomplete: ${n} ${plural(n, "row has", "rows have")} no Final Acquire.`;
  },
  evaluation_not_approved: () => "The Evaluation of Specification is not approved.",
  over_abc: () => "The Final Offer total is over the ABC total.",
  no_components: () => "The Costing Matrix has no Components.",
  missing_acquire: (i) => {
    const n = Number(i?.missing_acquire) || 0;
    return `${n} ${plural(n, "row has", "rows have")} no Acquire unit cost.`;
  },
  no_purchasing_incharge: () => "No Purchasing Incharge is named on the Costing Matrix.",
  bid_not_go: (i) =>
    i?.bid_verdict === "no_go"
      ? "The Bid Decision is No-go."
      : i?.bid_verdict === "revise"
        ? "The Bid Decision is Revise."
        : "There is no Bid Decision yet.",
};

/** The failing checks as plain sentences. */
export function describeFailing(failing, inputs) {
  return (failing ?? []).map((key) => (WORDING[key] ? WORDING[key](inputs) : key));
}

/**
 * Evaluate one costing condition. `inputs` undefined = nobody loaded it: fail closed with a
 * reason a person can act on.
 * Returns `{ met, failing: string[] (keys), messages: string[] (plain words) }`.
 */
export function evaluateCostingCondition(kind, inputs) {
  const evaluator = EVALUATORS[kind];
  if (!evaluator) return { met: false, failing: [], messages: [] };
  if (inputs === undefined) {
    return { met: false, failing: [], messages: ["The Costing Matrix could not be checked."] };
  }
  const { met, failing } = evaluator(inputs);
  return { met, failing, messages: describeFailing(failing, inputs) };
}
