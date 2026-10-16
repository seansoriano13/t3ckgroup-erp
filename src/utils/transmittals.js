import { TRANSMITTAL_RATING, TRANSMITTAL_STAGE, TRANSMITTAL_STATE_LABELS } from "../constants/transmittals";

/**
 * Pure reads of a Transmittal row as the service fetches it (#252). The
 * database holds the rules; these only shape what the screens show.
 */

/**
 * The first stage a submitted slip opens: Warehouse checking, or Technical on a
 * Technical-only slip. Reads the shaped flags, `checkWarehouse` and `checkTechnical`.
 */
export function firstStageOf(transmittal) {
  if (!transmittal) return null;
  return transmittal.checkWarehouse ? TRANSMITTAL_STAGE.WAREHOUSE_CHECKING : TRANSMITTAL_STAGE.TECHNICAL_INSPECTION;
}

/** The checking stage: Technical inspection where the slip has one, otherwise Warehouse checking. */
export function checkingStageOf(transmittal) {
  if (!transmittal) return null;
  return transmittal.checkTechnical ? TRANSMITTAL_STAGE.TECHNICAL_INSPECTION : TRANSMITTAL_STAGE.WAREHOUSE_CHECKING;
}

/** The stages a slip has, in order (Warehouse releasing only when both are ticked). */
export function stagesOf(transmittal) {
  if (!transmittal) return [];
  const stages = [];
  if (transmittal.checkWarehouse) stages.push(TRANSMITTAL_STAGE.WAREHOUSE_CHECKING);
  if (transmittal.checkWarehouse && transmittal.checkTechnical) stages.push(TRANSMITTAL_STAGE.WAREHOUSE_RELEASING);
  if (transmittal.checkTechnical) stages.push(TRANSMITTAL_STAGE.TECHNICAL_INSPECTION);
  return stages;
}

export function transmittalStateLabel(state) {
  return TRANSMITTAL_STATE_LABELS[state] ?? state ?? "";
}

/**
 * The slip's header and lines as the screens read them: lines in their
 * order, products and references as `{ id, label }`, the IPAS numbers it
 * carries, and the SORs its lines name.
 */
export function shapeTransmittal(row) {
  if (!row) return null;
  const lines = [...(row.lines ?? [])].sort((a, b) => a.position - b.position).map(shapeLine);
  const ipasNumbers = [...new Set(lines.map((line) => line.ipasNumber).filter(Boolean))];
  const sors = new Map();
  for (const line of lines) {
    if (line.sor) sors.set(line.sor.id, line.sor);
  }
  return {
    id: row.id,
    number: row.number,
    preparedOn: row.prepared_on,
    preparedBy: row.preparer ?? null,
    preparedById: row.prepared_by,
    origin: row.origin,
    originOther: row.origin_other ?? null,
    checkWarehouse: !!row.check_warehouse,
    checkTechnical: !!row.check_technical,
    checkOther: row.check_other ?? null,
    priority: row.priority,
    entity: row.entity,
    productOther: row.product_other ?? null,
    itemLocation: row.item_location ?? null,
    products: (row.products ?? []).map((p) => p.option).filter(Boolean),
    references: (row.references ?? []).map((r) => r.option).filter(Boolean),
    state: row.state,
    submittedAt: row.submitted_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    stages: row.stages ?? [],
    evidence: row.evidence ?? [],
    checkBy: {
      first: checkBySlot(row.check_by_first_id, row.check_by_first, row.check_by_first_at, row.check_by_first_signature_declined),
      second: checkBySlot(row.check_by_second_id, row.check_by_second, row.check_by_second_at, row.check_by_second_signature_declined),
    },
    // Signatures that were undone, kept as history (#538), oldest first.
    cleared: [...(row.cleared ?? [])]
      .sort((a, b) => String(a.cleared_at).localeCompare(String(b.cleared_at)))
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        stage: c.stage ?? null,
        slot: c.slot ?? null,
        signerName: c.signer_name ?? null,
        otherSignerName: c.other_signer_name ?? null,
        signedAt: c.signed_at ?? null,
        receiptRef: c.receipt_ref ?? null,
        clearedBy: c.clearer?.name ?? null,
        clearedAt: c.cleared_at,
        reason: c.cleared_reason,
      })),
    odooReceivedAt: row.odoo_received_at ?? null,
    odooReceivedBy: row.odoo_received_by
      ? { id: row.odoo_received_by, name: row.odoo_receiver?.name ?? null }
      : null,
    odooReceiptRef: row.odoo_receipt_ref ?? null,
    lines,
    ipasNumbers,
    sors: [...sors.values()],
    createdAt: row.created_at,
  };
}

export function shapeLine(row) {
  return {
    id: row.id,
    position: row.position,
    kind: row.kind,
    ipasId: row.ipas_id ?? null,
    ipasNumber: row.ipas?.number ?? null,
    poNumber: row.ipas?.po_number ?? null,
    odooPoLineId: row.odoo_po_line_id ?? null,
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit ?? null,
    sor: row.sor ? { id: row.sor.id, salesReference: row.sor.sales_reference, projectTitle: row.sor.project_title } : null,
    serialNumbers: row.serial_numbers ?? "",
    boxQuantity: row.box_quantity ?? "",
    whInChargeId: row.wh_in_charge_id ?? null,
    whInChargeName: row.wh_in_charge?.name ?? null,
    techInChargeName: row.tech_in_charge?.name ?? null,
    whRating: row.wh_rating ?? null,
    whRemark: row.wh_remark ?? "",
    techInChargeId: row.tech_in_charge_id ?? null,
    techRating: row.tech_rating ?? null,
    techRemark: row.tech_remark ?? "",
    quantityReceived: row.quantity_received == null ? null : Number(row.quantity_received),
  };
}

/** The stage row for a stage name, or null when the slip doesn't have it. */
export function stageRowOf(transmittal, stage) {
  return (transmittal?.stages ?? []).find((s) => s.stage === stage) ?? null;
}

/** The pictures and videos on one stage, as the service returns them. */
export function evidenceOf(transmittal, stage) {
  const row = stageRowOf(transmittal, stage);
  if (!row) return [];
  return (transmittal?.evidence ?? []).filter((e) => e.record_id === row.id);
}

/** Whether the slip has NA on any line, from the Warehouse or the Technical rating. */
export function hasNaLine(transmittal) {
  return (transmittal?.lines ?? []).some(
    (line) => line.whRating === TRANSMITTAL_RATING.NA || line.techRating === TRANSMITTAL_RATING.NA,
  );
}

/** The distinct, non-blank values of a list, in the order first seen. */
function distinct(values) {
  return [...new Set(values.filter((v) => v != null && String(v).trim() !== "").map((v) => String(v).trim()))];
}

/**
 * Splits a line's SN# field into its serials: one per comma, semicolon or
 * line break. Blank gives none, so the caller falls back to one unit per line.
 */
export function splitSerials(serialNumbers) {
  return distinct(String(serialNumbers ?? "").split(/[,;\n]+/));
}

/**
 * The TSR a Technical inspection stage gives (#259, spec #251). There is no
 * separate TSR record. Units are one row per serial on each rated line (one
 * row for the line when its SN# is blank), verdicts come from the TCA rating,
 * and item, SOR, PO and line are the distinct values across every rated line.
 * Null when the slip has no Technical inspection. Shaped for tsrViewModel.js.
 */
export function tsrOf(transmittal) {
  if (!transmittal || !stagesOf(transmittal).includes(TRANSMITTAL_STAGE.TECHNICAL_INSPECTION)) return null;
  const stage = stageRowOf(transmittal, TRANSMITTAL_STAGE.TECHNICAL_INSPECTION);
  const rated = (transmittal.lines ?? []).filter((line) => line.techRating);
  const joined = (values) => distinct(values).join(", ") || null;
  return {
    number: transmittal.number,
    item: joined(rated.map((line) => line.description)),
    transmittal: { number: transmittal.number },
    line: rated.length
      ? { position: rated.map((line) => line.position).join(", "), description: null }
      : null,
    sor: joined(rated.map((line) => line.sor?.salesReference)),
    po: joined(rated.map((line) => line.poNumber)),
    units: rated.flatMap((line) => {
      const verdict = line.techRating === TRANSMITTAL_RATING.NA ? "fail" : "pass";
      const remark = line.techRemark || "";
      const serials = splitSerials(line.serialNumbers);
      if (serials.length === 0) return [{ serial: line.description, verdict, remark }];
      return serials.map((serial) => ({ serial, verdict, remark }));
    }),
    remarks: stage?.remarks || "",
    // Technical inspection's Inspected by is who checked the units. Noted by is
    // Purchasing's, which the TG03 slip doesn't record: it prints blank, for
    // signing by hand.
    checkedBy: {
      name: stage?.second_signer?.name ?? stage?.second_signer_name ?? null,
      at: stage?.second_signed_at ?? null,
    },
    notedBy: { name: null, at: null },
    evidence: evidenceOf(transmittal, TRANSMITTAL_STAGE.TECHNICAL_INSPECTION).map((e) => ({
      kind: e.kind === "video" ? "video" : "picture",
      storagePath: e.storage_path,
      fileName: e.file_name,
    })),
  };
}

/** One Check by slot: who signed it, when, and whether they declined their stored signature; null while unsigned. */
function checkBySlot(id, employee, at, signatureDeclined) {
  if (!id) return null;
  return {
    id,
    name: employee?.name ?? null,
    callSign: employee?.call_sign ?? null,
    signaturePath: employee?.signature_path ?? null,
    signatureDeclined: Boolean(signatureDeclined),
    at,
  };
}

/** The label a line's PO picks show: product name, then quantity and unit. */
export function pickedLineLabel({ productName, quantity, unit }) {
  const qty = quantity == null ? "" : ` · ${Number(quantity)} ${unit ?? ""}`.trimEnd();
  return `${productName || "PO line"}${qty}`;
}

/**
 * The register's name for an Odoo company name, matched ignoring case and
 * spacing ("T3ck Trading" is the register's "T3CK Trading"). An unmatched
 * name is kept as Odoo gave it, so the default never silently goes blank.
 */
export function matchCompany(companyNames, odooName) {
  const raw = (odooName ?? "").trim();
  const key = raw.toLowerCase().replace(/\s+/g, " ");
  return companyNames.find((name) => name.trim().toLowerCase().replace(/\s+/g, " ") === key) ?? raw;
}

/** The Company picks: the register, plus a saved value it no longer lists. */
export function companyOptions(companyNames, current) {
  const names = current && !companyNames.includes(current) ? [...companyNames, current] : companyNames;
  return names.map((name) => ({ value: name, label: name }));
}
