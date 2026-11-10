// When "1 · Order" and "2 · Payments" are done, in one place (#923). The section rows read
// these through the digest; the proof rule is the same one the rail's "Attach the files" step
// uses (paymentsLackingProof via missingDocumentsByPart), so they never disagree.

import { paymentsLackingProof } from "@/utils/ipasDocuments";
import { isPhpCurrency } from "@/utils/landedCost";

const filled = (value) => value !== null && value !== undefined && String(value).trim() !== "";

/** Order is done when Supplier's name, P.I # and P.I/QT Amount are all filled. */
export function orderProgress(ipas) {
  const missing = [
    !filled(ipas?.contact) && "Supplier's name",
    !filled(ipas?.piNumber) && "P.I #",
    !filled(ipas?.piQtAmount) && "P.I/QT Amount",
  ].filter(Boolean);
  return { done: missing.length === 0, missing, detail: missing.length === 0 ? "Filled in" : `Needs ${missing.join(", ")}` };
}

/** Payments is done when every payment has its proof (and, on a foreign PO, its Forex Rate Paid). */
export function paymentsProgress(ipas) {
  const payments = ipas?.payments ?? [];
  const foreign = !isPhpCurrency(ipas?.currency);
  const noProof = paymentsLackingProof(payments).length;
  const noRate = foreign ? payments.filter((payment) => !payment.rate).length : 0;
  const withProof = payments.length - noProof;
  const done = payments.length > 0 && noProof === 0 && noRate === 0;
  let detail = "No payments yet";
  if (payments.length > 0) {
    detail = `${withProof} of ${payments.length} with proof`;
    if (foreign && noRate > 0) detail += `, ${noRate} without Forex Rate Paid`;
  }
  return { done, total: payments.length, withProof, noRate, detail };
}
