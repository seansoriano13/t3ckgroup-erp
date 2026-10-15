/**
 * The printed Packing List (issue #260, spec #251): what the paper says, as a
 * pure view model built from `packingListService.get`'s shape. No I/O, so the
 * totals, the partial-weight wording and the signature states are unit-tested
 * without the network. The document (packingListDocument.js) draws it.
 *
 *   Totals     box count, total known gross weight, and how many boxes were weighed
 *   Packed by  `sigBlock` states: awaiting (draft), name only, or name with
 *              "signature not applied" when the packer declined the signature
 */

import { printDate, printDateTime } from './ipasViewModel';

const BLANK = '—';

/** A quantity or weight as paper shows it: no trailing zeros, no thousands separators. */
export function printNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return BLANK;
  return String(Number(n.toFixed(3)));
}

/** Totals over the boxes. Boxes with no weight add nothing and count as not weighed. */
export function packingListTotals(boxes = []) {
  const boxCount = boxes.length;
  const weighed = boxes.filter((box) => box.grossWeightKg != null);
  const weighedCount = weighed.length;
  const totalKg = weighed.reduce((sum, box) => sum + Number(box.grossWeightKg), 0);
  let weightLine;
  if (boxCount === 0) weightLine = 'No boxes';
  else if (weighedCount === boxCount) weightLine = `${printNumber(totalKg)} kg total gross weight`;
  else weightLine = `${printNumber(totalKg)} kg known · ${weighedCount} of ${boxCount} boxes weighed`;
  return {
    boxCount,
    weighedCount,
    totalKg: printNumber(totalKg),
    partial: weighedCount < boxCount,
    boxesLine: `${boxCount} ${boxCount === 1 ? 'box' : 'boxes'}`,
    weightLine,
  };
}

/** "PURCHASING" -> "Purchasing"; blank stays blank. */
function titleCase(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Packed by: the three signature states `sigBlock` draws. */
export function packedBySignature(list) {
  // The packer's own sub-department: Purchasing, Logistics and the Warehouse all pack.
  const base = { role: 'Packed by', title: titleCase(list.packerDepartment) };
  if (list.state !== 'packed') return { ...base, who: '', state: 'awaiting' };
  const who = list.packerName || 'Unknown signer';
  const when = printDateTime(list.packedAt);
  if (list.signatureDeclined) {
    return { ...base, who, state: 'signed', stamp: `signed${when ? ` ${when}` : ''} · signature not applied` };
  }
  return { ...base, who, state: 'signed', stamp: `signed${when ? ` ${when}` : ''} · name only, no signature on file` };
}

/** One box as printed: its marks, seal and weight, then its contents with quantity and unit. */
function boxView(box) {
  return {
    boxNo: box.boxNo,
    marks: box.marks || BLANK,
    sealNo: box.sealNo || BLANK,
    weight: box.grossWeightKg == null ? BLANK : `${printNumber(box.grossWeightKg)} kg`,
    contents: (box.contents ?? []).map((c) => ({
      description: c.description,
      quantity: `${printNumber(c.quantity)}${c.unit ? ` ${c.unit}` : ''}`,
    })),
  };
}

/** A Packing List (`packingListService.get`'s shape) in the form the paper prints. */
export function buildPackingListViewModel(list) {
  return {
    number: list.number,
    state: list.state,
    stateLabel: list.state === 'packed' ? 'Packed' : 'Draft',
    customer: list.customerName || BLANK,
    sorReference: list.sorReference || BLANK,
    projectTitle: list.projectTitle || '',
    odooDeliveryRef: list.odooDeliveryRef || BLANK,
    createdBy: list.creatorName || BLANK,
    packedAt: printDate(list.packedAt) || BLANK,
    boxes: (list.boxes ?? []).map(boxView),
    totals: packingListTotals(list.boxes ?? []),
    signature: packedBySignature(list),
  };
}
