/**
 * Small shared helpers for IPAS money (#244). Pure: no network, no React.
 *
 * Landed Cost itself is worked out in one place only, the database
 * (`_ipas_landed_cost`, migration 20261019210000, #283): the IPAS page reads it
 * through `ipas_landed_cost`, the Costing Matrix and the SOR summary through
 * `ipas_line_landed_costs`. The fake database's copy of that maths lives in
 * src/test/stubs/landedCostFake.js, and the policy tier holds the two equal.
 */

/** A finite number, or null. Numeric columns can arrive as strings. */
export function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Whether the PO's currency is the peso. Anything else, or none, is foreign. */
export function isPhpCurrency(currency) {
  return String(currency ?? "").trim().toUpperCase() === "PHP";
}

/**
 * A payment's PHP value: its PHP debited on a foreign PO, its amount on a PHP
 * PO (null when a foreign payment has no PHP debited).
 */
export function paymentPhp(payment, isPhp) {
  if (isPhp) return finiteNumber(payment?.amount);
  return finiteNumber(payment?.php_debited);
}

