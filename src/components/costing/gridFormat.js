import { CostingBandError, CostingRuleError } from "../../services/costingMatrixService";
import { formatPHP } from "../../constants/sor";

/** A refusal in words: a band or matrix-rule refusal reads as it was written; anything else loses its function-name prefix. */
export const refusalMessage = (error) =>
  error instanceof CostingBandError || error instanceof CostingRuleError
    ? error.message
    : (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/** A peso figure, or a dash when the figure is blank (never a zero for an unknown). */
export const pesos = (value) => (value === null || value === undefined ? "—" : formatPHP(value));
