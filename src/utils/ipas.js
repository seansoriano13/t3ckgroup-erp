/**
 * Pure helpers for the IPAS (spec #241). No network, no React.
 */

import { IPAS_PURPOSE } from "../constants/ipas";

// A Sales Reference is Odoo's "S" and digits (SALES_REFERENCE_PATTERN). Odoo
// has no link between a PO and its sale order, so the PO's Source Document and
// its analytic account names are free text with S numbers somewhere inside:
// "S07920 Capas  Municipal Government", "1pc S06070 Las Nieves & 1pc S04602 …".
const SALES_REFERENCE_IN_TEXT = /\bS\d+\b/gi;

/** Every Sales Reference mentioned in the given text, upper-cased, once each, in order. */
export function parseSalesReferences(...texts) {
  const seen = new Set();
  for (const text of texts.flat()) {
    if (typeof text !== "string") continue;
    for (const match of text.matchAll(SALES_REFERENCE_IN_TEXT)) seen.add(match[0].toUpperCase());
  }
  return [...seen];
}

/**
 * The Sales References an Odoo copy mentions, and where: its Source Document
 * and its lines' analytic account names. `{ [reference]: ["origin", "analytic"] }`.
 */
export function salesReferencesIn(copy) {
  const found = new Map();
  const note = (reference, where) => {
    const places = found.get(reference) ?? [];
    if (!places.includes(where)) places.push(where);
    found.set(reference, places);
  };
  for (const reference of parseSalesReferences(copy?.po?.origin)) note(reference, "origin");
  for (const line of copy?.lines ?? []) {
    for (const reference of parseSalesReferences(line?.analytic ?? [])) note(reference, "analytic");
  }
  return Object.fromEntries(found);
}

/** The entity an IPAS is booked to: the Odoo PO's company. */
export const ipasEntity = (row) => row?.odoo_copy?.po?.company || null;

/** The PO's currency (a code, "Php", "USD"), or null. */
export const ipasCurrency = (row) => row?.odoo_copy?.po?.currency || null;

/** The supplier's name from the stored copy, or null. */
export const ipasSupplier = (row) => row?.odoo_copy?.supplier?.name || null;

/** Whether the PO was cancelled in Odoo; the IPAS stays open until Purchasing cancels it. */
export const isPoCancelledInOdoo = (row) => row?.odoo_copy?.po?.state === "cancel";

/**
 * An IPAS row as the screens read it: the stored row plus what comes out of its
 * Odoo copy and its SORs. `sors` is `ipas_sor_headers` rows for this IPAS.
 */
export function shapeIpas(row, sors = []) {
  if (!row) return null;
  const copy = row.odoo_copy ?? {};
  return {
    ...row,
    entity: ipasEntity(row),
    supplier: ipasSupplier(row),
    currency: ipasCurrency(row),
    lines: Array.isArray(copy.lines) ? copy.lines : [],
    poState: copy.po?.state ?? null,
    poCancelledInOdoo: isPoCancelledInOdoo(row),
    sors: sors.map((s) => ({
      id: s.opportunity_id,
      salesReference: s.sales_reference,
      projectTitle: s.project_title,
      clientName: s.client_name,
    })),
    isProject: row.purpose === IPAS_PURPOSE.PROJECT,
  };
}

/** A database error's message without the RPC's own name in front of it. */
export function ipasErrorMessage(error, fallback = "Something went wrong.") {
  const raw = error?.message;
  if (!raw || typeof raw !== "string") return fallback;
  return raw.replace(/^ipas_[a-z_]+:\s*/i, "");
}

/**
 * The IPAS list's slices over shaped rows. `state` is a lifecycle state or
 * "all"; `entity` and `purpose` are exact; `search` matches the number, PO,
 * supplier and SOR references and titles.
 */
export function filterIpas(rows, { state = "all", entity = null, purpose = null, search = "" } = {}) {
  const term = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (state !== "all" && row.state !== state) return false;
    if (entity && row.entity !== entity) return false;
    if (purpose && row.purpose !== purpose) return false;
    if (!term) return true;
    const haystack = [
      row.number,
      row.po_number,
      row.supplier,
      ...row.sors.flatMap((s) => [s.salesReference, s.projectTitle]),
    ];
    return haystack.some((field) => field?.toLowerCase().includes(term));
  });
}

/**
 * An amount in the PO's currency ("Php", "USD"). Never throws on an unknown
 * code: it falls back to the number with the code beside it.
 */
export function formatAmount(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  try {
    if (currency) {
      return new Intl.NumberFormat("en-PH", { style: "currency", currency: String(currency).toUpperCase() }).format(n);
    }
  } catch {
    // An Odoo currency name that isn't an ISO code.
  }
  const plain = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return currency ? `${currency} ${plain}` : plain;
}

/** The distinct analytic account names across an Odoo copy's lines, in order. */
export function analyticNames(copy) {
  return [...new Set((copy?.lines ?? []).flatMap((line) => line?.analytic ?? []).filter(Boolean))];
}
