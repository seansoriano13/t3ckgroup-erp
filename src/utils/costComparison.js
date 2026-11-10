import { formatPHP } from "../constants/sor";
import { formatAmount } from "./ipas";
import { isPhpCurrency } from "./landedCost";

const isNumber = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

/**
 * What the Costing Matrix says about a Component's cost (#686): the Expected cost (Acquire, which a
 * Canvass winner's price fills) beside the Actual cost (the attached P0 line's price). The actual wins.
 *
 *   no Actual, Expected from a Canvass winner -> "₱10.00 (Canvass winner)"
 *   no Actual, Expected typed                 -> null (the Acquire field already says it)
 *   Actual only, or Actual = Expected         -> "₱10.00"
 *   both, different                           -> "Expected ₱10.00 · Actual ₱12.00 (+20.0%)"
 *
 * A foreign P0 (`quoted` in `currency`) has its Actual in pesos at the Canvass winner's rate, and
 * says so: "... · $388.00 at the Canvass rate". With no winner in its currency there is no peso
 * Actual, and the P0's price is shown in its own currency, never compared with a peso figure.
 *
 * Returns null when there is nothing to add to the Acquire field.
 */
export function costComparisonText({ expected, actual, quoted, currency, fromCanvass = false }) {
  const hasActual = isNumber(actual);
  const hasExpected = isNumber(expected);
  const foreign = isNumber(quoted) && Boolean(currency) && !isPhpCurrency(currency);
  if (foreign && !hasActual) {
    const asQuoted = `Actual ${formatAmount(quoted, currency)} in ${currency}, not compared: no ${currency} Canvass winner to turn it into pesos`;
    return hasExpected ? `Expected ${formatPHP(expected)} · ${asQuoted}` : asQuoted;
  }
  if (!hasActual) return hasExpected && fromCanvass ? `${formatPHP(expected)} (Canvass winner)` : null;
  const atRate = foreign ? ` · ${formatAmount(quoted, currency)} at the Canvass rate` : "";
  if (!hasExpected || Number(expected) === Number(actual)) return `${formatPHP(actual)}${atRate}`;
  const change = ((Number(actual) - Number(expected)) / Number(expected)) * 100;
  return `Expected ${formatPHP(expected)} · Actual ${formatPHP(actual)} (${change > 0 ? "+" : ""}${change.toFixed(1)}%)${atRate}`;
}
