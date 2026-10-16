import { CostingBandError, CostingRuleError } from "../../services/costingMatrixService";
import { formatPHP } from "../../constants/sor";
import { percentOver } from "../../utils/costingMath";

/** A refusal in words: a band or matrix-rule refusal reads as it was written; anything else loses its function-name prefix. */
export const refusalMessage = (error) =>
  error instanceof CostingBandError || error instanceof CostingRuleError
    ? error.message
    : (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/** A peso figure, or a dash when the figure is blank (never a zero for an unknown). */
export const pesos = (value) => (value === null || value === undefined ? "—" : formatPHP(value));

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
