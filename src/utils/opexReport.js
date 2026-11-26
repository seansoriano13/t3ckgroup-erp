import { opexReportSummary } from "./costingMath";

/**
 * The OPEX Report's figures from one Odoo read (#1244, spec #1241). Pure.
 * `read` is the edge function's answer; `report` the saved row (Finance's typed
 * Contract price and retention, both blank for now).
 */

const cents = (n) => Math.round((Number(n) || 0) * 100);
const sumPesos = (rows, pick) => rows.reduce((total, row) => total + cents(pick(row)), 0) / 100;

/** Product cost (counted P0 pesos), Operation & Admin and Marketing, added up from the read. */
export function groupTotals(read) {
  const lines = read?.lines ?? [];
  const expenses = read?.expenses ?? [];
  return {
    productCost: sumPesos(lines, (l) => l.countedPesos),
    operationAdmin: sumPesos(
      expenses.filter((e) => e.group !== "marketing"),
      (e) => e.amount,
    ),
    marketing: sumPesos(
      expenses.filter((e) => e.group === "marketing"),
      (e) => e.amount,
    ),
  };
}

/** The Contract price: what Finance typed, else Odoo's. Blank (null) is never zero. */
export function contractPriceOf(read, report) {
  const typed = report?.contract_price ?? report?.contractPrice ?? null;
  return typed ?? read?.odooContractPrice ?? null;
}

/** The whole summary for a read, worked the way the S0 Evaluation works its plan. */
export function reportSummary(read, report, settings) {
  const totals = groupTotals(read);
  const contractPrice = contractPriceOf(read, report);
  const worked = opexReportSummary(
    { contractPrice, retention: report?.retention ?? null, ...totals },
    settings,
  );
  return { contractPrice, ...totals, ...worked };
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
