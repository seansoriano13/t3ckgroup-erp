/**
 * The fake database's copy of the Landed Cost maths (#218, #244, #283).
 *
 * The real calculation is the database's `_ipas_landed_cost` (supabase/
 * migrations/20261019210000_ipas_landed_cost_one_copy.sql). The fake database
 * does not run SQL, so the stubs (ipasRpc.js, costingMatrixRpc.js) answer
 * `ipas_landed_cost` and `costing_landed_costs` with this. It is test-only: no
 * app code imports it. 96-ipas-landed-cost-parity.test.js (policy tier) runs
 * the same fixtures through both and holds them equal.
 */

import {
  IPAS_COMPUTATION_STATUS,
  IPAS_LANDED_COST_REASON,
  IPAS_LANDED_COST_SPLIT,
  IPAS_LANDED_COST_STATUS,
  IPAS_PAYMENT_KIND,
} from "@/constants/ipas"
import { finiteNumber, isPhpCurrency, paymentPhp } from "@/utils/landedCost"

const FINAL_STATUSES = new Set([IPAS_COMPUTATION_STATUS.LC_ODOO_DONE, IPAS_COMPUTATION_STATUS.CHECKED])

const centavos = (pesos) => Math.round((finiteNumber(pesos) ?? 0) * 100)
const pesos = (cents) => cents / 100

/**
 * The rate actually paid so far: total PHP debited / total foreign amount,
 * across the payments that carry a PHP debited. Null when there is none.
 * `{ rate, phpDebited, foreignPaid, payments }`.
 */
export function paidRate(payments = []) {
  let php = 0;
  let foreign = 0;
  let used = 0;
  for (const payment of payments) {
    const debited = finiteNumber(payment?.php_debited);
    const amount = finiteNumber(payment?.amount);
    if (debited === null || amount === null || debited <= 0 || amount <= 0) continue;
    php += debited;
    foreign += amount;
    used += 1;
  }
  if (used === 0 || foreign === 0) return null;
  return { rate: php / foreign, phpDebited: php, foreignPaid: foreign, payments: used };
}

/**
 * Shares `total` centavos over `weights` in proportion, whole centavos, summing
 * to `total` exactly (largest remainder; ties go to the earlier line).
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (!(sum > 0)) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((x) => Math.floor(x));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/**
 * Landed Cost per line and per unit.
 *
 * @param {object} input
 * @param {object} input.copy              the stored Odoo copy ({ po, lines })
 * @param {object[]} [input.payments]      ipas_payments rows
 * @param {object[]} [input.charges]       ipas_charges rows
 * @param {string}   [input.split]         value | quantity | equal
 * @param {string}   [input.computationStatus]
 * @param {boolean}  [input.filed]         a filed IPAS is always final
 * @returns {{
 *   status: "unavailable" | "provisional" | "final",
 *   reason: string | null,
 *   currency: string | null,
 *   isForeign: boolean,
 *   rate: { rate: number, phpDebited: number, foreignPaid: number, payments: number } | null,
 *   split: string,
 *   usedSplit: string,
 *   lines: object[],
 *   totals: object | null,
 * }}
 */
export function computeLandedCost({
  copy,
  payments = [],
  charges = [],
  split = IPAS_LANDED_COST_SPLIT.VALUE,
  computationStatus = IPAS_COMPUTATION_STATUS.ENCODING,
  filed = false,
} = {}) {
  const currency = copy?.po?.currency ?? null;
  const isPhp = isPhpCurrency(currency);
  const wanted = Object.values(IPAS_LANDED_COST_SPLIT).includes(split) ? split : IPAS_LANDED_COST_SPLIT.VALUE;

  const base = {
    currency,
    isForeign: !isPhp,
    rate: null,
    split: wanted,
    usedSplit: wanted,
    lines: [],
    totals: null,
  };
  const unavailable = (reason) => ({ ...base, status: IPAS_LANDED_COST_STATUS.UNAVAILABLE, reason });

  // Only lines that are goods being bought: a quantity, and a price.
  const poLines = (Array.isArray(copy?.lines) ? copy.lines : []).filter((line) => {
    const quantity = finiteNumber(line?.quantity);
    return quantity !== null && quantity > 0;
  });
  if (poLines.length === 0) return unavailable(IPAS_LANDED_COST_REASON.NO_LINES);

  let rate = 1;
  let paid = null;
  if (!isPhp) {
    paid = paidRate(payments);
    if (!paid) return unavailable(IPAS_LANDED_COST_REASON.NO_PAYMENTS);
    rate = paid.rate;
  }

  // The pool: every charge, every charge fee and every shipping fee.
  let chargesC = 0;
  for (const charge of charges) chargesC += centavos(charge?.amount_php);
  let feesC = 0;
  let shippingC = 0;
  for (const payment of payments) {
    feesC += centavos(payment?.charge_fee_php);
    if (payment?.kind === IPAS_PAYMENT_KIND.SHIPPING_FEE) shippingC += centavos(paymentPhp(payment, isPhp));
  }
  const poolC = chargesC + feesC + shippingC;

  // Each line's goods, in PHP.
  const items = poLines.map((line) => {
    const quantity = finiteNumber(line.quantity);
    const unitPrice = finiteNumber(line.price_unit) ?? 0;
    return {
      line,
      quantity,
      unitPrice,
      goodsC: Math.round(quantity * unitPrice * rate * 100),
    };
  });

  // By value needs value to spread over; with nothing priced it can't, so the
  // spread falls back to equal and says so.
  let usedSplit = wanted;
  let weights;
  if (usedSplit === IPAS_LANDED_COST_SPLIT.VALUE) {
    weights = items.map((item) => item.goodsC);
    if (!(weights.reduce((a, b) => a + b, 0) > 0)) usedSplit = IPAS_LANDED_COST_SPLIT.EQUAL;
  }
  if (usedSplit === IPAS_LANDED_COST_SPLIT.QUANTITY) weights = items.map((item) => item.quantity);
  if (usedSplit === IPAS_LANDED_COST_SPLIT.EQUAL) weights = items.map(() => 1);

  const shares = allocate(poolC, weights);

  const lines = items.map((item, index) => {
    const landedC = item.goodsC + shares[index];
    return {
      lineId: item.line.line_id ?? null,
      name: item.line.name ?? "",
      brand: item.line.brand ?? null,
      unit: item.line.unit ?? null,
      quantity: item.quantity,
      unitPriceForeign: item.unitPrice,
      unitPricePhp: Math.round(item.unitPrice * rate * 100) / 100,
      goodsPhp: pesos(item.goodsC),
      spreadPhp: pesos(shares[index]),
      landedPhp: pesos(landedC),
      landedPerUnitPhp: Math.round(landedC / item.quantity) / 100,
    };
  });

  const goodsC = items.reduce((sum, item) => sum + item.goodsC, 0);
  const final = filed || FINAL_STATUSES.has(computationStatus);

  return {
    ...base,
    status: final ? IPAS_LANDED_COST_STATUS.FINAL : IPAS_LANDED_COST_STATUS.PROVISIONAL,
    reason: null,
    rate: paid,
    usedSplit,
    lines,
    totals: {
      goodsPhp: pesos(goodsC),
      chargesPhp: pesos(chargesC),
      chargeFeesPhp: pesos(feesC),
      shippingFeesPhp: pesos(shippingC),
      spreadPhp: pesos(poolC),
      landedPhp: pesos(goodsC + poolC),
    },
  };
}
