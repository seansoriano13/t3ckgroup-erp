import { CostingBandError, CostingRuleError } from "../../services/costingMatrixService";
import { formatPHP } from "../../constants/sor";
import { costIncomplete, factorLabel, offerIncomplete, percentOver } from "../../utils/costingMath";

// The "Incomplete — …" words live with the maths so the print says the same as the screen.
export { costIncomplete, factorLabel, offerIncomplete };

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

/** The same factor as the percentage over cost: +35%, +106.44%, -10%. */
export const percentLabel = (factor) => {
  const percent = percentOver(factor);
  if (percent === null) return "—";
  return `${percent >= 0 ? "+" : "-"}${Math.abs(percent)}%`;
};
