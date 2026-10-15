/**
 * The printed Transmittal, TG03 paper layout (issue #258, spec #251): what the
 * paper says, as a pure view model over `transmittalService.get`'s shape. No
 * I/O, so the tick rows, grid padding and continuation, rated and unrated
 * cells, struck-through stages and signature states are unit-tested without
 * the network. The document (transmittalDocument.js) draws it.
 *
 *   Ticks     Origin, Checking, Priority, Reference Checklist, Company, Product
 *   Grid      one row per line, padded with blank rows to the paper's length;
 *             a longer slip continues on a further page with the header repeated
 *   Stages    Warehouse checking, Warehouse releasing, Technical inspection;
 *             a stage the slip doesn't have is struck through
 *   Check by  two plates, blank until signed
 *
 * A plate is `signed` (name and stamp) or `waiting` (blank, as on the paper).
 */

import { printDate, printDateTime } from './ipasViewModel';
import { stagesOf } from '../../utils/transmittals';
import {
  TRANSMITTAL_ORIGIN,
  TRANSMITTAL_ORIGIN_LABELS,
  TRANSMITTAL_PRIORITIES,
  TRANSMITTAL_PRIORITY_LABELS,
  TRANSMITTAL_RATING_LABELS,
  TRANSMITTAL_STAGE,
  TRANSMITTAL_STATE_LABELS,
} from '../../constants/transmittals';

const BLANK = '—';

/** Grid rows that fit on one printed page: the paper's length. */
export const GRID_ROWS_PER_PAGE = 14;

export const LEGEND = 'GOOD CONDITION = GC · NEED ATTENTION = NA';

/** The three stages in paper order, with the roles printed on their two plates. */
const STAGE_SECTIONS = [
  { stage: TRANSMITTAL_STAGE.WAREHOUSE_CHECKING, title: 'Warehouse: Checking Remarks', roles: ['Received by', 'Inspected by'] },
  { stage: TRANSMITTAL_STAGE.WAREHOUSE_RELEASING, title: 'Warehouse: Releasing Remarks', roles: ['Released by', 'Received by'] },
  {
    stage: TRANSMITTAL_STAGE.TECHNICAL_INSPECTION,
    title: 'Technical: Inspection Remarks & Recommendations',
    roles: ['Received by', 'Inspected by'],
  },
];

/** One tick row: each option ticked when selected, with its Others text where it has one. */
function tickRow(options, selected, others = {}) {
  return options.map(({ key, label }) => ({
    key,
    label,
    ticked: selected === key,
    other: selected === key && others[key] ? others[key] : null,
  }));
}

/** GC or NA when the line is rated; blank otherwise, for writing on. */
function ratedCell(rating) {
  return rating ? (TRANSMITTAL_RATING_LABELS[rating] ?? rating.toUpperCase()) : '';
}

/** A line as the grid prints it: the item with its quantity and unit in brackets. */
function lineRow(line) {
  const qty = line.quantity == null ? '' : `${Number(line.quantity)}${line.unit ? ` ${line.unit}` : ''}`;
  return {
    kind: 'line',
    sn: line.serialNumbers || '',
    item: `${line.description ?? ''}${qty ? ` [${qty}]` : ''}`,
    project: [line.sor?.salesReference, line.sor?.projectTitle].filter(Boolean).join(' · '),
    boxQuantity: line.boxQuantity ?? '',
    whInCharge: line.whInChargeName ?? '',
    whCheck: ratedCell(line.whRating),
    techInCharge: line.techInChargeName ?? '',
    techCheck: ratedCell(line.techRating),
  };
}

const BLANK_ROW = { kind: 'blank', sn: '', item: '', project: '', boxQuantity: '', whInCharge: '', whCheck: '', techInCharge: '', techCheck: '' };

/**
 * The grid in pages of GRID_ROWS_PER_PAGE, each padded to the paper's length.
 * `continued` marks a page after the first, which repeats the header. A slip
 * with no lines still prints one page of blanks.
 */
export function gridPages(lines = []) {
  const rows = lines.map(lineRow);
  const count = Math.max(1, Math.ceil(rows.length / GRID_ROWS_PER_PAGE));
  return Array.from({ length: count }, (_, i) => {
    const slice = rows.slice(i * GRID_ROWS_PER_PAGE, (i + 1) * GRID_ROWS_PER_PAGE);
    const padding = Array.from({ length: GRID_ROWS_PER_PAGE - slice.length }, () => BLANK_ROW);
    return { continued: i > 0, rows: [...slice, ...padding] };
  });
}

/** A signature plate: waiting prints blank; signed prints the name with its stamp and any note. */
export function plate(role, { who = null, at = null, note = null, waiting = false, signatureBase64 = null } = {}) {
  if (waiting || !who) return { role, state: 'waiting', who: '', stamp: '' };
  const when = printDateTime(at);
  // Without an image the plate prints the name, so it says so (as the IPAS print does).
  const why = note ?? (signatureBase64 ? null : 'name only, no signature on file');
  const stamp = [when ? `signed ${when}` : 'signed', why].filter(Boolean).join(' · ');
  return { role, state: 'signed', who, stamp, signatureBase64: signatureBase64 || null };
}

/** The second plate of a stage: a declined or unconfirmed co-signer prints name only, with the note. */
function coSignerPlate(role, row) {
  if (!row.second_signed_at) return plate(role, { waiting: true });
  let note = null;
  if (row.second_signature_declined) note = 'signature not applied';
  else if (!row.second_confirmed) note = 'name only, not yet confirmed';
  const signed = !row.second_signature_declined && row.second_confirmed;
  return plate(role, {
    who: row.second_signer_name ?? row.second_signer?.name ?? null,
    at: row.second_signed_at,
    note,
    signatureBase64: signed ? (row.second_signer?.signatureBase64 ?? null) : null,
  });
}

/** One stage's section: its remarks, its two plates, and whether it holds pictures. */
function stageSection(transmittal, section) {
  const present = stagesOf(transmittal).includes(section.stage);
  const row = (transmittal.stages ?? []).find((s) => s.stage === section.stage) ?? null;
  const pictures = row ? (transmittal.evidence ?? []).some((e) => e.record_id === row.id) : false;
  const base = { title: section.title, present, remarks: row?.remarks || '', pictures: pictures ? 'Yes' : 'No' };
  if (!present || !row) {
    return { ...base, plates: section.roles.map((role) => plate(role, { waiting: true })) };
  }
  const first = plate(section.roles[0], {
    who: row.first_signer?.name ?? null,
    at: row.first_signed_at,
    waiting: !row.first_signed_at,
    signatureBase64: row.first_signer?.signatureBase64 ?? null,
  });
  return { ...base, plates: [first, coSignerPlate(section.roles[1], row)] };
}

/**
 * Check by: two plates, blank until signed. A signed plate prints its signer's
 * call sign beneath; a blank one prints the Check by list's call signs (#258).
 */
function checkByPlates(checkBy, roster = []) {
  const rosterSigns = roster.map((r) => r.callSign).filter(Boolean).join(' · ');
  const slot = (label, entry) =>
    entry?.name
      ? { ...plate(label, { who: entry.name, at: entry.at }), callSign: entry.callSign ?? '' }
      : { ...plate(label, { waiting: true }), callSign: rosterSigns };
  return [slot('Check by (1)', checkBy?.first), slot('Check by (2)', checkBy?.second)];
}

/** The tick rows at the top of the sheet. */
export function tickRows(t) {
  const origin = tickRow(
    Object.values(TRANSMITTAL_ORIGIN).map((key) => ({ key, label: TRANSMITTAL_ORIGIN_LABELS[key] })),
    t.origin,
    { [TRANSMITTAL_ORIGIN.OTHER]: t.originOther },
  );
  const checking = [
    { key: 'warehouse', label: 'Warehouse', ticked: !!t.checkWarehouse, other: null },
    { key: 'technical', label: 'TCA Technical', ticked: !!t.checkTechnical, other: null },
    { key: 'other', label: 'Others', ticked: !!t.checkOther, other: t.checkOther || null },
  ];
  const priority = tickRow(
    TRANSMITTAL_PRIORITIES.map((key) => ({ key, label: TRANSMITTAL_PRIORITY_LABELS[key] })),
    t.priority,
  );
  // The full checklist, every active reference option, ticked where the slip has it (#258).
  const selectedRefs = new Set((t.references ?? []).map((r) => r.id));
  const references = (t.referenceOptions ?? t.references ?? []).map((r) => ({
    key: r.id,
    label: r.label,
    ticked: selectedRefs.has(r.id),
  }));
  const products = (t.products ?? []).map((p) => p.label);
  if (t.productOther) products.push(t.productOther);
  return {
    origin,
    checking,
    priority,
    references,
    company: t.entity || BLANK,
    product: products.join(', ') || BLANK,
  };
}

/** The whole slip as the paper prints it. */
export function buildTransmittalViewModel(t) {
  return {
    number: t.number,
    state: t.state,
    stateLabel: TRANSMITTAL_STATE_LABELS[t.state] ?? t.state ?? '',
    preparedOn: printDate(t.preparedOn) || BLANK,
    techBox: !!t.checkTechnical,
    ticks: tickRows(t),
    legend: LEGEND,
    pages: gridPages(t.lines ?? []),
    stages: STAGE_SECTIONS.map((section) => stageSection(t, section)),
    odooReceived: {
      by: t.odooReceivedBy?.name ?? t.odooReceivedBy ?? '',
      at: printDateTime(t.odooReceivedAt) || '',
      ref: t.odooReceiptRef || '',
    },
    checkBy: checkByPlates(t.checkBy, t.checkByRoster ?? []),
  };
}
