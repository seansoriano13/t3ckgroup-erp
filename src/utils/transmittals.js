import { TRANSMITTAL_STAGE, TRANSMITTAL_STAGE_LIST, TRANSMITTAL_STATE_LABELS } from "../constants/transmittals";

/**
 * Pure reads of a Transmittal row as the service fetches it (#252). The
 * database holds the rules; these only shape what the screens show.
 */

/** The first stage a submitted slip opens: Warehouse checking, or Technical on a Technical-only slip. */
export function firstStageOf(transmittal) {
  if (!transmittal) return null;
  return transmittal.check_warehouse ? TRANSMITTAL_STAGE.WAREHOUSE_CHECKING : TRANSMITTAL_STAGE.TECHNICAL_INSPECTION;
}

/** The stages a slip has, in order (Warehouse releasing only when both are ticked). */
export function stagesOf(transmittal) {
  if (!transmittal) return [];
  const stages = [];
  if (transmittal.check_warehouse) stages.push(TRANSMITTAL_STAGE.WAREHOUSE_CHECKING);
  if (transmittal.check_warehouse && transmittal.check_technical) stages.push(TRANSMITTAL_STAGE.WAREHOUSE_RELEASING);
  if (transmittal.check_technical) stages.push(TRANSMITTAL_STAGE.TECHNICAL_INSPECTION);
  return stages;
}

/** The staff list a stage's people come from. */
export function stageListOf(stage) {
  return TRANSMITTAL_STAGE_LIST[stage] ?? null;
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
        ? { id: row.check_by_first_id, name: row.check_by_first?.name ?? null, at: row.check_by_first_at }
        : null,
      second: row.check_by_second_id
        ? { id: row.check_by_second_id, name: row.check_by_second?.name ?? null, at: row.check_by_second_at }
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
  return (transmittal?.lines ?? []).some((line) => line.whRating === "na" || line.techRating === "na");
}

/** The label a line's PO picks show: product name, then quantity and unit. */
export function pickedLineLabel({ productName, quantity, unit }) {
  const qty = quantity == null ? "" : ` · ${Number(quantity)} ${unit ?? ""}`.trimEnd();
  return `${productName || "PO line"}${qty}`;
}
