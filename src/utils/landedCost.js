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

/**
 * Whether a Landed Cost (the shape `ipas_landed_cost` returns) is an estimate (#604): a
 * foreign-currency payment's "Pesos taken from the bank" is still blank, so that payment was
 * taken at its payment date's Reference Rate. An estimate is never stored, and is never final.
 */
export function isLandedCostEstimate(landedCost) {
  return Boolean(landedCost?.estimate) && landedCost?.status !== "unavailable";
}

/** The mark Landed Cost carries: Estimate, Provisional, Final or Not available. */
export function landedCostMarkLabel(landedCost) {
  if (!landedCost || landedCost.status === "unavailable") return "Not available";
  if (isLandedCostEstimate(landedCost)) return "Estimate";
  return landedCost.status === "final" ? "Final" : "Provisional";
}

/** One sentence saying why a Landed Cost is an estimate and what makes it final, or null. */
export function landedCostEstimateNote(landedCost) {
  if (!isLandedCostEstimate(landedCost)) return null;
  const count = landedCost.estimates?.length ?? landedCost.rate?.estimatedPayments ?? 0;
  const which = count === 1 ? "A payment is" : `${count} payments are`;
  return `Estimate: ${which} taken at the Reference Rate of its payment date, because the pesos taken from the bank are not filled in. It becomes final when they are.`;
}

