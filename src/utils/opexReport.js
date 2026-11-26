import { opexReportSummary } from "./costingMath";

/**
 * The OPEX Report's figures from one Odoo read (#1244, spec #1241). Pure.
 * `read` is the edge function's answer; `report` the saved row (Finance's typed
 * Contract price and retention, both blank for now).
 */

const cents = (n) => Math.round((Number(n) || 0) * 100);
const sumPesos = (amounts) => amounts.reduce((total, n) => total + cents(n), 0) / 100;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** The three cost groups, named once; every filter and total below reads these keys. */
export const COST_GROUP = { PRODUCT: "product", OPERATION_ADMIN: "operation_admin", MARKETING: "marketing" };
export const DEFAULT_COST_GROUP = COST_GROUP.PRODUCT;
export const COST_GROUPS = [
  { key: COST_GROUP.PRODUCT, label: "Product cost" },
  { key: COST_GROUP.OPERATION_ADMIN, label: "Operation & Admin" },
  { key: COST_GROUP.MARKETING, label: "Marketing" },
];

export const NO_EDITS = { handP0s: [], typedCosts: [], linePrices: [], leftOut: [] };

/**
 * Finance's hand edits laid over one Odoo read (#1245). Pure. `edits` is what the service
 * returns: { handP0s, typedCosts, linePrices, leftOut } as stored rows. A typed price
 * replaces a zero line's price (unit price x quantity x share); a left-out expense stays
 * on the list but does not count. An edit that points at a line Odoo no longer has is
 * returned in `orphans`, marked, and never counts.
 */
export function applyEdits(read, edits = NO_EDITS) {
  const lines = read?.lines ?? [];
  const expenses = read?.expenses ?? [];
  const prices = new Map((edits.linePrices ?? []).map((p) => [Number(p.odoo_line_id), p]));
  const leftOut = new Map((edits.leftOut ?? []).map((l) => [Number(l.analytic_line_id), l]));
  const lineIds = new Set(lines.map((l) => Number(l.lineId)));
  const expenseIds = new Set(expenses.map((e) => Number(e.analyticLineId)));

  return {
    lines: lines.map((l) => {
      const typed = prices.get(Number(l.lineId));
      const canType = l.marks.includes("zero price");
      if (!typed) return { ...l, canType, typedPrice: null };
      const pesos = round2(Number(typed.unit_price) * Number(l.quantity));
      const counts = !l.marks.includes("draft/cancelled");
      return {
        ...l,
        pesos,
        countedPesos: counts ? round2((pesos * l.sharePercent) / 100) : 0,
        marks: [...l.marks.filter((m) => m !== "zero price"), "typed"],
        canType: true,
        typedPrice: Number(typed.unit_price),
      };
    }),
    expenses: expenses.map((e) => {
      const out = leftOut.get(Number(e.analyticLineId));
      return out ? { ...e, leftOut: true, leftOutNote: out.note ?? "" } : { ...e, leftOut: false };
    }),
    typedCosts: (edits.typedCosts ?? []).map((c) => ({ ...c, amount: Number(c.amount), group: c.cost_group ?? DEFAULT_COST_GROUP })),
    handP0s: (edits.handP0s ?? []).map((h) => ({ ...h, missing: !lines.some((l) => l.p0 === h.p0_number) })),
    orphans: {
      linePrices: (edits.linePrices ?? []).filter((p) => !lineIds.has(Number(p.odoo_line_id))),
      leftOut: (edits.leftOut ?? []).filter((l) => !expenseIds.has(Number(l.analytic_line_id))),
    },
  };
}

/** Product cost (counted P0 pesos), Operation & Admin and Marketing, added up from the read. */
export function groupTotals(read) {
  const lines = read?.lines ?? [];
  const expenses = (read?.expenses ?? []).filter((e) => !e.leftOut);
  const typed = (group) => (read?.typedCosts ?? []).filter((c) => c.group === group).map((c) => c.amount);
  const expensesIn = (isGroup) => expenses.filter((e) => isGroup(e.group)).map((e) => e.amount);
  return {
    productCost: sumPesos([...lines.map((l) => l.countedPesos), ...typed(COST_GROUP.PRODUCT)]),
    operationAdmin: sumPesos([...expensesIn((g) => g !== COST_GROUP.MARKETING), ...typed(COST_GROUP.OPERATION_ADMIN)]),
    marketing: sumPesos([...expensesIn((g) => g === COST_GROUP.MARKETING), ...typed(COST_GROUP.MARKETING)]),
  };
}

/** A typed figure from an input box: blank is null (never zero), "0" is a real zero, junk is NaN. */
export function parseTyped(text) {
  const t = String(text ?? "").replace(/,/g, "").trim();
  return t === "" ? null : Number(t);
}

/** The Contract price: what Finance typed, else Odoo's. Blank (null) is never zero. */
export function contractPriceOf(read, report) {
  const typed = report?.contract_price ?? null;
  return typed ?? read?.odooContractPrice ?? null;
}

/** The whole summary for a read, worked the way the S0 Evaluation works its plan. */
export function reportSummary(read, report, settings) {
  const totals = groupTotals(read);
  const contractPrice = contractPriceOf(read, report);
  const figures = opexReportSummary(
    { contractPrice, retention: report?.retention ?? null, ...totals },
    settings,
  );
  return { contractPrice, ...totals, ...figures };
}

/** The snapshot row the list shows, from a read and its summary. */
export function snapshotFrom(read, summary) {
  return {
    read_at: read.readAt,
    project_name: read.projectName ?? null,
    contract_price: summary.contractPrice,
    product_cost: summary.productCost,
    operation_admin: summary.operationAdmin,
    marketing: summary.marketing,
    actual_opex: summary.actualOpex,
    revenue: summary.revenue,
    revenue_percent: summary.revenuePercent,
  };
}

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
export const formatPesos = (n) => (n === null || n === undefined || n === "" ? "—" : PESO.format(Number(n)));

/** S0 numbers as typed ("s06637 ") -> "S06637", or null when not one. */
export function normalizeS0(value) {
  const ref = String(value ?? "").trim().toUpperCase();
  return /^S\d+$/.test(ref) ? ref : null;
}
