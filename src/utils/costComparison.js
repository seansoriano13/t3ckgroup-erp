import { formatPHP } from "../constants/sor";

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
 * Returns null when there is nothing to add to the Acquire field.
 */
export function costComparisonText({ expected, actual, fromCanvass = false }) {
  const hasActual = isNumber(actual);
  const hasExpected = isNumber(expected);
  if (!hasActual) return hasExpected && fromCanvass ? `${formatPHP(expected)} (Canvass winner)` : null;
  if (!hasExpected || Number(expected) === Number(actual)) return formatPHP(actual);
  const change = ((Number(actual) - Number(expected)) / Number(expected)) * 100;
  return `Expected ${formatPHP(expected)} · Actual ${formatPHP(actual)} (${change > 0 ? "+" : ""}${change.toFixed(1)}%)`;
}
