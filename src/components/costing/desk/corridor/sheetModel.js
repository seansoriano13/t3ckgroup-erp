/**
 * The Overview's model: the matrix read turned into the sheet's rows (a line, then what comes with it and its parts,
 * indented) and each band's total, plus the waterfall from the Final Offer down to Revenue. Read-only.
 */
import { COSTING_TIER, tierReads, tierReadsCost } from "../../../../constants/costing";
import { costUnit, effectiveAcquireUnit, finalAcquireTotal } from "../../../../utils/costingMath";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const times = (unit, qty) => (unit === null || qty === null ? null : Math.round(unit * qty * 100) / 100);
const per = (total, qty) => (total === null || !qty ? null : Math.round((total / qty) * 100) / 100);
/** A sum that stays blank while any part is blank (a blank is never zero). */
const sumOrNull = (values) => (values.length === 0 || values.some((v) => v === null) ? null : Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100);

/** The bands in the sheet's left-to-right order, each with who fills it. */
export const BANDS = [
  { key: "abc", label: "Client · ABC", owner: "Sales", tone: "sales" },
  { key: "acquire", label: "Acquire", owner: "Purchasing", tone: "purchasing" },
  { key: "odoo", label: "Odoo SRP", owner: "From Odoo", tone: "odoo" },
  { key: "finalAcquire", label: "Final Acquire", owner: "Management", tone: "management" },
  { key: "offer", label: "Final Offer", owner: "Sales", tone: "sales" },
  { key: "margin", label: "Margin", owner: "Worked out", tone: "result" },
];

/**
 * Calm owner colours (2026-11-13: "no need to copy the sheet's colours"): a pale header with a thin accent
 * line on top, so the owner still reads at a glance without loud blocks of colour.
 */
export const TONE = {
  sales: { strip: "bg-indigo-2 text-indigo-12 shadow-[inset_0_2px_0_var(--indigo-8)]", soft: "bg-indigo-2/60", ink: "text-indigo-11", ring: "border-indigo-6", dot: "bg-indigo-8", bar: "bg-indigo-7" },
  purchasing: { strip: "bg-teal-2 text-teal-12 shadow-[inset_0_2px_0_var(--teal-8)]", soft: "bg-teal-2/60", ink: "text-teal-11", ring: "border-teal-6", dot: "bg-teal-8", bar: "bg-teal-7" },
  odoo: { strip: "bg-gold-2 text-gold-12 shadow-[inset_0_2px_0_var(--gold-8)]", soft: "bg-gold-2/60", ink: "text-gold-11", ring: "border-gold-6", dot: "bg-gold-8", bar: "bg-gold-7" },
  management: { strip: "bg-mauve-3 text-mauve-12 shadow-[inset_0_2px_0_var(--mauve-9)]", soft: "bg-mauve-2", ink: "text-mauve-12", ring: "border-mauve-7", dot: "bg-mauve-9", bar: "bg-mauve-8" },
  result: { strip: "bg-jade-2 text-jade-12 shadow-[inset_0_2px_0_var(--jade-8)]", soft: "bg-jade-2/60", ink: "text-jade-11", ring: "border-jade-6", dot: "bg-jade-8", bar: "bg-jade-7" },
};

const itemName = (line) => line.sor_line_snapshot?.name || (line.tender_specification ?? "").split("\n")[0].trim() || "Untitled line";

/** One part's figures, per unit and total, on its own quantity. */
function partRow(line, part) {
  const qty = num(part.quantity);
  const acquire = num(effectiveAcquireUnit(part));
  const odoo = num(part.odoo_unit);
  const fa = num(costUnit(part));
  return {
    kind: "part",
    id: `part-${part.id}`,
    lineId: line.id,
    name: [part.brand, part.name].filter(Boolean).join(" ") || "Unnamed part",
    qty,
    unit: part.unit,
    cells: {
      abc: null,
      acquire: { unit: acquire, total: times(acquire, qty) },
      odoo: { unit: odoo, total: times(odoo, qty) },
      finalAcquire: { unit: fa, total: times(fa, qty) },
      offer: null,
    },
  };
}

/** One S0 line's figures. A line's cost figures are its parts' added up. */
function lineRow(line) {
  const qty = num(line.quantity);
  const kid = Boolean(line.included);
  const acquireTotal = num(line.totals?.acquireTotal);
  const odooTotal = num(line.totals?.odooTotal);
  const faTotal = num(finalAcquireTotal(line.components));
  return {
    kind: kid ? "included" : "line",
    id: line.id,
    lineId: line.id,
    number: line.number,
    name: itemName(line),
    qty,
    unit: line.unit,
    overAbc: Boolean(line.totals?.overAbc),
    parts: line.components.length,
    cells: {
      abc: kid ? "incl" : { unit: num(line.abc_unit), total: num(line.totals?.abcTotal) },
      acquire: { unit: per(acquireTotal, qty), total: acquireTotal },
      odoo: { unit: per(odooTotal, qty), total: odooTotal },
      finalAcquire: { unit: per(faTotal, qty), total: faTotal },
      offer: kid ? "incl" : { unit: num(line.final_offer_unit), total: num(line.totals?.finalOfferTotal) },
    },
  };
}

/**
 * The sheet: which bands this viewer reads, the rows (a line, then its included lines and, when it has more
 * than one, its parts, indented), and each band's total.
 */
export function buildSheet(matrix) {
  const tier = matrix.tier;
  const show = {
    abc: tierReads(tier, "abc_unit"),
    acquire: tierReadsCost(tier, "acquire_unit"),
    odoo: tierReadsCost(tier, "acquire_unit"),
    finalAcquire: tier === COSTING_TIER.CLOSED_BOOK,
    offer: tierReads(tier, "final_offer_unit"),
    margin: tier === COSTING_TIER.CLOSED_BOOK && tierReads(tier, "final_offer_unit"),
  };
  const bands = BANDS.filter((b) => show[b.key]);
  const lines = matrix.tenderLines ?? [];
  const kidsOf = new Map();
  for (const l of lines) if (l.included && l.includedIn) kidsOf.set(l.includedIn, [...(kidsOf.get(l.includedIn) ?? []), l]);

  const rows = [];
  const pushWithParts = (line) => {
    const row = lineRow(line);
    rows.push(row);
    if (line.components.length > 1) for (const part of line.components) rows.push({ ...partRow(line, part), depth: row.kind === "included" ? 2 : 1 });
  };
  for (const line of lines) {
    if (line.included && line.includedIn && lines.some((l) => l.id === line.includedIn)) continue;
    const start = rows.length;
    pushWithParts(line);
    for (const kid of kidsOf.get(line.id) ?? []) pushWithParts(kid);
    // Margin sits on the line that carries the offer: its offer less the Final Acquire of it and what comes with it.
    const block = rows.slice(start).filter((r) => r.kind !== "part");
    const head = rows[start];
    const offer = head.cells.offer === "incl" ? null : head.cells.offer?.total ?? null;
    const cost = sumOrNull(block.map((r) => r.cells.finalAcquire.total));
    const margin = offer === null || cost === null ? null : Math.round((offer - cost) * 100) / 100;
    head.cells.margin = { unit: per(margin, head.qty), total: margin, pct: margin === null || !offer ? null : (margin / offer) * 100 };
    for (const r of rows.slice(start + 1)) r.cells.margin = r.kind === "part" ? null : "incl";
  }

  // The Final Offer typed as one total: the lines' own offers (kept underneath) and their margins are not shown.
  if (matrix.offer?.mode === "total_only") {
    for (const r of rows) {
      if (r.kind === "part") continue;
      r.cells.offer = r.kind === "line" ? null : r.cells.offer;
      r.cells.margin = r.kind === "line" ? null : r.cells.margin;
    }
  }
  const topRows = rows.filter((r) => r.kind !== "part");
  const totals = {
    abc: num(matrix.totals?.abcTotal),
    acquire: sumOrNull(topRows.map((r) => r.cells.acquire.total)),
    odoo: sumOrNull(topRows.map((r) => r.cells.odoo.total)),
    finalAcquire: sumOrNull(topRows.map((r) => r.cells.finalAcquire.total)),
    offer: num(matrix.totals?.finalOfferTotal),
  };
  totals.margin = totals.offer === null || totals.finalAcquire === null ? null : Math.round((totals.offer - totals.finalAcquire) * 100) / 100;
  const missing = {
    abc: matrix.totals?.missingAbc ?? 0,
    offer: matrix.totals?.missingOffer ?? 0,
    acquire: topRows.filter((r) => r.cells.acquire.total === null).length,
    odoo: topRows.filter((r) => r.cells.odoo.total === null).length,
    finalAcquire: topRows.filter((r) => r.cells.finalAcquire.total === null).length,
    margin: 0,
  };
  return { bands, rows, totals, missing, lineCount: lines.length };
}

/**
 * The waterfall, top to bottom, from the real summary (Closed Book only; null otherwise). Each step is
 * `{ label, value, sign }`: sign -1 is taken off, 0 a subtotal, 1 the result.
 */
export function waterfallSteps(matrix) {
  const s = matrix.summary;
  if (!s) return null;
  const pct = (r) => `${Number((Number(r) * 100).toFixed(2))}%`;
  const rates = matrix.rates ?? {};
  return {
    steps: [
      { key: "offer", label: "Final Offer", value: s.finalOfferTotal, sign: 0 },
      { key: "vat", label: `VAT ${pct(rates.finalVatRate ?? 0.12)}`, value: s.finalOfferTotal == null || s.vatExclusive == null ? null : s.finalOfferTotal - s.vatExclusive, sign: -1 },
      { key: "vatEx", label: "Less VAT", value: s.vatExclusive, sign: 0 },
      { key: "tax", label: `Less tax ${pct(rates.taxRate ?? 0.06)}`, value: s.tax, sign: -1, note: "on the VAT-exclusive figure" },
      { key: "collected", label: "Collected", value: s.collected, sign: 0 },
      { key: "retention", label: `Retention ${pct(rates.retentionRate ?? 0.01)}`, value: s.retention, sign: -1, opex: true },
      { key: "landed", label: "Landed Cost", value: s.landedCost, sign: -1, opex: true },
      { key: "expenses", label: "Project expenses", value: s.projectExpenses, sign: -1, opex: true },
      { key: "marketing", label: "Marketing", value: s.marketing, sign: -1, opex: true },
      { key: "itr", label: `ITR ${pct(rates.itrRate ?? 0.08)}`, value: s.itr, sign: -1 },
      { key: "revenue", label: "Revenue", value: s.revenue, sign: 1 },
    ],
    opex: s.opex,
    revenue: s.revenue,
    revenuePercent: s.revenuePercent,
    goLine: s.goLinePercent ?? 20,
    under: s.underGoLine,
    offer: s.finalOfferTotal,
  };
}
