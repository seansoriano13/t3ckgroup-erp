/**
 * Pure mapping from `costingMatrixService.get`'s result to exactly what the printed Costing
 * Matrix says (issue #274, spec #266, ADR 0014). No I/O, no HTML: the composer
 * (costingMatrixDocument.js) draws it, the printer (costingMatrixPrinter.js) fetches and prints.
 *
 * What prints depends on the tier the matrix was read at, because the read already withheld
 * what that tier may not see and this builder never invents it:
 *
 *   Sheet 1, the money sheet   Closed Book only (Super Admins and the Final Acquire list): one row per
 *                              Tender Line, the cost-only rows, the summary (or why it is incomplete),
 *                              the margin strip, the Bid Decision, deviations in prose, a Landed Cost
 *                              column that reads "awaiting purchase", and the four signature blocks.
 *   Sheet 2, the appendix      every tier that can read the matrix: each Tender Specification in full
 *                              against its Components' Offer Specifications, Compliance and notes, then
 *                              the Inclusions with their covered count. No figures.
 *
 * For any tier below Closed Book the view model has no `money` key and no figure anywhere, even if a
 * caller hands over a matrix with money in it: the sheet is decided by `tier`, not by what arrived.
 *
 * A sign-off prints three ways: a stored signature as the signature, a signer with none (or who
 * declined to apply it) as the name only, and a box still waiting as "Signature required".
 *
 * Strings are raw text. The composer escapes them.
 */

import { COSTING_TIER, BID_VERDICT_LABEL, COMPONENT_AVAILABILITY_LABEL, COMPONENT_SOURCE_LABEL, COMPONENT_STATUS_LABEL } from '../../constants/costing';
import { costIncomplete, factorLabel, finalAcquireTotal, offerIncomplete } from '../../utils/costingMath';
import { printAmount, printDate, printDateTime } from './ipasViewModel';

const BLANK = '—';
const LANDED_COST = 'awaiting purchase';

const text = (value) => {
  const out = typeof value === 'string' ? value.trim() : '';
  return out === '' ? null : out;
};

const peso = (value) => printAmount(value, 'PHP');
/** A table figure: the column head says the sheet is in PHP, so the cell carries the number alone. */
const figure = (value) => printAmount(value);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const percentText = (value) => (value === null || value === undefined ? BLANK : `${Number(value).toFixed(1)}%`);

/** A multi-line specification as its lines, blank lines dropped. An empty one is one dash. */
function specLines(value) {
  const lines = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [BLANK];
}

/** A Tender Line has no name of its own: it is called by the first line of its Tender Specification. */
function lineName(line) {
  const first = specLines(line.tender_specification)[0];
  return first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first;
}

const quantityText = (quantity, unit) => {
  if (quantity === null || quantity === undefined) return null;
  return [String(Number(quantity)), text(unit)].filter(Boolean).join(' ');
};

// ── Sign-offs ────────────────────────────────────────────────────────────────

const SIGN_BLOCKS = [
  { key: 'prepared', role: 'Prepared by', title: 'Sales incharge', incharge: 'sales_incharge_id' },
  { key: 'costed', role: 'Costed by', title: 'Purchasing incharge', incharge: 'purchasing_incharge_id' },
  { key: 'evaluation_approved', role: 'Evaluation approved', title: 'Evaluation of Specification', incharge: null },
  { key: 'final_approved', role: 'Final Acquire & offer approved', title: 'Final Acquire list', incharge: null },
];

/**
 * One box, in the shape `sigBlock` draws:
 *
 *   state 'awaiting'  nobody has signed it: "Signature required" (the incharge, where there is one, is named)
 *   state 'signed'    signed in the ERP. `signaturePath` is the signature as it was when they signed (so a
 *                     later upload never rewrites an old print), or null for the name only: they had none,
 *                     or they declined to apply it.
 */
export function signoffBox(block, signoff, matrix, people) {
  const nameOf = (id) => text(people?.[id]?.name);
  if (!signoff) {
    const expected = block.incharge ? nameOf(matrix?.matrix?.[block.incharge]) : null;
    return { role: block.role, who: expected ?? '', title: block.title, state: 'awaiting', signaturePath: null, signatureDeclined: false };
  }
  const who = nameOf(signoff.signed_by) ?? 'Unknown signer';
  const declined = Boolean(signoff.signature_declined);
  const path = !declined ? text(signoff.signature_version) : null;
  const when = printDateTime(signoff.signed_at);
  let stamp;
  if (path) stamp = `e-signed${when ? ` ${when}` : ''}`;
  else if (declined) stamp = `signed${when ? ` ${when}` : ''} · signature not applied`;
  else stamp = `signed${when ? ` ${when}` : ''} · name only, no signature on file`;
  return { role: block.role, who, title: block.title, state: 'signed', signaturePath: path, signatureDeclined: declined, stamp };
}

// ── Sheet 1: money ───────────────────────────────────────────────────────────

function summaryRows(matrix) {
  const { summary, rates } = matrix;
  const offerNote = offerIncomplete(summary.incomplete);
  const costNote = costIncomplete(summary.incomplete);
  const offer = (value) => (value === null || value === undefined ? (offerNote ?? BLANK) : peso(value));
  const cost = (value) => (value === null || value === undefined ? (costNote ?? BLANK) : peso(value));
  const rate = (value) => `${Number((Number(value) * 100).toFixed(4))}%`;
  const typed = (value) => (value === null || value === undefined ? BLANK : peso(value));
  const revenueNote = costNote ?? offerNote;
  return [
    { label: 'Final Offer', value: offer(summary.finalOfferTotal) },
    { label: 'VAT-exclusive', hint: `Final Offer ÷ ${Number(rates.vatDivisor)}`, value: offer(summary.vatExclusive) },
    { label: `Less Tax ${rate(rates.taxRate)}`, hint: 'on the gross offer', value: offer(summary.tax) },
    { label: `Retention ${rate(rates.retentionRate)}`, value: offer(summary.retention) },
    { label: 'Collected Amount', value: offer(summary.collected) },
    { label: 'Operational Expenses', hint: 'Final Acquire total', value: cost(summary.operationalExpenses) },
    { label: 'Marketing', value: typed(summary.marketing) },
    { label: 'OPEX', value: typed(summary.opex) },
    { label: `ITR ${rate(rates.itrRate)}`, hint: `of the offer above ${peso(Number(rates.itrAllowance))}`, value: offer(summary.itr) },
    {
      label: 'Revenue',
      strong: true,
      value: summary.revenue === null || summary.revenue === undefined ? (revenueNote ?? BLANK) : peso(summary.revenue),
    },
  ];
}

/** The Bid Decision as it prints: what Management is signing, with the figures it was taken against. */
function bidDecisionOf(matrix, people) {
  const d = matrix.bidDecision;
  if (!d) return null;
  return {
    verdict: BID_VERDICT_LABEL[d.verdict] ?? d.verdict,
    reason: text(d.reason) ?? BLANK,
    decidedBy: text(people?.[d.decidedBy]?.name) ?? 'Unknown',
    decidedOn: printDate(d.decidedAt) ?? BLANK,
    finalOffer: d.finalOfferTotal === undefined ? BLANK : peso(d.finalOfferTotal),
    abc: d.abcTotal === undefined || d.abcTotal === null ? BLANK : peso(d.abcTotal),
  };
}

/**
 * Each deviating Component in prose. The Technical author's recommended alternative is printed as
 * they typed it: it is free text, so any cost they gave it comes with it; none is invented.
 */
function deviationsOf(matrix) {
  const out = [];
  for (const line of matrix.tenderLines) {
    for (const component of line.components) {
      if (component.compliance !== 'deviates') continue;
      const parts = [`Component ${component.number}${text(component.name) ? ` (${text(component.name)})` : ''} deviates`];
      const note = text(component.compliance_note);
      parts[0] += note ? `: ${note.replace(/[.\s]+$/, '')}.` : '.';
      const alternative = text(component.recommended_alternative);
      if (alternative) parts.push(`Recommended instead: ${alternative.replace(/[.\s]+$/, '')}.`);
      out.push({ number: component.number, text: parts.join(' ') });
    }
  }
  return out;
}

function moneySheet(matrix, people) {
  const { summary } = matrix;
  const lines = matrix.tenderLines.map((line) => ({
    number: String(line.number),
    name: lineName(line),
    detail: `${plural(line.components.length, 'component', 'components')}, ${plural(
      line.components.reduce((n, c) => n + c.inclusions.length, 0),
      'inclusion',
      'inclusions',
    )}`,
    abc: figure(line.totals.abcTotal),
    acquire: figure(line.totals.acquireTotal),
    finalAcquire: figure(finalAcquireTotal(line.components)),
    finalOffer: figure(line.totals.finalOfferTotal),
    achieved: factorLabel(line.markup.achievedFactor),
    landedCost: LANDED_COST,
  }));

  const costRows = matrix.costRows.map((row) => ({
    number: `C${row.number}`,
    description: text(row.description) ?? 'Cost only',
    acquire: figure(row.totals.acquireTotal),
    finalAcquire: figure(finalAcquireTotal([row])),
    factor: factorLabel(row.markup.factor),
    landedCost: LANDED_COST,
  }));

  const offerNote = offerIncomplete(summary.incomplete);
  const costNote = costIncomplete(summary.incomplete);
  const abcBar = summary.percentOfAbc === null || summary.percentOfAbc === undefined ? null : Math.min(100, Math.max(0, summary.percentOfAbc));

  return {
    facts: {
      abc: peso(summary.abcTotal),
      targetMarkup: factorLabel(matrix.markup.targetFactor),
      defaultMarkup: factorLabel(matrix.defaultFactor),
      incharge:
        [text(people?.[matrix.matrix?.sales_incharge_id]?.name), text(people?.[matrix.matrix?.purchasing_incharge_id]?.name)]
          .map((name, i) => (name ? `${name} ${i === 0 ? 'sales' : 'purchasing'}` : null))
          .filter(Boolean)
          .join(' · ') || BLANK,
    },
    lines,
    costRows,
    // "Incomplete — N rows have no cost" and its offer-side twin: the summary still prints, saying why.
    incomplete: [offerNote, costNote].filter(Boolean),
    summary: summaryRows(matrix),
    strip: {
      finalOffer: summary.finalOfferTotal === null || summary.finalOfferTotal === undefined ? (offerNote ?? BLANK) : peso(summary.finalOfferTotal),
      cost: summary.operationalExpenses === null || summary.operationalExpenses === undefined ? (costNote ?? BLANK) : peso(summary.operationalExpenses),
      achieved: factorLabel(matrix.markup.achievedFactor),
      target: factorLabel(matrix.markup.targetFactor),
      abcPercent: percentText(summary.percentOfAbc),
      abcBar,
      overAbc: Boolean(summary.overAbc),
      landedCost: LANDED_COST,
    },
    bidDecision: bidDecisionOf(matrix, people),
    deviations: deviationsOf(matrix),
    notEvaluated: matrix.compliance?.notEvaluated ?? 0,
    landedCost: LANDED_COST,
    signoffs: SIGN_BLOCKS.map((block) => signoffBox(block, matrix.signoffs?.[block.key]?.signoff ?? null, matrix, people)),
  };
}

// ── Sheet 2: the specification appendix ──────────────────────────────────────

const COMPLIANCE_WORDS = { complies: 'Complies', deviates: 'Deviates' };

function inclusionsOf(component) {
  const rows = component.inclusions ?? [];
  if (!component.is_bundle && rows.length === 0) return null;
  const c = component.completeness;
  const item = (row) => ({
    description: text(row.description) ?? BLANK,
    quantity: Number(row.quantity) === 1 ? null : quantityText(row.quantity, row.unit),
    state: String(row.completeness ?? 'MISSING').toLowerCase(),
  });
  return {
    owner: component.number,
    covered: c.counted === 0 ? 'none checked yet' : `${c.answered} of ${c.counted} covered`,
    outstanding: c.outstanding,
    groups: (component.inclusionGroups ?? []).map((group) => ({ heading: group.heading, items: group.items.map(item) })),
  };
}

function appendixComponent(component) {
  const sourcing = [
    COMPONENT_STATUS_LABEL[component.status],
    COMPONENT_AVAILABILITY_LABEL[component.availability],
    COMPONENT_SOURCE_LABEL[component.source],
  ].filter(Boolean);
  const po = text(component.po_rfq_no);
  return {
    number: component.number,
    name: text(component.name) ?? BLANK,
    brand: text(component.brand),
    sourcing: sourcing.join(' · '),
    po: po ? `PO / RFQ ${po}` : null,
    offerLines: specLines(component.offer_specification),
    compliance: component.compliance ?? null,
    complianceLabel: COMPLIANCE_WORDS[component.compliance] ?? 'Not evaluated',
    note: text(component.compliance_note),
    alternative: text(component.recommended_alternative),
  };
}

function appendixSheet(matrix) {
  return {
    lines: matrix.tenderLines.map((line) => ({
      number: String(line.number),
      name: lineName(line),
      quantity: quantityText(line.quantity, line.unit),
      specLines: specLines(line.tender_specification),
      components: line.components.map(appendixComponent),
      inclusions: line.components.map(inclusionsOf).filter(Boolean),
    })),
  };
}

// ── The view model ───────────────────────────────────────────────────────────

/**
 * @param record  `{ matrix, opportunity, people }`
 *   matrix       `costingMatrixService.get(opportunityId)`, as the printing tier received it
 *   opportunity  `{ sales_reference, project_title, client_name }`
 *   people       `{ [employeeId]: { name } }` for the signers, the incharges and the decider
 * @param opts     `{ printedAt, printedBy }`
 */
export function buildCostingMatrixViewModel(record, { printedAt = null, printedBy = null } = {}) {
  const { matrix, opportunity = {}, people = {} } = record ?? {};
  if (!matrix) throw new Error("There is no Costing Matrix to print, or you can't read it.");

  const showMoney = matrix.tier === COSTING_TIER.CLOSED_BOOK && Boolean(matrix.summary);
  const sheets = [];
  if (showMoney) sheets.push('money');
  sheets.push('appendix');

  const vm = {
    formType: 'costing_matrix',
    tier: matrix.tier,
    number: text(opportunity.sales_reference) ?? BLANK,
    entity: 'T3CKGROUP',
    projectTitle: text(opportunity.project_title) ?? BLANK,
    clientName: text(opportunity.client_name) ?? BLANK,
    printedAt: printDateTime(printedAt),
    printedBy: text(printedBy),
    sheets,
    appendix: appendixSheet(matrix),
  };
  if (showMoney) vm.money = moneySheet(matrix, people);
  return vm;
}
