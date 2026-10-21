/**
 * The Supplier bill check in words (spec #595, ticket #603): the Odoo PO total
 * against the P.I/QT Amount, read from the figures module's `billCheck`. The
 * record's money summary, the section 1 approval warning and the Approval
 * Center's IPAS review all say it through here, so they never disagree.
 *
 * It warns and never blocks: `warning` is a sentence for the approve action,
 * or null when there is nothing to warn about.
 */

import { IPAS_BILL_CHECK } from "./ipasFigures";
import { formatAmount } from "./ipas";

/** What the check came to, for the view. */
export const BILL_CHECK_KIND = Object.freeze({
  MATCHES: "matches",
  DIFFERS: "differs",
  /** The P.I/QT Amount is blank. */
  NOT_TYPED: "not_typed",
  /** An old Odoo copy states no total: its figure is before tax, so no mismatch is claimed. */
  BEFORE_TAX: "before_tax",
  /** A P.I/QT Amount is typed but the copy has no Odoo figure at all. */
  NO_PO: "no_po",
});

/**
 * @param {object} figures  `ipasFigures(ipas)`
 * @returns {{ kind: string, verdict: string, poText: string, piText: string, warning: string|null }}
 *   verdict  the line under the two amounts: "Matches the Odoo PO", "P.I is ₱5,000.00 more than the Odoo PO", …
 *   poText / piText  the two amounts as shown ("—" when there is none)
 *   warning  the sentence beside section 1's approve action; null when none
 */
export function billCheckView(figures) {
  const { currency, piAmount, poTotal, billCheck } = figures ?? {};
  const money = (value) => (value === null || value === undefined ? "—" : formatAmount(value, currency));
  const poText = money(poTotal);
  const piText = money(piAmount);
  const base = { poText, piText };

  if (piAmount === null || piAmount === undefined) {
    return {
      ...base,
      kind: BILL_CHECK_KIND.NOT_TYPED,
      verdict: "P.I/QT Amount not typed yet",
      warning: "Supplier bill check: the P.I/QT Amount is not typed yet, so it was not compared with the Odoo PO.",
    };
  }
  if (poTotal === null || poTotal === undefined) {
    return { ...base, kind: BILL_CHECK_KIND.NO_PO, verdict: "Odoo PO total not available", warning: null };
  }
  if (billCheck?.poBeforeTax) {
    return {
      ...base,
      kind: BILL_CHECK_KIND.BEFORE_TAX,
      verdict: "Odoo PO figure is before tax (older copy), so it can't be compared with the P.I",
      warning: null,
    };
  }
  if (billCheck?.status === IPAS_BILL_CHECK.MATCHES) {
    return { ...base, kind: BILL_CHECK_KIND.MATCHES, verdict: "Matches the Odoo PO", warning: null };
  }

  const difference = billCheck?.difference ?? piAmount - poTotal;
  const gap = formatAmount(Math.abs(difference), currency);
  const direction = difference > 0 ? "more" : "less";
  return {
    ...base,
    kind: BILL_CHECK_KIND.DIFFERS,
    verdict: `P.I is ${gap} ${direction} than the Odoo PO`,
    warning: `Supplier bill check: the P.I is ${gap} ${direction} than the Odoo PO (${piText} against ${poText}).`,
  };
}
