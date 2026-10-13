/**
 * Documents, Supplier Origin and the buyer track of an IPAS, as the screens read
 * them (spec #241, #246). Pure helpers: no network, no React.
 */

import {
  IPAS_DOCUMENT_APPLIES_TO,
  IPAS_DOCUMENT_USED_FOR,
  IPAS_OPTION_LIST,
  IPAS_SOURCE,
  IPAS_STATUS_SOURCE,
  IPAS_SUPPLIER_ORIGIN_FIELDS,
} from "../constants/ipas";

const clean = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
};

/** Whether a document kind is suggested for a Source (its own, or Both). */
export function kindMatchesSource(kind, source) {
  if (!kind || kind.list !== IPAS_OPTION_LIST.DOCUMENT_KIND) return false;
  return kind.applies_to === source || kind.applies_to === IPAS_DOCUMENT_APPLIES_TO.BOTH;
}

/** Whether a kind is a filing item (section 7's checklist reads it): filing or both. */
export function kindIsFiling(kind) {
  return kind?.used_for === IPAS_DOCUMENT_USED_FOR.FILING || kind?.used_for === IPAS_DOCUMENT_USED_FOR.BOTH;
}

/**
 * A document row as the page reads it. `options` is a Map of ipas_options id ->
 * row (inactive ones included: a row keeps the kind it was given).
 *
 *   label        the kind's label, or the hand-added row's own
 *   byHand       a hand-added row (no kind)
 *   isFiling     the kind is a filing item. A hand-added row never is: nothing
 *                says it is required at Filing.
 *   purchasingHas, financeHas   the two ticks
 *   ticked       either tick. That is what section 7's checklist reads: a
 *                Waybill ticked in section 3 by either department is already
 *                ticked at Filing.
 */
export function shapeDocument(row, options = new Map()) {
  const kind = row.kind_id ? (options.get(row.kind_id) ?? null) : null;
  const purchasingHas = Boolean(row.purchasing_has);
  const financeHas = Boolean(row.finance_has);
  return {
    ...row,
    kind,
    label: clean(row.label) ?? kind?.label ?? "Document",
    byHand: !row.kind_id,
    appliesTo: kind?.applies_to ?? null,
    usedFor: kind?.used_for ?? null,
    isFiling: kindIsFiling(kind),
    purchasingHas,
    financeHas,
    ticked: purchasingHas || financeHas,
    attachmentUrl: clean(row.attachment_url),
  };
}

/**
 * An IPAS's documents in a stable order: kind rows in the list's order, then
 * hand-added ones as they were added.
 */
export function shapeDocuments(rows = [], options = []) {
  const byId = new Map(options.map((option) => [option.id, option]));
  return rows
    .map((row) => shapeDocument(row, byId))
    .sort((a, b) => {
      if (a.byHand !== b.byHand) return a.byHand ? 1 : -1;
      if (!a.byHand) return (a.kind?.sort ?? 0) - (b.kind?.sort ?? 0) || a.label.localeCompare(b.label);
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    });
}

/**
 * The active document kinds matching this Source that the IPAS has no row for:
 * what `ipas_suggest_documents` would add. Kinds added to the list after the
 * IPAS was raised show up here.
 */
export function missingSuggestions(options = [], documents = [], source) {
  const held = new Set(documents.map((doc) => doc.kind_id).filter(Boolean));
  return options
    .filter((option) => option.active && kindMatchesSource(option, source) && !held.has(option.id))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.label).localeCompare(String(b.label)));
}

/**
 * Document kinds Purchasing may add by hand: active kinds the IPAS doesn't have a
 * row for yet, whatever their Source (the suggestion is only a start).
 */
export function kindsToAdd(options = [], documents = []) {
  const held = new Set(documents.map((doc) => doc.kind_id).filter(Boolean));
  return options
    .filter((option) => option.list === IPAS_OPTION_LIST.DOCUMENT_KIND && option.active && !held.has(option.id))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.label).localeCompare(String(b.label)));
}

/**
 * The documents section 7's checklist reads: the filing items (filing or both
 * kinds), each with whether it is ticked. `ticked` is either tick.
 */
export function filingChecklist(documents = []) {
  return documents.filter((doc) => doc.isFiling).map((doc) => ({ ...doc, ticked: doc.purchasingHas || doc.financeHas }));
}

/** The filing items still unticked (section 7's checklist reads these). */
export function unfiledDocuments(documents = []) {
  return filingChecklist(documents).filter((doc) => !doc.ticked);
}

/**
 * The documents Filing expects for a Source: the kind rows whose kind matches it
 * (Import, Local or Both), whether the kind is for documentation, filing or
 * both. A hand-added row isn't a kind, so nothing says it is required; a kind
 * the preparer removed isn't either (they judged it not to apply).
 */
export function requiredDocuments(documents = [], source) {
  return documents.filter((doc) => !doc.byHand && doc.kind && kindMatchesSource(doc.kind, source));
}

/**
 * The required documents nobody has ticked: what Filing warns about, each as
 * { id, label, usedFor, appliesTo } and nothing more, so a warning never carries
 * a file or an attachment link.
 */
export function unfiledRequiredDocuments(documents = [], source) {
  return requiredDocuments(documents, source)
    .filter((doc) => !(doc.purchasingHas || doc.financeHas))
    .map((doc) => ({ id: doc.id, label: doc.label, usedFor: doc.usedFor, appliesTo: doc.appliesTo }));
}

/**
 * Supplier Origin as the page reads it: the four dates, or null on a Local IPAS
 * (hidden there; the database refuses them too).
 */
export function supplierOriginOf(row) {
  if (row?.source !== IPAS_SOURCE.IMPORT) return null;
  return Object.fromEntries(IPAS_SUPPLIER_ORIGIN_FIELDS.map(({ field, column }) => [field, row?.[column] ?? null]));
}

const person = (embed) => (embed?.id ? { id: embed.id, name: embed.name ?? null } : null);

/**
 * The buyer track in the sheet's order, each item saying where it came from:
 *
 *   Purchase Order     odoo    the PO's state is purchase or done
 *   With P.O.P         derived a payment on this IPAS carries proof of payment
 *   Import Clearance   typed   Import only (absent on a Local IPAS)
 *   Delivered          typed
 *   Received in Odoo   odoo    "Partly received" while only some receipts are done
 *   Create Bill        odoo    drafts count
 *   Actual Checking    stamped by Purchasing
 *
 * Every item is `{ key, label, ticked, partial, source, detail, on, by, at }`:
 * `by` is `{ id, name }` and `at` a timestamp for typed and stamped items.
 * `odoo` is `odooStatuses(copy)`, `hasProof` is `paymentSummary.hasProof`, and
 * `row` is the ipas row with its typist embeds.
 */
export function buildBuyerTrack(row, odoo, { hasProof = false, proofCount = 0 } = {}) {
  const isImport = row?.source === IPAS_SOURCE.IMPORT;

  const items = [
    {
      key: "purchase_order",
      label: "Purchase Order",
      ticked: odoo.purchaseOrder.ticked,
      partial: false,
      source: IPAS_STATUS_SOURCE.ODOO,
      detail: null,
    },
    {
      key: "with_pop",
      label: "With P.O.P",
      ticked: hasProof,
      partial: false,
      source: IPAS_STATUS_SOURCE.DERIVED,
      detail: hasProof
        ? `${proofCount} ${proofCount === 1 ? "payment carries" : "payments carry"} proof of payment`
        : "No payment carries proof of payment yet",
    },
  ];

  if (isImport) {
    items.push({
      key: "import_clearance",
      label: "Import Clearance",
      ticked: Boolean(row.import_clearance_on),
      partial: false,
      source: IPAS_STATUS_SOURCE.TYPED,
      detail: null,
      on: row.import_clearance_on ?? null,
      by: person(row.import_clearance_typer),
      at: row.import_clearance_typed_at ?? null,
    });
  }

  items.push(
    {
      key: "delivered",
      label: "Delivered",
      ticked: Boolean(row?.delivered_on),
      partial: false,
      source: IPAS_STATUS_SOURCE.TYPED,
      detail: null,
      on: row?.delivered_on ?? null,
      by: person(row?.delivered_typer),
      at: row?.delivered_typed_at ?? null,
    },
    {
      key: "received_in_odoo",
      label: "Received in Odoo",
      ticked: odoo.receivedInOdoo.ticked,
      partial: odoo.receivedInOdoo.partial,
      source: IPAS_STATUS_SOURCE.ODOO,
      detail: null,
    },
    {
      key: "create_bill",
      label: "Create Bill",
      ticked: odoo.createBill.ticked,
      partial: false,
      source: IPAS_STATUS_SOURCE.ODOO,
      detail: null,
    },
    {
      key: "actual_checking",
      label: "Actual Checking",
      ticked: Boolean(row?.actual_checking_by),
      partial: false,
      source: IPAS_STATUS_SOURCE.STAMPED,
      detail: null,
      by: person(row?.actual_checker),
      at: row?.actual_checking_at ?? null,
    },
  );

  return items;
}
