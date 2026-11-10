/**
 * The IPAS list's Excel export (spec #595, ticket #599). Pure: every money figure is read from
 * `row.figures` (utils/ipasFigures.js) and nothing is worked out here.
 *
 * Currencies are never added together: the export writes each amount as a number in its own
 * currency's format. The list's views are in ipasListViews.js, its totals in ipasFigures.js.
 */

import { IPAS_STATUS_LABELS } from "../constants/ipas";
import { formatDate } from "./formatDate.js";
import { raisedByParts, sorLineParts } from "./ipas";

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
