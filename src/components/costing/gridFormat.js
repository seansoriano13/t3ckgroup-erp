import { CostingBandError, CostingRuleError } from "../../services/costingMatrixService";
import { formatPHP } from "../../constants/sor";
import { percentOver } from "../../utils/costingMath";

/** A refusal in words: a band or matrix-rule refusal reads as it was written; anything else loses its function-name prefix. */
export const refusalMessage = (error) =>
  error instanceof CostingBandError || error instanceof CostingRuleError
    ? error.message
    : (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/** A peso figure, or a dash when the figure is blank (never a zero for an unknown). A negative reads -₱1,000.00. */
export const pesos = (value) => {
  if (value === null || value === undefined) return "—";
  return Number(value) < 0 ? `-${formatPHP(-Number(value))}` : formatPHP(value);
};

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** What stands in for an offer-based summary figure while a Tender Line has no Final Offer (or there is none). Null when nothing is missing. */
export function offerIncomplete(incomplete) {
  if (incomplete.missingOffer > 0) {
    return `Incomplete — ${plural(incomplete.missingOffer, "tender line has", "tender lines have")} no Final Offer`;
  }
  return incomplete.noTenderLines ? "Incomplete — no Tender Lines yet" : null;
}

/** What stands in for a cost-based summary figure while a Component or cost-only row has no Final Acquire. Null when nothing is missing. */
export function costIncomplete(incomplete) {
  if (incomplete.missingCost > 0) return `Incomplete — ${plural(incomplete.missingCost, "row has", "rows have")} no cost`;
  return incomplete.noCostRows ? "Incomplete — no Components or cost-only rows yet" : null;
}

/** A markup factor as the sheet writes it: ×1.35, with up to four decimals when it needs them (×2.0644). */
export const factorLabel = (factor) => {
  if (factor === null || factor === undefined || !Number.isFinite(Number(factor))) return "—";
  const text = Number(factor).toFixed(4).replace(/0{1,2}$/, "");
  return `×${text}`;
};

/** The same factor as the percentage over cost: +35%, +106.44%, -10%. */
export const percentLabel = (factor) => {
  const percent = percentOver(factor);
  if (percent === null) return "—";
  return `${percent >= 0 ? "+" : "-"}${Math.abs(percent)}%`;
};
