import { IPAS_STATE_LABELS } from "../constants/ipas";
import { TRANSMITTAL_STATE_LABELS } from "../constants/transmittals";

/**
 * The order-side Stage Conditions' evaluator, one module for both kinds (#465, #466, ADR 0033).
 *
 * A Transmittal is per slip and an IPAS is per Odoo PO, so neither can mount on a Stage. These
 * conditions let a Stage ask about them anyway, through `order_condition_inputs(opportunity)`:
 * counts the database worked out, plus each counted record's number and state (no peso figure,
 * nothing else of a record the mover may not read).
 *
 *   goods_checked  slips named, and     at least one submitted, uncancelled Transmittal has a
 *                  unclosed_slips = 0   line naming the SOR, and every one is Closed. Drafts
 *                                       don't count. A line rated NA doesn't stop it: the
 *                                       replacement rides a new slip that must itself close.
 *   orders_filed   orders named, and    at least one uncancelled IPAS names the SOR, and every
 *                  unfiled_orders = 0   one is filed (section 7 approved).
 *
 * Putting the condition on a Stage is what says the Stage needs the record, so none at all leaves
 * it unmet, the way the costing kinds wait for an S0 Evaluation: nothing is ticked without a basis.
 * Either way `basis` lists the records, for the Stage Checklist to name.
 */

export const ORDER_CONDITION_KINDS = ["goods_checked", "orders_filed"];

export const isOrderKind = (kind) => ORDER_CONDITION_KINDS.includes(kind);

const count = (n) => Number(n) || 0;
const plural = (n, one, many) => (n === 1 ? one : many);
const listOf = (records) => (Array.isArray(records) ? records : []);

const check = (records, openCount, noneKey, openKey) => {
  if (listOf(records).length === 0) return { met: false, failing: [noneKey] };
  return count(openCount) === 0 ? { met: true, failing: [] } : { met: false, failing: [openKey] };
};

export const EVALUATORS = {
  goods_checked: (inputs) => check(inputs?.slips, inputs?.unclosed_slips, "no_slips", "slips_not_closed"),
  orders_filed: (inputs) => check(inputs?.orders, inputs?.unfiled_orders, "no_orders", "orders_not_filed"),
};

/** Each kind's records as `{ number, state }` lines for the checklist, state in its screen's words. */
const BASIS = {
  goods_checked: (inputs) => listOf(inputs?.slips).map((s) => ({ number: s.number, state: TRANSMITTAL_STATE_LABELS[s.state] ?? s.state })),
  orders_filed: (inputs) => listOf(inputs?.orders).map((o) => ({ number: o.number, state: IPAS_STATE_LABELS[o.state] ?? o.state })),
};

/** Plain words per failing check, given the evidence (for the counts). */
export const WORDING = {
  no_slips: () => "No Transmittal names this SOR yet.",
  slips_not_closed: (i) => {
    const n = count(i?.unclosed_slips);
    return `${n} ${plural(n, "Transmittal naming this SOR is", "Transmittals naming this SOR are")} not Closed yet.`;
  },
  no_orders: () => "No IPAS names this SOR yet.",
  orders_not_filed: (i) => {
    const n = count(i?.unfiled_orders);
    return `${n} ${plural(n, "IPAS naming this SOR is", "IPAS naming this SOR are")} not filed yet.`;
  },
};

/** The failing checks as plain sentences. */
export function describeFailing(failing, inputs) {
  return (failing ?? []).map((key) => (WORDING[key] ? WORDING[key](inputs) : key));
}

/**
 * Evaluate one order-side condition. `inputs` undefined = nobody loaded it: fail closed with a
 * reason a person can act on.
 * Returns `{ met, failing: string[] (keys), messages: string[] (plain words), basis: { number, state }[] }`.
 */
export function evaluateOrderCondition(kind, inputs) {
  const evaluator = EVALUATORS[kind];
  if (!evaluator) return { met: false, failing: [], messages: [], basis: [] };
  if (inputs === undefined) {
    return { met: false, failing: [], messages: ["The SOR's Transmittals and orders could not be checked."], basis: [] };
  }
  const { met, failing } = evaluator(inputs);
  return { met, failing, messages: describeFailing(failing, inputs), basis: BASIS[kind](inputs) };
}
