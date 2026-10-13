/**
 * Pure helpers for the IPAS (spec #241). No network, no React.
 */

import {
  IPAS_OVERRIDE,
  IPAS_OVERRIDE_FIELDS,
  IPAS_PURPOSE,
  IPAS_STATE,
  IPAS_WARNING,
} from "../constants/ipas";

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

const clean = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
};

/**
 * The entity an IPAS is booked to: Purchasing's override when there is one,
 * otherwise the Odoo PO's company.
 */
export const ipasEntity = (row) => clean(row?.entity_override) || clean(row?.odoo_copy?.po?.company) || null;

/** The PO's currency (a code, "Php", "USD"), or null. */
export const ipasCurrency = (row) => row?.odoo_copy?.po?.currency || null;

/** The supplier's name from the stored copy, or null. */
export const ipasSupplier = (row) => row?.odoo_copy?.supplier?.name || null;

/** Whether the PO was cancelled in Odoo; the IPAS stays open until Purchasing cancels it. */
export const isPoCancelledInOdoo = (row) => row?.odoo_copy?.po?.state === "cancel";

/**
 * Odoo's current value of an overridable field, from the stored copy (the
 * database's `_ipas_odoo_value`): Entity is the PO's company, Source Doc. its
 * Source Document, Analytic Dist. the analytic account names on its lines.
 */
export function odooValueOf(copy, field) {
  switch (field) {
    case IPAS_OVERRIDE.ENTITY:
      return clean(copy?.po?.company);
    case IPAS_OVERRIDE.SOURCE_DOC:
      return clean(copy?.po?.origin);
    case IPAS_OVERRIDE.ANALYTIC:
      return analyticNames(copy).join(" · ") || null;
    default:
      return null;
  }
}

/**
 * Entity, Source Doc. and Analytic Dist. as `{ field, label, override, odoo,
 * value, overridden }`: `value` is what the IPAS uses, `odoo` is what Odoo
 * says now (shown beside an override).
 */
export function overridesOf(row) {
  return Object.fromEntries(
    Object.entries(IPAS_OVERRIDE_FIELDS).map(([field, { column, label }]) => {
      const override = clean(row?.[column]);
      const odoo = odooValueOf(row?.odoo_copy, field);
      return [field, { field, label, override, odoo, value: override ?? odoo, overridden: override !== null }];
    }),
  );
}

/**
 * The three statuses Odoo stamps, read from the stored copy. They are never
 * ticked by hand: there is no column to write them to. Each carries
 * `stampedFromOdoo` so the page and the print mark them.
 *   Purchase Order     the PO's state is `purchase` or `done`
 *   Received in Odoo   every receipt done; `partial` while only some are
 *   Create Bill        a vendor bill exists, drafts counting
 */
export function odooStatuses(copy) {
  const state = copy?.po?.state ?? null;

  const receipts = copy?.receipts ?? {};
  const total = Number(receipts.total) || 0;
  const doneReceipts = Number(receipts.done) || 0;
  let receivedState = "none";
  if (receipts.status === "partial") receivedState = "partial";
  else if (receipts.status === "full" || (total > 0 && doneReceipts >= total)) receivedState = "received";
  else if (doneReceipts > 0) receivedState = "partial";

  const bills = copy?.bills ?? {};
  const billCount = Number(bills.count) || 0;
  const draftBills = Number(bills.draft) || 0;

  return {
    purchaseOrder: { ticked: state === "purchase" || state === "done", state, stampedFromOdoo: true },
    receivedInOdoo: {
      ticked: receivedState === "received",
      partial: receivedState === "partial",
      receiptsDone: doneReceipts,
      receiptsTotal: total,
      stampedFromOdoo: true,
    },
    createBill: {
      ticked: billCount > 0,
      count: billCount,
      drafts: draftBills,
      draftsOnly: billCount > 0 && draftBills === billCount,
      stampedFromOdoo: true,
    },
  };
}

/**
 * Whether Odoo's S numbers (Source Document and analytic account names) differ
 * from the IPAS's SORs. Null when Odoo names none (nothing to compare) or the
 * two agree; otherwise `{ odoo, ipas, onlyInOdoo, onlyInIpas }`. It only says
 * so: nothing changes automatically.
 */
export function sorMismatch(copy, sors = []) {
  const odoo = Object.keys(salesReferencesIn(copy));
  if (odoo.length === 0) return null;
  const named = sors.map((s) => String(s.salesReference || "").toUpperCase()).filter(Boolean);
  const onlyInOdoo = odoo.filter((reference) => !named.includes(reference));
  const onlyInIpas = named.filter((reference) => !odoo.includes(reference));
  if (onlyInOdoo.length === 0 && onlyInIpas.length === 0) return null;
  return { odoo, ipas: named, onlyInOdoo, onlyInIpas };
}

/**
 * The stored change note (`ipas.odoo_change_note`) as the page reads it, or
 * null. `added`, `removed` and `changed` are line rows; `totalFrom` and
 * `totalTo` the PO total before and after.
 */
export function shapeChangeNote(note) {
  if (!note || typeof note !== "object") return null;
  return {
    at: note.at ?? null,
    previousFetchedAt: note.previous_fetched_at ?? null,
    added: Array.isArray(note.added) ? note.added : [],
    removed: Array.isArray(note.removed) ? note.removed : [],
    changed: Array.isArray(note.changed) ? note.changed : [],
    totalFrom: note.total_from ?? null,
    totalTo: note.total_to ?? null,
  };
}

/** "2 lines added, 1 removed, 1 quantity or price changed", as a one-line summary. */
export function changeNoteSummary(note) {
  if (!note) return "";
  const parts = [];
  if (note.added.length) parts.push(`${note.added.length} ${note.added.length === 1 ? "line" : "lines"} added`);
  if (note.removed.length) parts.push(`${note.removed.length} removed`);
  if (note.changed.length) parts.push(`${note.changed.length} quantity or price changed`);
  if (parts.length === 0 && note.totalFrom !== note.totalTo) parts.push("total changed");
  return parts.join(", ");
}

/**
 * An IPAS row as the screens read it: the stored row plus what comes out of its
 * Odoo copy and its SORs. `sors` is `ipas_sor_headers` rows for this IPAS.
 */
export function shapeIpas(row, sors = []) {
  if (!row) return null;
  const copy = row.odoo_copy ?? {};
  const shapedSors = sors.map((s) => ({
    id: s.opportunity_id,
    salesReference: s.sales_reference,
    projectTitle: s.project_title,
    clientName: s.client_name,
  }));
  const poCancelledInOdoo = isPoCancelledInOdoo(row);
  const mismatch = sorMismatch(copy, shapedSors);

  // Warnings change nothing: a cancelled PO leaves the IPAS open, a mismatch is
  // only said, and a filed IPAS keeps its frozen copy.
  const warnings = [];
  if (poCancelledInOdoo && row.state !== IPAS_STATE.CANCELLED) {
    warnings.push({ code: IPAS_WARNING.PO_CANCELLED_IN_ODOO, message: "PO cancelled in Odoo" });
  }
  if (mismatch && row.state !== IPAS_STATE.CANCELLED) {
    warnings.push({
      code: IPAS_WARNING.SOR_MISMATCH,
      message: "Odoo's S numbers differ from this IPAS's SORs",
      ...mismatch,
    });
  }
  if (row.state === IPAS_STATE.FILED && row.odoo_changed_since_filing) {
    warnings.push({ code: IPAS_WARNING.ODOO_CHANGED_SINCE_FILING, message: "Odoo has changed since filing" });
  }

  const contact = clean(row.supplier_contact);
  const piNumber = clean(row.pi_number);

  return {
    ...row,
    entity: ipasEntity(row),
    supplier: ipasSupplier(row),
    currency: ipasCurrency(row),
    lines: Array.isArray(copy.lines) ? copy.lines : [],
    poState: copy.po?.state ?? null,
    poCancelledInOdoo,
    overrides: overridesOf(row),
    contact,
    piNumber,
    contactFromOdoo: contact !== null && contact === clean(copy.supplier?.contact),
    piNumberFromOdoo: piNumber !== null && piNumber === clean(copy.po?.partner_ref),
    changeNote: shapeChangeNote(row.odoo_change_note),
    statuses: odooStatuses(copy),
    mismatch,
    warnings,
    sors: shapedSors,
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
