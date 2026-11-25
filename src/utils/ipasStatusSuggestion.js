import { IPAS_STATE, IPAS_STATUS, IPAS_STATUS_LABELS, ipasStatusesFor } from "../constants/ipas";

/**
 * What the IPAS already knows that matches a later status step (#1155, ADR 0054). It only suggests:
 * nothing here moves the status; the page's button does, on a click.
 *
 * Facts, from the record the page already loads:
 *   the Odoo copy's PO is purchase or done   -> Ordered
 *   a payment was recorded that closed an ask for payment (#1209) -> Ordered
 *   Odoo reports the goods received, or a submitted Transmittal names the IPAS -> Delivered
 *     (on a Direct delivery only the Odoo receipt counts)
 *
 * Only the furthest matching step is returned, and only when it comes after the current step. Returns
 * `{ step, label, because }` or null. `because` is the plain sentence that leads the question.
 *
 *   ipas  the shaped IPAS: `payment_asks`, `state`, `source`, `status`, `statuses` (Odoo), `slips`,
 *         `direct_delivery` (#1158; absent reads as false)
 */
export function suggestStatus(ipas) {
  if (!ipas || ipas.state !== IPAS_STATE.OPEN || !ipas.status) return null;
  const steps = ipasStatusesFor(ipas.source);
  const current = steps.indexOf(ipas.status);
  if (current < 0) return null;

  const direct = ipas.direct_delivery === true;
  const odoo = ipas.statuses ?? {};
  const matches = [];
  if (odoo.purchaseOrder?.ticked) {
    matches.push({ step: IPAS_STATUS.ORDERED, because: "Odoo says this PO is confirmed." });
  }
  // #1209: a recorded payment closed an ask (closed_reason 'paid') -> Ordered. A withdrawn ask says nothing.
  if ((ipas.payment_asks ?? []).some((ask) => ask?.closed_at && ask.closed_reason === "paid")) {
    matches.push({ step: IPAS_STATUS.ORDERED, because: "A payment was recorded against the ask." });
  }
  if (odoo.receivedInOdoo?.ticked) {
    matches.push({ step: IPAS_STATUS.DELIVERED, because: "Odoo says the goods are received." });
  } else if (!direct && (ipas.slips ?? []).length > 0) {
    matches.push({ step: IPAS_STATUS.DELIVERED, because: "A Transmittal names this IPAS." });
  }

  const best = matches
    .filter((match) => steps.indexOf(match.step) > current)
    .sort((a, b) => steps.indexOf(b.step) - steps.indexOf(a.step))[0];
  return best ? { ...best, label: IPAS_STATUS_LABELS[best.step] } : null;
}
