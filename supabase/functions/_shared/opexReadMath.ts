// Pure rules of the OPEX Report's Odoo read (#1244, spec #1241). No Odoo or Deno
// access, so src/utils/opexReadMath.test.js can import this file directly.
import { percentForS0, type TagShare } from "./projectTagMath.ts";

/** Only P0s in these states count; draft, sent and cancelled ones come back greyed out. */
export const COUNTED_P0_STATES = ["purchase", "done"];

/** The Marketing Expense account. Every other account is Operation & Admin. */
export const MARKETING_ACCOUNT_CODE = "620001";

export type P0LineInput = {
  state: string;
  shares: TagShare[];
  /** The P0 is on the report through its Source Document or because Finance added it. */
  onReport: boolean;
  quantity: number;
  priceUnit: number;
  /** Quantity on posted vendor bills less refunds. */
  billedQty: number;
  /** Posted vendor-bill pesos (bills less refunds, company currency). */
  billedPesos: number;
  /** Odoo's purchase.order.currency_rate: units of the order's currency per peso. 1 for pesos. */
  currencyRate: number;
};

export type P0LineRead = {
  sharePercent: number;
  /** The whole line in pesos: billed pesos plus the unbilled part at the ordered price. */
  pesos: number;
  /** pesos x this S0's share, or 0 when the line does not count. */
  countedPesos: number;
  marks: string[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The pesos, share and marks of one P0 line, for one S0. */
export function readP0Line(input: P0LineInput, s0: string): P0LineRead {
  const marks: string[] = [];
  const hasProjectTag = input.shares.some((s) => s.s0);
  let sharePercent: number;
  if (hasProjectTag) {
    sharePercent = Math.min(100, percentForS0(input.shares, s0));
    if (sharePercent === 0) marks.push("other project");
  } else {
    sharePercent = input.onReport ? 100 : 0;
    if (sharePercent > 0) marks.push("no tag");
  }

  const rate = input.currencyRate > 0 ? input.currencyRate : 1;
  const billedQty = input.billedQty > 0 ? input.billedQty : 0;
  const unbilledQty = Math.max(0, input.quantity - billedQty);
  const pesos = round2((input.billedPesos || 0) + (unbilledQty * input.priceUnit) / rate);

  const counts = COUNTED_P0_STATES.includes(input.state);
  if (!counts) marks.push("draft/cancelled");
  if (counts && sharePercent > 0) {
    if (billedQty <= 0) marks.push("not billed");
    else if (billedQty < input.quantity) marks.push("partly billed");
    // Priced at zero in Odoo: the total is zero, or the ordered unit price is (even when part was billed).
    if (pesos === 0 || input.priceUnit === 0) marks.push("zero price");
  }
  const countedPesos = counts ? round2((pesos * sharePercent) / 100) : 0;
  return { sharePercent, pesos, countedPesos, marks };
}

/**
 * Which analytic lines are expenses of the report (the four exclusions of the spec),
 * as an Odoo search filter so Odoo leaves the others out itself (#1266: this was two
 * extra calls, reading each journal item and then its entry). Kept: a line with no
 * journal item and a non-zero amount (a zero one is a project note), or a line whose
 * journal item is not from a P0's bill, not a tax line (VAT or withholding) and not
 * part of a stock valuation entry.
 */
export const EXPENSE_DOMAIN: unknown[] = [
  "|",
  "&",
  ["move_line_id", "=", false],
  ["amount", "!=", 0],
  "&",
  "&",
  "&",
  ["move_line_id", "!=", false],
  ["move_line_id.purchase_line_id", "=", false],
  ["move_line_id.tax_line_id", "=", false],
  ["move_line_id.move_id.stock_move_id", "=", false],
];

/** "623010 Fuel Expenses" -> "623010". Odoo shows an account as its code, then its name. */
export function codeFromAccountLabel(label: unknown): string {
  const match = /^(\S*\d\S*)\s/.exec(String(label ?? ""));
  return match ? match[1] : "";
}

export type ExpenseGroup = "marketing" | "operation_admin";

export function expenseGroup(accountCode: unknown): ExpenseGroup {
  return String(accountCode ?? "").trim() === MARKETING_ACCOUNT_CODE ? "marketing" : "operation_admin";
}

/** Odoo books an expense as a negative analytic amount; the report carries it as a positive cost. */
export function costFromAnalyticAmount(amount: number): number {
  return round2(-Number(amount || 0));
}
