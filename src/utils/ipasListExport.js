/**
 * What the IPAS list offers beyond its rows (spec #595, ticket #599): the
 * built-in views, the per-currency totals and the Excel export. Pure: every
 * money figure is read from `row.figures` (utils/ipasFigures.js) and nothing is
 * worked out here but sums.
 *
 * Currencies are never added together: totals are kept per currency, and the
 * export writes each amount as a number in its own currency's format.
 */

import { IPAS_STATE, IPAS_STATUS, IPAS_STATUS_LABELS } from "../constants/ipas";
import { formatDate } from "./formatDate.js";
import { raisedByParts, sorLineParts } from "./ipas";

/** The list's built-in views (a view narrows the rows; null is no view). */
export const IPAS_VIEW = Object.freeze({
  UNPAID: "unpaid",
  ON_HOLD: "on_hold",
  ONGOING: "ongoing",
  MINE: "mine",
});

export const IPAS_VIEW_LABELS = {
  [IPAS_VIEW.UNPAID]: "Unpaid",
  [IPAS_VIEW.ON_HOLD]: "On-Hold",
  [IPAS_VIEW.ONGOING]: "Ongoing",
  [IPAS_VIEW.MINE]: "Raised by me",
};

/**
 * Whether a row belongs to a view. Unpaid is the open IPAS that are not yet
 * Paid (Done is a filed one, so it is never open); On-Hold and Ongoing are that
 * IPAS Status; Raised by me is the IPAS the signed-in employee raised.
 */
export function inIpasView(row, view, userId) {
  switch (view) {
    case IPAS_VIEW.UNPAID:
      return row.state === IPAS_STATE.OPEN && row.figures?.status !== IPAS_STATUS.PAID && row.figures?.status !== IPAS_STATUS.DONE;
    case IPAS_VIEW.ON_HOLD:
      return row.figures?.status === IPAS_STATUS.ON_HOLD;
    case IPAS_VIEW.ONGOING:
      return row.figures?.status === IPAS_STATUS.ONGOING;
    case IPAS_VIEW.MINE:
      return Boolean(userId) && row.created_by === userId;
    default:
      return true;
  }
}

const toCents = (n) => Math.round(n * 100);

/**
 * Amount and Remaining balance totals for the rows shown, one entry per
 * currency, in the order each currency first appears:
 * [{ currency, amount, remainingBalance, count }]. A row with no figure adds
 * nothing to that total. `currency` is null for a PO whose currency is unknown.
 */
export function ipasTotalsByCurrency(rows) {
  const byCurrency = new Map();
  for (const row of rows) {
    const { currency = null, amount, remainingBalance } = row.figures ?? {};
    const key = currency ?? null;
    if (!byCurrency.has(key)) byCurrency.set(key, { currency: key, amountCents: 0, remainingCents: 0, count: 0 });
    const total = byCurrency.get(key);
    total.count += 1;
    if (amount !== null && amount !== undefined) total.amountCents += toCents(amount);
    if (remainingBalance !== null && remainingBalance !== undefined) total.remainingCents += toCents(remainingBalance);
  }
  return [...byCurrency.values()].map(({ currency, amountCents, remainingCents, count }) => ({
    currency,
    amount: amountCents / 100,
    remainingBalance: remainingCents / 100,
    count,
  }));
}

/** The export's columns, in the Google Sheet's order. */
export const IPAS_EXPORT_HEADER = [
  "IPAS No.",
  "Date",
  "Created By",
  "Project / SO No.",
  "Supplier",
  "P.O No.",
  "Amount",
  "Payment Scheme",
  "Down Payment",
  "Full Payment",
  "Remaining Balance",
  "Status",
];

/** An Excel number format showing the currency's symbol the way the list does. */
export function currencyNumberFormat(currency) {
  let symbol = currency ? String(currency) : "";
  try {
    if (currency) {
      const parts = new Intl.NumberFormat("en-PH", { style: "currency", currency: String(currency).toUpperCase() }).formatToParts(0);
      symbol = parts.find((p) => p.type === "currency")?.value ?? symbol;
    }
  } catch {
    // An Odoo currency name that isn't an ISO code: the name itself is the label.
  }
  const quoted = symbol ? `"${symbol.replace(/"/g, "")}${/^[A-Za-z]+$/.test(symbol) ? " " : ""}"` : "";
  return `${quoted}#,##0.00;-${quoted}#,##0.00`;
}

const money = (value, currency) =>
  value === null || value === undefined ? null : { value, format: currencyNumberFormat(currency) };

/** A payment total: blank when none was recorded, as the list shows a dash. */
const paymentMoney = (value, currency) => (value > 0 ? money(value, currency) : null);

/**
 * The sheet rows for the IPAS shown, in the order given. Only what the list
 * itself shows: no bank details, no Odoo lines, no notes.
 */
export function ipasExportRows(rows) {
  return rows.map((row) => {
    const f = row.figures;
    const raisedBy = raisedByParts(row);
    const projects = row.sors
      .map((sor) => {
        const { reference, project } = sorLineParts(sor);
        return [reference, project].filter(Boolean).join(" · ");
      })
      .filter(Boolean)
      .join("; ");
    return [
      row.number,
      row.created_at ? formatDate(row.created_at) : null,
      raisedBy ? (raisedBy.callSign ? `${raisedBy.callSign} · ${raisedBy.name}` : raisedBy.name) : null,
      projects || null,
      row.supplier || null,
      row.po_number || null,
      money(f.amount, f.currency),
      f.paymentScheme || null,
      paymentMoney(f.downPayment, f.currency),
      paymentMoney(f.fullPayment, f.currency),
      money(f.remainingBalance, f.currency),
      f.status ? IPAS_STATUS_LABELS[f.status] : null,
    ];
  });
}
