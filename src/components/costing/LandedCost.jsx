import StatusBadge from "../StatusBadge";
import { LANDED_COST_BLANK_LABEL, LANDED_COST_MARK_LABEL } from "../../constants/costing";
import { pesos } from "./gridFormat";

/**
 * Landed Cost's mark (#283): Provisional until every IPAS it draws from has Costs complete, then
 * Final. It travels with the figure wherever it is read.
 */
export function LandedCostMark({ mark }) {
  if (!mark) return null;
  return <StatusBadge label={LANDED_COST_MARK_LABEL[mark] || mark} theme={mark === "final" ? "green" : "amber"} />;
}

/**
 * A Component's Landed Cost: its unit or total figure with the mark, or why it is blank, in muted
 * words. `which` is "unit" or "total". Draws nothing when the tier was never sent Landed Cost.
 */
export function LandedCostCell({ landedCost, which }) {
  if (!landedCost) return null;
  if (landedCost.blankReason) {
    return which === "unit" ? (
      <span className="block text-right text-xs text-muted-foreground" data-testid="landed-cost-blank">
        {LANDED_COST_BLANK_LABEL[landedCost.blankReason] || landedCost.blankReason}
      </span>
    ) : null;
  }
  const value = which === "unit" ? landedCost.unit : landedCost.total;
  return (
    <span className="flex flex-col items-end gap-1 text-sm tabular-nums" data-testid={`landed-cost-${which}`}>
      {pesos(value)}
      {which === "total" && <LandedCostMark mark={landedCost.mark} />}
    </span>
  );
}

/** A Tender Line's or the matrix's Landed Cost roll-up: the total and its mark, or blank. */
export function LandedCostRollup({ rollup }) {
  if (!rollup) return <span className="text-xs font-normal text-muted-foreground">Not complete</span>;
  return (
    <span className="flex flex-col items-end gap-1 tabular-nums" data-testid="landed-cost-rollup">
      {pesos(rollup.total)}
      <LandedCostMark mark={rollup.mark} />
    </span>
  );
}
