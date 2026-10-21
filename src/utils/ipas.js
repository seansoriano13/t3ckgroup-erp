/**
 * Pure helpers for the IPAS (spec #241). No network, no React.
 */

import { REFUSAL } from "../constants/refusal";
import { finiteNumber, isPhpCurrency } from "./landedCost";
import { matchesSearch, sorSearchFields } from "./sorSearch";
import { shapeCharge, shapePayment, summarizePayments } from "./ipasPayments";
import { deriveTransmittalTrack } from "./ipasTransmittals";
import {
  buildBuyerTrack,
  missingSuggestions,
  shapeDocuments,
  supplierOriginOf,
  unfiledRequiredDocuments,
} from "./ipasDocuments";
import { section7Signoffs, sectionSignoffs, shapeSignoffs } from "./ipasSignoffs";
import {
  IPAS_COMPUTATION_STATUS,
  IPAS_LANDED_COST_SPLIT,
  IPAS_LANDED_COST_STATUS,
  IPAS_OVERRIDE,
  IPAS_OVERRIDE_FIELDS,
  IPAS_PURPOSE,
  IPAS_SECTION_3_APPROVED_FILTER,
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
 *
 * `extras` ({ payments, charges, documents, options, signoffs }: raw
 * ipas_payments, ipas_charges, ipas_documents and ipas_signoffs rows and every
 * ipas_options row) adds the sign-offs (`signoffs`, and `signoffSections` by
 * section 1 and 3), the
 * money (the shaped rows, the header amounts derived from them and Landed Cost),
 * the documents with the kinds still to suggest, the Item Location and the buyer
 * track. The list passes none and skips the work.
 */
export function shapeIpas(row, sors = [], extras = null) {
  if (!row) return null;
  const copy = row.odoo_copy ?? {};
  const shapedSors = sors.map((s) => ({
    id: s.opportunity_id,
    salesReference: s.sales_reference,
    projectTitle: s.project_title,
    stageName: s.current_stage_name ?? null,
    sorCode: s.sor_code ?? null,
  }));
  const poCancelledInOdoo = isPoCancelledInOdoo(row);
  const mismatch = sorMismatch(copy, shapedSors);

  // Warnings change nothing: a cancelled PO leaves the IPAS open, a mismatch is
  // only said, and a filed IPAS keeps its frozen copy.
  const warnings = [];
  if (poCancelledInOdoo && row.state !== IPAS_STATE.CANCELLED) {
    warnings.push({ code: IPAS_WARNING.PO_CANCELLED_IN_ODOO, message: "Odoo PO cancelled" });
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

  const statuses = odooStatuses(copy);
  const money = extras ? shapeMoney(row, extras) : {};
  const sections = extras ? shapeDocumentsAndTrack(row, extras, statuses, money.paymentSummary) : {};
  const signoffs = shapeSignoffs(extras?.signoffs ?? []);

  return {
    ...row,
    ...money,
    ...sections,
    signoffs,
    signoffSections: {
      1: sectionSignoffs(signoffs, 1),
      3: sectionSignoffs(signoffs, 3),
      6: sectionSignoffs(signoffs, 6),
      7: section7Signoffs(signoffs),
    },
    // The required documents nobody has ticked: what Approving section 7 warns about.
    filingWarnings: unfiledRequiredDocuments(sections.documents ?? [], row.source),
    supplierOrigin: supplierOriginOf(row),
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
    googleSheet: row.google_sheet === true,
    ganttChart: row.gantt_chart === true,
    piNumberFromOdoo: piNumber !== null && piNumber === clean(copy.po?.partner_ref),
    changeNote: shapeChangeNote(row.odoo_change_note),
    statuses,
    mismatch,
    warnings,
    sors: shapedSors,
    isProject: row.purpose === IPAS_PURPOSE.PROJECT,
  };
}

/** The browsers' own words for a request that never reached the server. */
const NETWORK_FAILURE = /^(?:typeerror:\s*)?(failed to fetch|networkerror when attempting to fetch|load failed|network request failed)/i;

export const IPAS_OFFLINE_MESSAGE = "Can't reach the server. Check your connection and try again.";

/**
 * What a refusal says when the database sent no sentence. Every refusal the IPAS,
 * Transmittal and Costing functions raise carries one of these three codes (#556).
 */
export const REFUSAL_MESSAGES = {
  [REFUSAL.NOT_ALLOWED]: "You are not allowed to do that.",
  [REFUSAL.INVALID]: "That can't be done right now.",
  [REFUSAL.DUPLICATE]: "That already exists.",
};

/** A database error's message without the RPC's own name in front of it; a dropped connection in plain words. */
export function ipasErrorMessage(error, fallback = "Something went wrong.") {
  const raw = error?.message;
  if (!raw || typeof raw !== "string") return REFUSAL_MESSAGES[error?.code] ?? fallback;
  if (NETWORK_FAILURE.test(raw.trim())) return IPAS_OFFLINE_MESSAGE;
  // Database refusals lead with the function name (ipas_create:, transmittal_check:),
  // or with "packing list:" for the Packing List RPCs.
  const text = raw.replace(/^(?:[a-z]+(?:_[a-z]+)+|packing list):\s*/i, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The IPAS list's slices over shaped rows. `state` is a lifecycle state or
 * "all"; `entity`, `purpose`, `computationStatus` and `status` (the IPAS Status, from the row's
 * `figures`) are exact; `search` matches the number, PO,
 * supplier, SO number, SOR number and project name, case-insensitively.
 */
export function filterIpas(rows, { state = "all", entity = null, purpose = null, computationStatus = null, status = null, search = "" } = {}) {
  return rows.filter((row) => {
    if (state !== "all" && row.state !== state) return false;
    if (entity && row.entity !== entity) return false;
    if (purpose && row.purpose !== purpose) return false;
    // The IPAS Status is worked out by the IPAS figures (utils/ipasFigures.js), which the list puts on each row.
    if (status && row.figures?.status !== status) return false;
    if (computationStatus === IPAS_SECTION_3_APPROVED_FILTER) {
      if (!row.section3Approved) return false;
    } else if (computationStatus && (row.computation_status || IPAS_COMPUTATION_STATUS.ENCODING) !== computationStatus) {
      return false;
    }
    return matchesSearch(search, [row.number, row.po_number, row.supplier, ...row.sors.flatMap(sorSearchFields)]);
  });
}

/**
 * Who raised the IPAS the way the sheet's Created By did: "1001 · Name", or
 * just the name when they have no Call Sign. Null when the raiser is unknown.
 */
export function raisedByParts(row) {
  const name = row?.creator?.name?.trim();
  if (!name) return null;
  const callSign = row.creator.call_sign?.trim();
  return { callSign: callSign || null, name };
}

/**
 * One SOR as Purchasing writes it: the SO number and the project name
 * ("S04081 · Rescue Vehicle"), or the SOR number when it has no SO number yet
 * ("SOR-198 · Rescue Vehicle"). `reference` is that leading number.
 */
export function sorLineParts(sor) {
  const reference = sor.salesReference?.trim() || sor.sorCode?.trim() || null;
  return { reference, project: sor.projectTitle?.trim() || null };
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

/** What the page shows when no Landed Cost came back: unavailable, never a guessed figure. */
function unreadLandedCost(currency, split) {
  return {
    status: IPAS_LANDED_COST_STATUS.UNAVAILABLE,
    reason: null,
    currency,
    isForeign: !isPhpCurrency(currency),
    rate: null,
    split,
    usedSplit: split,
    lines: [],
    totals: null,
  };
}

/**
 * The money of an IPAS: its payment and charge rows (with their option labels),
 * the header amounts derived from them, the freight service, and Landed Cost.
 * Whatever the rows hold, this never throws: unusable figures read as absent.
 */
function shapeMoney(row, { payments = [], charges = [], options = [], landedCost = null }) {
  const byId = new Map(options.map((option) => [option.id, option]));
  const shapedPayments = payments.map((payment) => shapePayment(payment, byId));
  const shapedCharges = charges.map((charge) => shapeCharge(charge, byId));
  const currency = ipasCurrency(row);
  const split = row.landed_cost_split || IPAS_LANDED_COST_SPLIT.VALUE;
  const computationStatus = row.computation_status || IPAS_COMPUTATION_STATUS.ENCODING;

  return {
    payments: shapedPayments,
    charges: shapedCharges,
    paymentSummary: summarizePayments(shapedPayments, shapedCharges, currency),
    piQtAmount: finiteNumber(row.pi_qt_amount),
    freightService: row.freight_service_id ? (byId.get(row.freight_service_id) ?? null) : null,
    landedCostSplit: split,
    computationStatus,
    // Worked out by the database (ipas_landed_cost, #283), the one copy of the maths.
    landedCost: landedCost ?? unreadLandedCost(currency, split),
  };
}

/**
 * Section 3's documents, section 5's Item Location and section 6's buyer track.
 * With P.O.P is derived from the payments (any carries proof of payment), so it
 * appears when a payment gets a proof and goes when the proof is removed.
 */
function shapeDocumentsAndTrack(row, { documents = [], options = [], payments = [], slips = [] }, statuses, paymentSummary) {
  const shapedDocuments = shapeDocuments(documents, options);
  const proofCount = payments.filter((payment) => Boolean(payment?.proof_url)).length;
  // Section 5 and the derived track (#256): the typed columns win where they
  // are set; the Transmittals fill what they don't.
  const derived = deriveTransmittalTrack(slips, {
    itemLocationId: row.item_location_id,
    deliveredOn: row.delivered_on,
    actualCheckingBy: row.actual_checking_by,
    actualCheckingAt: row.actual_checking_at,
  });
  const locationId = derived.itemLocation.id;
  return {
    documents: shapedDocuments,
    suggestedDocuments: missingSuggestions(options, documents, row.source),
    itemLocation: locationId ? (options.find((option) => option.id === locationId) ?? null) : null,
    itemLocationSource: derived.itemLocation.source,
    slips: derived.transmittals,
    buyerTrack: buildBuyerTrack(row, statuses, {
      hasProof: Boolean(paymentSummary?.hasProof),
      proofCount,
      transmittal: derived.governed ? derived : null,
    }),
  };
}

/**
 * An `ipas_bank_details` row as the page uses it, or null when none is typed
 * (or the caller may not read it: the database returns no row, and the
 * service says which of the two it was). Account # is sensitive; this only
 * reshapes it.
 */
export function shapeBankDetails(row) {
  if (!row) return null;
  return {
    bankName: clean(row.bank_name),
    accountName: clean(row.account_name),
    accountNumber: clean(row.account_number),
    flagged: Boolean(row.account_flagged),
    updatedAt: row.updated_at ?? null,
  };
}
