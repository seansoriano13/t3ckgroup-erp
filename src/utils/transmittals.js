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
      first: row.check_by_first_id
        ? { id: row.check_by_first_id, name: row.check_by_first?.name ?? null, callSign: row.check_by_first?.call_sign ?? null, at: row.check_by_first_at }
        : null,
      second: row.check_by_second_id
        ? { id: row.check_by_second_id, name: row.check_by_second?.name ?? null, callSign: row.check_by_second?.call_sign ?? null, at: row.check_by_second_at }
        : null,
    },
    odooReceivedAt: row.odoo_received_at ?? null,
    odooReceivedBy: row.odoo_received_by ?? null,
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

/**
 * The Technical Service Report a slip's Technical inspection stage gives (#259,
 * spec #251). There is no separate TSR record: its units are the rated lines,
 * its verdicts the TCA ratings, its signers the stage's two plates. Null when
 * the slip has no Technical inspection. Shaped for tsrViewModel.js.
 */
export function tsrOf(transmittal) {
  if (!transmittal || !stagesOf(transmittal).includes(TRANSMITTAL_STAGE.TECHNICAL_INSPECTION)) return null;
  const stage = stageRowOf(transmittal, TRANSMITTAL_STAGE.TECHNICAL_INSPECTION);
  const rated = (transmittal.lines ?? []).filter((line) => line.techRating);
  const first = rated[0] ?? null;
  return {
    number: transmittal.number,
    item: first ? (rated.length === 1 ? first.description : `${rated.length} items`) : null,
    transmittal: { number: transmittal.number },
    line: first ? { position: first.position, description: first.description } : null,
    sor: first?.sor?.salesReference ?? null,
    po: first?.poNumber ?? null,
    units: rated.map((line) => ({
      serial: line.serialNumbers || line.description,
      verdict: line.techRating === TRANSMITTAL_RATING.NA ? "fail" : "pass",
      remark: line.techRemark || "",
    })),
    remarks: stage?.remarks || "",
    checkedBy: { name: stage?.first_signer?.name ?? null, at: stage?.first_signed_at ?? null },
    notedBy:
      stage?.second_signed_at && !stage.second_signature_declined
        ? { name: stage.second_signer_name ?? stage.second_signer?.name ?? null, at: stage.second_signed_at }
        : null,
    evidence: evidenceOf(transmittal, TRANSMITTAL_STAGE.TECHNICAL_INSPECTION).map((e) => ({
      kind: e.kind === "video" ? "video" : "picture",
      storagePath: e.storage_path,
      fileName: e.file_name,
    })),
  };
}

/** The label a line's PO picks show: product name, then quantity and unit. */
export function pickedLineLabel({ productName, quantity, unit }) {
  const qty = quantity == null ? "" : ` · ${Number(quantity)} ${unit ?? ""}`.trimEnd();
  return `${productName || "PO line"}${qty}`;
}
