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
  };
}

/** The label a line's PO picks show: product name, then quantity and unit. */
export function pickedLineLabel({ productName, quantity, unit }) {
  const qty = quantity == null ? "" : ` · ${Number(quantity)} ${unit ?? ""}`.trimEnd();
  return `${productName || "PO line"}${qty}`;
}
