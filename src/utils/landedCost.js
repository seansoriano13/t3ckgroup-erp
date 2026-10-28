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

/**
 * IPAS money is added in whole centavos so a long column never drifts. These are the only
 * conversions: figures, totals, the export and the Costing Matrix page all use them.
 */
export const toCents = (n) => Math.round(n * 100);
export const fromCents = (cents) => cents / 100;

/** Adds pesos (or any currency) exactly, to the centavo. */
export const sumPesos = (values) => fromCents(values.reduce((sum, v) => sum + toCents(v), 0));

/**
 * The rate of a payment: the forex rate it was paid at, or (an old payment) its pesos divided by its
 * amount. Null when neither is known.
 */
export function paymentRate(payment) {
  const stored = finiteNumber(payment?.forex_rate);
  if (stored !== null && stored > 0) return stored;
  const php = finiteNumber(payment?.php_debited);
  const amount = finiteNumber(payment?.amount);
  return php !== null && amount !== null && amount > 0 ? php / amount : null;
}

/** The pesos of a foreign payment: amount x rate, to the centavo. Null when there is no rate. */
export function pesosFromRate(amount, rate) {
  const a = finiteNumber(amount);
  const r = finiteNumber(rate);
  return a === null || r === null ? null : fromCents(Math.round(a * r * 100));
}

/**
 * The blended rate of several payments: all their pesos over all their amounts, so a bigger
 * payment weighs more. Payments with no rate are left out. Null when none has one.
 */
export function blendedRate(payments = []) {
  let pesos = 0;
  let amount = 0;
  for (const payment of payments) {
    const rate = paymentRate(payment);
    const paid = finiteNumber(payment?.amount);
    if (rate === null || paid === null || paid <= 0) continue;
    pesos += paid * rate;
    amount += paid;
  }
  return amount > 0 ? pesos / amount : null;
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

