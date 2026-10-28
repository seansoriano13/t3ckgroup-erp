/**
 * Optimistic edits to a cached IPAS, so a change shows the moment it is made and
 * the server catches up behind it.
 *
 * `ipasService.get` keeps the raw rows it shaped the page from under `raw`.
 * `reshapeIpas` runs one of the edits below over those rows and shapes them
 * again with the same `shapeIpas` the service uses, so what the screen shows
 * while it waits is exactly what the refetch will say once the server agrees.
 * Nothing here talks to the network.
 *
 * Landed Cost is the one exception: the database works it out (#283), so while an
 * edit waits the page keeps the last figure it read, and the refetch brings the new one.
 */

import { IPAS_SIGNOFF_ROLE, ipasSectionNo } from "../constants/ipas";
import { pesosFromRate, sumPesos } from "./landedCost";
import { shapeIpas } from "./ipas";
import { parseAmountInput } from "./ipasPayments";

/** The rows `reshapeIpas` needs, as `ipasService.get` read them. */
export function rawOf({ row, sors, payments, charges, documents, options, signoffs, landedCost }) {
  return { row, sors, payments, charges, documents, options, signoffs, landedCost };
}

/**
 * The cached IPAS with `edit(raw)` applied and shaped again. Returned as it is
 * when it carries no raw rows (nothing to edit yet).
 */
export function reshapeIpas(current, edit) {
  if (!current?.raw) return current;
  const raw = edit(current.raw);
  if (!raw || raw === current.raw) return current;
  const shaped = shapeIpas(raw.row, raw.sors ?? [], {
    payments: raw.payments,
    charges: raw.charges,
    documents: raw.documents,
    options: raw.options,
    signoffs: raw.signoffs,
    landedCost: raw.landedCost,
  });
  return { ...current, ...shaped, options: raw.options, raw };
}

let counter = 0;
/** An id for a row the server hasn't made yet; the refetch replaces it. */
export const optimisticId = () => `optimistic-${Date.now()}-${(counter += 1)}`;

const nowIso = () => new Date().toISOString();

// ── The header row ──────────────────────────────────────────────────────────

/** Sets columns on the IPAS row. */
export const setRow = (fields) => (raw) => ({ ...raw, row: { ...raw.row, ...fields } });

/** The row columns `ipasService.setHeader`'s camelCase values write. */
export function headerColumns({ supplierContact, piNumber, piQtAmount, freightServiceId, landedCostSplit, computationStatus, googleSheet, ganttChart, remarks }) {
  const fields = {};
  if (remarks !== undefined) fields.remarks = (remarks ?? "").trim() || null;
  if (supplierContact !== undefined) fields.supplier_contact = (supplierContact ?? "").trim() || null;
  if (piNumber !== undefined) fields.pi_number = (piNumber ?? "").trim() || null;
  if (piQtAmount !== undefined) {
    const parsed = parseAmountInput(piQtAmount);
    if (parsed.ok) fields.pi_qt_amount = parsed.value;
  }
  if (freightServiceId !== undefined) fields.freight_service_id = freightServiceId || null;
  if (landedCostSplit !== undefined) fields.landed_cost_split = landedCostSplit;
  if (computationStatus !== undefined) fields.computation_status = computationStatus;
  if (googleSheet !== undefined) fields.google_sheet = googleSheet;
  if (ganttChart !== undefined) fields.gantt_chart = ganttChart;
  return fields;
}

// ── Payments and charges ────────────────────────────────────────────────────

function mapRows(key, id, edit) {
  return (raw) => ({ ...raw, [key]: raw[key].map((r) => (r.id === id ? edit(r) : r)) });
}

/** A payment form's values as the stored row's columns. */
function paymentColumns(values, isPhpPo) {
  const amount = parseAmountInput(values.amount).value;
  const rate = parseAmountInput(values.forexRate).value;
  const php = rate === null ? null : pesosFromRate(amount, rate);
  const bank = parseAmountInput(values.chargeFeePhp).value ?? 0;
  const stamp = parseAmountInput(values.docStampPhp).value ?? 0;
  const misc = parseAmountInput(values.miscFeePhp).value ?? 0;
  return {
    kind: values.kind,
    paid_on: values.paidOn,
    amount,
    php_debited: isPhpPo ? null : php,
    charge_fee_php: sumPesos([bank, stamp, misc]),
    forex_rate: isPhpPo ? null : rate,
    doc_stamp_php: stamp,
    misc_fee_php: misc,
    bank_charge_php: bank,
    rate: isPhpPo ? null : rate,
    method_id: values.methodId,
    check_no: (values.checkNo || "").trim() || null,
    proof_url: (values.proofUrl || "").trim() || null,
  };
}

/** Adds a payment (no `paymentId`) or changes one. */
export const savePayment =
  ({ paymentId = null, values, isPhpPo, ipasId, by }) =>
  (raw) => {
    const columns = paymentColumns(values, isPhpPo);
    if (paymentId) return mapRows("payments", paymentId, (row) => ({ ...row, ...columns }))(raw);
    const row = {
      id: optimisticId(),
      ipas_id: ipasId,
      ...columns,
      created_by: by?.id ?? null,
      creator: by ? { id: by.id, name: by.name } : null,
      created_at: nowIso(),
    };
    return { ...raw, payments: [...raw.payments, row] };
  };

export const removePayment = (paymentId) => (raw) => ({ ...raw, payments: raw.payments.filter((r) => r.id !== paymentId) });

/** Adds a charge (no `chargeId`) or changes one. */
export const saveCharge =
  ({ chargeId = null, values, ipasId, by }) =>
  (raw) => {
    const columns = {
      kind_id: values.kindId,
      charged_on: values.chargedOn,
      amount_php: parseAmountInput(values.amountPhp).value,
    };
    if (chargeId) return mapRows("charges", chargeId, (row) => ({ ...row, ...columns }))(raw);
    const row = {
      id: optimisticId(),
      ipas_id: ipasId,
      ...columns,
      created_by: by?.id ?? null,
      creator: by ? { id: by.id, name: by.name } : null,
      created_at: nowIso(),
    };
    return { ...raw, charges: [...raw.charges, row] };
  };

export const removeCharge = (chargeId) => (raw) => ({ ...raw, charges: raw.charges.filter((r) => r.id !== chargeId) });

// ── Documents ───────────────────────────────────────────────────────────────

/** Ticks or unticks one side of a document ("purchasing" or "finance"). */
export const tickDocument = (documentId, side, value) =>
  mapRows("documents", documentId, (row) => ({
    ...row,
    [side === "finance" ? "finance_has" : "purchasing_has"]: Boolean(value),
  }));

export const attachDocument = (documentId, url) =>
  mapRows("documents", documentId, (row) => ({ ...row, attachment_url: (url || "").trim() || null }));

export const removeDocument = (documentId) => (raw) => ({
  ...raw,
  documents: raw.documents.filter((r) => r.id !== documentId),
});

/** A document row by kind or by hand. */
export const addDocument =
  ({ kindId = null, label = "", ipasId }) =>
  (raw) => ({
    ...raw,
    documents: [
      ...raw.documents,
      {
        id: optimisticId(),
        ipas_id: ipasId,
        kind_id: kindId || null,
        label: kindId ? null : (label || "").trim(),
        purchasing_has: false,
        finance_has: false,
        attachment_url: null,
        created_at: nowIso(),
      },
    ],
  });

// ── Sign-offs ───────────────────────────────────────────────────────────────

const live = (signoff) => !signoff.cleared_at;

/** A sign-off given by `by` ({ id, name, avatarPath }). */
export const giveSignoff =
  ({ section, role, by, ipasId }) =>
  (raw) => ({
    ...raw,
    signoffs: [
      ...raw.signoffs,
      {
        id: optimisticId(),
        ipas_id: ipasId,
        section,
        role,
        signed_by: by?.id ?? null,
        signer: by ? { id: by.id, name: by.name, avatar_path: by.avatarPath ?? null } : null,
        signed_at: nowIso(),
        signature_declined: false,
        cleared_at: null,
      },
    ],
  });

/**
 * Clears live sign-offs: `match(signoff)` says which. Kept as history with the
 * reason, as the database keeps them.
 */
export const clearSignoffs =
  ({ match, by, reason }) =>
  (raw) => ({
    ...raw,
    signoffs: raw.signoffs.map((s) =>
      live(s) && match(s)
        ? {
            ...s,
            cleared_at: nowIso(),
            cleared_by: by?.id ?? null,
            clearer: by ? { id: by.id, name: by.name } : null,
            cleared_reason: reason,
          }
        : s,
    ),
  });

const SECTION_7_OPEN = new Set([IPAS_SIGNOFF_ROLE.RECEIVED, IPAS_SIGNOFF_ROLE.NOTED, IPAS_SIGNOFF_ROLE.CHECKED]);

/**
 * A Return of `section` (1, 3 or 7), or with `undo` an Undo approval: what the
 * database clears, so the card moves on at once. Sections 1 and 3 also clear
 * section 4's open Received, Noted and Checked.
 */
export function returnSection({ section, undo = false, by, reason }) {
  return (raw) => {
    const history = undo ? `Approval undone: ${reason}` : `Returned: ${reason}`;
    const own = (s) =>
      s.section === section &&
      (section === 7
        ? SECTION_7_OPEN.has(s.role)
        : undo
          ? s.role === IPAS_SIGNOFF_ROLE.APPROVED
          : s.role === IPAS_SIGNOFF_ROLE.PREPARED || s.role === IPAS_SIGNOFF_ROLE.APPROVED);
    let next = clearSignoffs({ match: own, by, reason: history })(raw);
    if (section !== 7) {
      next = clearSignoffs({
        match: (s) => s.section === 7 && SECTION_7_OPEN.has(s.role),
        by,
        reason: `Section ${ipasSectionNo(section)} ${undo ? "approval undone" : "returned"}: ${reason}`,
      })(next);
    }
    return next;
  };
}

// ── Typed dates, the stamp, the location ────────────────────────────────────

export const setItemLocation = (optionId) => setRow({ item_location_id: optionId || null });

/** A buyer-track status typed (`import_clearance` or `delivered`), or cleared with a blank date. */
export const setTypedStatus =
  ({ status, date, by }) =>
  (raw) => {
    const text = (date ?? "").trim();
    return {
      ...raw,
      row: {
        ...raw.row,
        [`${status}_on`]: text === "" ? null : text,
        [`${status}_typed_at`]: text === "" ? null : nowIso(),
        [`${status}_typer`]: text === "" || !by ? null : { id: by.id, name: by.name },
      },
    };
  };

/** Supplier Origin dates, by their stored column. */
export const setOriginDates = (columns) => setRow(columns);

/** Actual Checking stamped by `by`, or cleared. */
export const stampActualChecking =
  ({ stamped, by }) =>
  (raw) => ({
    ...raw,
    row: {
      ...raw.row,
      actual_checking_by: stamped ? (by?.id ?? null) : null,
      actual_checker: stamped && by ? { id: by.id, name: by.name } : null,
      actual_checking_at: stamped ? nowIso() : null,
    },
  });

/** Bank details as the page holds them (shaped, not a raw row); sits beside `raw`, so it has its own edit. */
export function withBankDetails(current, values) {
  if (!current) return current;
  const keep = current.bankDetails;
  return {
    ...current,
    bankDetails: {
      bankName: (values.bankName ?? "").trim() || null,
      accountName: (values.accountName ?? "").trim() || null,
      accountNumber: (values.accountNumber ?? "").trim() || null,
      flagged: keep?.flagged ?? false,
      updatedAt: keep?.updatedAt ?? null,
    },
  };
}
