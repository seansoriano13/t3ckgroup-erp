// Pure and runtime-agnostic: imported by the edge function (Deno), the Retail
// report (browser) and the frontend test runner. No Deno/Node/browser imports.
//
// The one rule for whether a Retail Order's Order Income can be trusted. The
// Retail screen derives it for display and the sync derives it to decide which
// Income Notes to re-read; both read this module so they cannot drift apart.

export const INCOME_STATUS = {
  OK: "ok",
  MISSING: "missing",
  SUSPECT: "suspect",
} as const;

export type IncomeStatus = (typeof INCOME_STATUS)[keyof typeof INCOME_STATUS];

export interface IncomeFigures {
  amount: number | string | null;
  order_income: number | string | null;
  marketplace_fee: number | string | null;
}

/**
 * Missing: no Order Income. Suspect: income above the Order Amount, or a
 * Marketplace Fee that eats the whole Order Amount. Fee + income differing from
 * the Order Amount alone is normal (shipping, vouchers) and stays OK.
 */
export function incomeStatus(order: IncomeFigures): IncomeStatus {
  if (order.order_income == null) return INCOME_STATUS.MISSING;
  const amount = Number(order.amount) || 0;
  if (Number(order.order_income) > amount) return INCOME_STATUS.SUSPECT;
  if (order.marketplace_fee != null && Number(order.marketplace_fee) >= amount) return INCOME_STATUS.SUSPECT;
  return INCOME_STATUS.OK;
}
