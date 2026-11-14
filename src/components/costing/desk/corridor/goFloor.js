import { costUnit } from "../../../../utils/costingMath";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * The lowest offer total that keeps Revenue at the Go line, from the same formula the summary uses
 * (costingMath sheetRevenue): Revenue = offer ÷ VAT divisor − (retention × offer + landed + expenses + marketing)
 * − ITR × (offer above the allowance). Solved for Revenue = Go% × offer. Null while a cost is blank.
 */
export function goFloor(fixedCost, rates) {
  if (fixedCost === null || !rates) return null;
  const d = Number(rates.vatDivisor ?? 1.12);
  const r = Number(rates.retentionRate ?? 0.01);
  const i = Number(rates.itrRate ?? 0.08);
  const a = Number(rates.itrAllowance ?? 0);
  const g = Number(rates.goLinePercent ?? 20) / 100;
  const above = (fixedCost - i * a) / (1 / d - r - i - g);
  if (above > a && 1 / d - r - i - g > 0) return above;
  return 1 / d - r - g > 0 ? fixedCost / (1 / d - r - g) : null;
}

/**
 * The Go floor from every cost that is known (#1036). A blank or unworked Other cost is not counted as zero and does
 * not drop the others: the known amounts are added, and `uncounted` says how many costs are still missing
 * (an Other costs row that cannot be worked, a usual category with no row, a blank Marketing). While any is
 * missing the floor is only "so far".
 */
export function goFloorSoFar({ productCost, costRows, missingUsual = 0, marketing, rates }) {
  const rows = costRows ?? [];
  let known = 0;
  let uncounted = missingUsual;
  for (const row of rows) {
    const unit = num(costUnit(row));
    if (unit === null) uncounted += 1;
    else known += Math.round(unit * (num(row.quantity) ?? 1) * 100) / 100;
  }
  const mk = num(marketing);
  if (mk === null) uncounted += 1;
  else known += mk;
  const floor = goFloor(productCost === null ? null : productCost + known, rates);
  return { floor, uncounted, partial: uncounted > 0 };
}
