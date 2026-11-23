import { IPAS_REQUEST_SECTION, IPAS_STATE, IPAS_STATUS, IPAS_STATUS_LABELS, ipasStatusesFor } from "../constants/ipas";

/**
 * What the IPAS already knows that matches a later status step (#1155, ADR 0054). It only suggests:
 * nothing here moves the status; the page's button does, on a click.
 *
 * Facts, from the record the page already loads:
 *   section 1 has a live Prepared            -> Payment Approval
 *   the P.I document holds a file and the P.I/QT Amount is typed -> Payment Approval
 *     (a Local order's Quotation document plays the P.I; #1191)
 *   the Odoo copy's PO is purchase or done   -> Ordered
 *   Odoo reports the goods received, or a submitted Transmittal names the IPAS -> Delivered
 *     (on a Direct delivery only the Odoo receipt counts)
 *
 * Only the furthest matching step is returned, and only when it comes after the current step. Returns
 * `{ step, label, because }` or null. `because` is the plain sentence that leads the question.
 *
 *   ipas  the shaped IPAS: `state`, `source`, `status`, `statuses` (Odoo), `signoffSections`, `slips`,
 *         `direct_delivery` (#1158; absent reads as false)
 */
const piLabel = (label) => /proforma|^p\.?i(\s|$)/i.test(String(label ?? "").trim());
const quotationLabel = (label) => /quotation/i.test(String(label ?? ""));

/** Whether the P.I (Import) or the Quotation (Local) holds a file and the P.I/QT Amount is typed. */
function piIsIn(ipas) {
  const amount = ipas.pi_qt_amount ?? ipas.piQtAmount;
  if (amount === null || amount === undefined || amount === "" || !Number.isFinite(Number(amount))) return false;
  const isLabel = ipas.source === "local" ? quotationLabel : piLabel;
  return (ipas.documents ?? []).some((doc) => doc?.hasFile && isLabel(doc.label));
}

export function suggestStatus(ipas) {
  if (!ipas || ipas.state !== IPAS_STATE.OPEN || !ipas.status) return null;
  const steps = ipasStatusesFor(ipas.source);
  const current = steps.indexOf(ipas.status);
  if (current < 0) return null;

  const direct = ipas.direct_delivery === true;
  const odoo = ipas.statuses ?? {};
  const matches = [];
  if (ipas.signoffSections?.[IPAS_REQUEST_SECTION]?.prepared) {
    matches.push({ step: IPAS_STATUS.PAYMENT_APPROVAL, because: "Section 1 is prepared." });
  }
  if (piIsIn(ipas)) {
    matches.push({ step: IPAS_STATUS.PAYMENT_APPROVAL, because: "The P.I and its amount are in." });
  }
  if (odoo.purchaseOrder?.ticked) {
    matches.push({ step: IPAS_STATUS.ORDERED, because: "Odoo says this PO is confirmed." });
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
