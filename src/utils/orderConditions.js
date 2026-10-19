/**
 * The order-side Stage Conditions' evaluator, one module for both kinds (#465, #466, ADR 0033).
 *
 * A Transmittal is per slip and an IPAS is per Odoo PO, so neither can mount on a Stage. These
 * conditions let a Stage ask about them anyway, through `order_condition_inputs(opportunity)`:
 * counts the database worked out (no peso figure, no record the mover may not read).
 *
 *   goods_checked  unclosed_slips = 0   every submitted, uncancelled Transmittal with a line
 *                                       naming the SOR is Closed. Drafts don't count. No
 *                                       Transmittal at all meets it. A line rated NA doesn't
 *                                       stop it: the replacement rides a new slip that must
 *                                       itself close.
 */

export const ORDER_CONDITION_KINDS = ["goods_checked"];

export const isOrderKind = (kind) => ORDER_CONDITION_KINDS.includes(kind);

const count = (n) => Number(n) || 0;
const plural = (n, one, many) => (n === 1 ? one : many);

export const EVALUATORS = {
  goods_checked: (inputs) => (count(inputs?.unclosed_slips) === 0 ? { met: true, failing: [] } : { met: false, failing: ["slips_not_closed"] }),
};

/** Plain words per failing check, given the evidence (for the counts). */
export const WORDING = {
  slips_not_closed: (i) => {
    const n = count(i?.unclosed_slips);
    return `${n} ${plural(n, "Transmittal naming this SOR is", "Transmittals naming this SOR are")} not Closed yet.`;
  },
};

/** The failing checks as plain sentences. */
export function describeFailing(failing, inputs) {
  return (failing ?? []).map((key) => (WORDING[key] ? WORDING[key](inputs) : key));
}

/**
 * Evaluate one order-side condition. `inputs` undefined = nobody loaded it: fail closed with a
 * reason a person can act on.
 * Returns `{ met, failing: string[] (keys), messages: string[] (plain words) }`.
 */
export function evaluateOrderCondition(kind, inputs) {
  const evaluator = EVALUATORS[kind];
  if (!evaluator) return { met: false, failing: [], messages: [] };
  if (inputs === undefined) {
    return { met: false, failing: [], messages: ["The SOR's Transmittals and orders could not be checked."] };
  }
  const { met, failing } = evaluator(inputs);
  return { met, failing, messages: describeFailing(failing, inputs) };
}
