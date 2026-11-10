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
import { finiteNumber, isPhpCurrency, paymentPesos, paymentPhp } from "@/utils/landedCost"

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
    const debited = paymentPesos(payment);
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
 * The Reference Rate for a day: the latest row of `currency` on or before `onDate`
 * (the database's `reference_rate`). `rates` rows are `{ currency, rate_date, php_per_unit }`.
 */
export function referenceRateOn(rates = [], currency, onDate) {
  const code = String(currency ?? "").trim().toUpperCase();
  let best = null;
  for (const row of rates) {
    if (String(row?.currency ?? "").toUpperCase() !== code) continue;
    if (!(String(row.rate_date) <= String(onDate))) continue;
    if (!best || String(row.rate_date) > String(best.rate_date)) best = row;
  }
  return best;
}

/**
 * The rate for a foreign PO, with a payment whose pesos are blank taken at the Reference Rate
 * of its payment date (#604). Mirrors `_ipas_landed_cost`: payments in date order, a payment's
 * pesos are rounded to the centavo, and a blank one with no Reference Rate makes the whole
 * thing unavailable.
 *
 * @returns {{ rate, phpDebited, foreignPaid, payments, estimatedPayments, estimatedPhp,
 *   estimates: object[], shippingC: number } | { missingRate: true } | null} null with no payments
 */
export function blendedRate(payments = [], currency, referenceRates = []) {
  const rows = payments
    .filter((payment) => (finiteNumber(payment?.amount) ?? 0) > 0)
    .sort((a, b) => String(a.paid_on ?? "").localeCompare(String(b.paid_on ?? "")));
  if (rows.length === 0) return null;
  let php = 0;
  let foreign = 0;
  let estimatedPhp = 0;
  let shippingC = 0;
  const estimates = [];
  for (const payment of rows) {
    const amount = finiteNumber(payment.amount);
    const debited = paymentPesos(payment);
    let pesosOfPayment;
    if (debited !== null && debited > 0) {
      pesosOfPayment = debited;
    } else {
      const reference = referenceRateOn(referenceRates, currency, payment.paid_on);
      if (!reference) return { missingRate: true };
      pesosOfPayment = Math.round(amount * Number(reference.php_per_unit) * 100) / 100;
      estimatedPhp += pesosOfPayment;
      estimates.push({
        paymentId: payment.id ?? null,
        kind: payment.kind,
        paidOn: payment.paid_on,
        amount,
        referenceRate: Number(reference.php_per_unit),
        rateDate: reference.rate_date,
        php: pesosOfPayment,
      });
    }
    php += pesosOfPayment;
    foreign += amount;
    if (payment.kind === IPAS_PAYMENT_KIND.SHIPPING_FEE) shippingC += centavos(pesosOfPayment);
  }
  return {
    rate: php / foreign,
    phpDebited: php,
    foreignPaid: foreign,
    payments: rows.length,
    estimatedPayments: estimates.length,
    estimatedPhp,
    estimates,
    shippingC,
  };
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
 * @param {object}   [input.freight]       { amount, currency, billedBySupplier } (#709)
 * @param {string}   [input.split]         value | quantity | equal
 * @param {string}   [input.computationStatus]
 * @param {boolean}  [input.filed]         a filed IPAS is always final
 * @param {object[]} [input.referenceRates] currency_rates rows, for a payment whose pesos are blank (#604)
 * @returns {{
 *   status: "unavailable" | "provisional" | "final",
 *   estimate: boolean,
 *   estimates: object[],
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
  freight = null,
  split = IPAS_LANDED_COST_SPLIT.VALUE,
  computationStatus = IPAS_COMPUTATION_STATUS.ENCODING,
  filed = false,
  referenceRates = [],
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
    estimate: false,
    estimates: [],
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
  let estimates = [];
  let shippingForeignC = 0;
  if (!isPhp) {
    const blended = blendedRate(payments, currency, referenceRates);
    if (!blended) return unavailable(IPAS_LANDED_COST_REASON.NO_PAYMENTS);
    if (blended.missingRate) return unavailable(IPAS_LANDED_COST_REASON.NO_REFERENCE_RATE);
    const { estimates: list, shippingC, ...figures } = blended;
    paid = figures;
    estimates = list;
    shippingForeignC = shippingC;
    rate = paid.rate;
  }

  // The pool: every charge, every charge fee and every shipping fee.
  let chargesC = 0;
  for (const charge of charges) chargesC += centavos(charge?.amount_php);
  let feesC = 0;
  let shippingC = 0;
  for (const payment of payments) {
    feesC += centavos(payment?.charge_fee_php);
    if (isPhp && payment?.kind === IPAS_PAYMENT_KIND.SHIPPING_FEE) shippingC += centavos(paymentPhp(payment, isPhp));
  }
  // A foreign shipping fee counts at its pesos, or its estimated pesos while those are blank.
  if (!isPhp) shippingC = shippingForeignC;
  // Freight (#709): a typed freight amount is the freight, and the older shipping-fee payments stop
  // counting (they would be the same freight twice). Freight the supplier billed is inside the
  // payments already, so it adds nothing. In the PO's currency it converts at the blended rate; a
  // peso freight is taken as it is; any other currency can't be converted, so there is no figure.
  let freightC = 0;
  const freightAmount = finiteNumber(freight?.amount);
  if (freightAmount !== null) {
    shippingC = 0;
    const freightCurrency = String(freight?.currency || "PHP").toUpperCase();
    if (!isPhpCurrency(freightCurrency) && (isPhp || freightCurrency !== String(currency).toUpperCase())) {
      return unavailable(IPAS_LANDED_COST_REASON.FREIGHT_CURRENCY);
    }
    if (!freight?.billedBySupplier) {
      freightC = isPhpCurrency(freightCurrency) ? centavos(freightAmount) : Math.round(freightAmount * rate * 100);
    }
  }
  const poolC = chargesC + freightC + feesC + shippingC;

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
  // An estimate is never final.
  const final = (filed || FINAL_STATUSES.has(computationStatus)) && estimates.length === 0;

  return {
    ...base,
    status: final ? IPAS_LANDED_COST_STATUS.FINAL : IPAS_LANDED_COST_STATUS.PROVISIONAL,
    estimate: estimates.length > 0,
    estimates,
    reason: null,
    rate: paid,
    usedSplit,
    lines,
    totals: {
      goodsPhp: pesos(goodsC),
      chargesPhp: pesos(chargesC),
      freightPhp: pesos(freightC),
      chargeFeesPhp: pesos(feesC),
      shippingFeesPhp: pesos(shippingC),
      spreadPhp: pesos(poolC),
      landedPhp: pesos(goodsC + poolC),
    },
  };
}
