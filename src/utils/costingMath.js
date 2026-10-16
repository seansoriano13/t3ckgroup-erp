/**
 * The Costing Matrix's figures (#267, spec #266). Pure: no network, no React.
 * The service, the screen, the print and the Stage Condition evaluators all
 * read their numbers from here, so the matrix says one thing everywhere.
 *
 * No decimal library: money is carried as BigInt centavos, and a unit price or
 * a quantity is first read as a number scaled by 10^6, so the product of two
 * decimals is exact. A figure is rounded to the centavo only when it is
 * returned, half away from zero (what the PMS sheet's ROUND does). Figures
 * come back as numbers in pesos with two decimals.
 *
 * Blank is never zero. A figure with a blank input is null; the reason is
 * counted beside it (`missingOffer`, `missingAbc`), never hidden in a total.
 * An input the viewer's tier never received is blank too: the service leaves
 * the key off, and a missing key reads exactly like a null.
 */

const MICRO = 1_000_000n;
// micro-pesos x micro-units = 10^12; a centavo is 10^10 of them.
const CENTAVO = 10_000_000_000n;

/** A number scaled by 10^6 as a BigInt, or null when blank or not a number. */
function scaled(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  const text = Math.abs(n).toFixed(6);
  const [whole, fraction] = text.split(".");
  const big = BigInt(whole) * MICRO + BigInt(fraction);
  return n < 0 ? -big : big;
}

/** Integer division rounded half away from zero. `divisor` is positive. */
function roundDiv(numerator, divisor) {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (magnitude * 2n + divisor) / (divisor * 2n);
  return negative ? -rounded : rounded;
}

/** `unit` per unit times `quantity`, in centavos, or null when either is blank. */
export function extendedCentavos(unit, quantity) {
  const u = scaled(unit);
  const q = scaled(quantity);
  if (u === null || q === null) return null;
  return roundDiv(u * q, CENTAVO);
}

/** Centavos back to pesos, or null. */
export function pesosFromCentavos(centavos) {
  return centavos === null || centavos === undefined ? null : Number(centavos) / 100;
}

/** unit price x quantity in pesos, rounded to the centavo; null when either is blank. */
export function extended(unit, quantity) {
  return pesosFromCentavos(extendedCentavos(unit, quantity));
}

/**
 * `part` as a percentage of `whole`, two decimals (93.13 for 2,980,000 of
 * 3,200,000); null when either is blank or the whole is zero.
 */
export function percentOf(part, whole) {
  const p = scaled(part);
  const w = scaled(whole);
  if (p === null || w === null || w === 0n) return null;
  // hundredths of a percent, rounded half away from zero
  return Number(roundDiv(p * 10_000n, w)) / 100;
}

/**
 * The sum of centavo amounts, or null when there is nothing to sum or any one of them is blank.
 * One blank cost makes the total unknown, not smaller: a missing Acquire must never read as zero.
 */
function sumUnlessBlank(amounts) {
  if (amounts.length === 0 || amounts.some((a) => a === null)) return null;
  return amounts.reduce((total, a) => total + a, 0n);
}

/**
 * A Component's (or a cost-only row's) totals: each unit cost times its quantity, null while that
 * unit cost is blank or the viewer's tier never received it. A bundle is priced as a whole, so a
 * bundle at 1 x 2,160,500 totals 2,160,500.
 */
export function componentTotals(component) {
  return {
    acquireTotal: pesosFromCentavos(extendedCentavos(component?.acquire_unit, component?.quantity)),
    odooTotal: pesosFromCentavos(extendedCentavos(component?.odoo_unit, component?.quantity)),
  };
}

/** Cost-only rows have the same two totals as a Component. */
export const costRowTotals = componentTotals;

/**
 * The totals of a set of cost-only rows (the rows below the Tender Lines): each total is null
 * unless every row has that cost. They are never part of a Tender Line's totals.
 */
export function costRowsTotals(rows) {
  const list = rows ?? [];
  return {
    acquireTotal: pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(r?.acquire_unit, r?.quantity)))),
    odooTotal: pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(r?.odoo_unit, r?.quantity)))),
  };
}

/**
 * The Final Acquire of a set of Components or cost-only rows added up (#270), or null when there are
 * none or any one has no Final Acquire. Closed Book only: no other tier is sent the figures.
 */
export function finalAcquireTotal(rows) {
  const list = rows ?? [];
  return pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(r?.final_acquire_unit, r?.quantity))));
}

/**
 * A Tender Line's totals. `tenderLine` carries `quantity`, and `abc_unit` and
 * `final_offer_unit` when the viewer's tier received them. `components` are the line's Components,
 * each with `quantity` and the unit costs the viewer's tier received (`acquire_unit`, `odoo_unit`).
 * Cost-only rows are not passed here: they stay out of a line's totals.
 *
 *   abcTotal, finalOfferTotal   unit x quantity, null while blank
 *   overAbc                     Final Offer total above ABC total (one centavo is enough)
 *   percentOfAbc                Final Offer total as a percentage of ABC total
 *   acquireTotal, odooTotal     the Components' totals added up; null when the line has no
 *                               Component, or any Component has that cost blank (never zero)
 */
export function lineTotals(tenderLine, components = []) {
  const abc = extendedCentavos(tenderLine?.abc_unit, tenderLine?.quantity);
  const offer = extendedCentavos(tenderLine?.final_offer_unit, tenderLine?.quantity);
  const list = components ?? [];
  return {
    abcTotal: pesosFromCentavos(abc),
    finalOfferTotal: pesosFromCentavos(offer),
    overAbc: abc !== null && offer !== null && offer > abc,
    percentOfAbc: abc !== null && offer !== null ? percentOf(pesosFromCentavos(offer), pesosFromCentavos(abc)) : null,
    acquireTotal: pesosFromCentavos(sumUnlessBlank(list.map((c) => extendedCentavos(c?.acquire_unit, c?.quantity)))),
    odooTotal: pesosFromCentavos(sumUnlessBlank(list.map((c) => extendedCentavos(c?.odoo_unit, c?.quantity)))),
  };
}

/**
 * The whole matrix's totals over its Tender Lines.
 *
 *   finalOfferTotal   the sum, null while any Tender Line has no Final Offer
 *   abcTotal          the sum, null unless every Tender Line has an ABC
 *                     (a government ceiling only means something when it covers every line)
 *   missingOffer      how many Tender Lines have no Final Offer
 *   missingAbc        how many have no ABC
 *   overAbc           the Final Offer total above the ABC total
 *   percentOfAbc      Final Offer as a percentage of ABC
 *
 * No Tender Lines gives nulls and zero counts.
 */
export function matrixTotals(tenderLines) {
  const lines = tenderLines ?? [];
  let abc = 0n;
  let offer = 0n;
  let missingAbc = 0;
  let missingOffer = 0;
  for (const line of lines) {
    const a = extendedCentavos(line?.abc_unit, line?.quantity);
    const o = extendedCentavos(line?.final_offer_unit, line?.quantity);
    if (a === null) missingAbc += 1;
    else abc += a;
    if (o === null) missingOffer += 1;
    else offer += o;
  }
  const abcTotal = lines.length > 0 && missingAbc === 0 ? abc : null;
  const finalOfferTotal = lines.length > 0 && missingOffer === 0 ? offer : null;
  const both = abcTotal !== null && finalOfferTotal !== null;
  return {
    abcTotal: pesosFromCentavos(abcTotal),
    finalOfferTotal: pesosFromCentavos(finalOfferTotal),
    missingAbc,
    missingOffer,
    overAbc: both && finalOfferTotal > abcTotal,
    percentOfAbc: both ? percentOf(pesosFromCentavos(finalOfferTotal), pesosFromCentavos(abcTotal)) : null,
  };
}

/**
 * The summary, copied from the PMS sheet (#270, #213). Closed Book (#319): the caller passes the
 * matrix as shaped from what the tier received, and only the Closed Book tier receives the Final
 * Acquire figures, so only it can compute this; every other tier is given no summary at all.
 *
 *   matrix.tenderLines   each with `quantity`, `final_offer_unit`, `abc_unit` and its `components`
 *                        (each with `quantity` and `final_acquire_unit`)
 *   matrix.costRows      the cost-only rows (`quantity`, `final_acquire_unit`)
 *   matrix.money         `{ marketing, opex }`, typed by Finance access or the Final Acquire list
 *   settings             `{ vatDivisor, taxRate, retentionRate, itrRate, itrAllowance }`
 *
 * Returns, in pesos to the centavo (each worked in exact decimals and rounded half away from zero
 * once, on return):
 *
 *   finalOfferTotal       the Tender Lines' Final Offers added up
 *   vatExclusive          Final Offer / VAT divisor (1.12)
 *   tax                   Final Offer x tax rate (6%), on the gross offer
 *   retention             Final Offer x retention rate (1%)
 *   collected             Final Offer - tax - retention
 *   operationalExpenses   the Final Acquire total (every Component and cost-only row)
 *   marketing, opex       as typed
 *   itr                   (Final Offer - allowance) x ITR rate (8%); negative below the allowance, as the sheet has it
 *   revenue               (Final Offer - Final Acquire total) - ITR
 *   abcTotal, percentOfAbc, overAbc   the ABC ceiling, only when every Tender Line has an ABC
 *
 * A figure that cannot be computed is null and says why in `incomplete`: `missingOffer` Tender Lines
 * have no Final Offer (every offer figure is null), `missingCost` Components and cost-only rows have
 * no Final Acquire (operational expenses and revenue are null). `noTenderLines` and `noCostRows`
 * say the matrix has nothing to add up yet, so an empty matrix never reads as zero cost.
 * A blank is never zero.
 */
export function summary(matrix, settings) {
  const lines = matrix?.tenderLines ?? [];
  const costed = [...lines.flatMap((line) => line?.components ?? []), ...(matrix?.costRows ?? [])];

  const offers = lines.map((line) => extendedCentavos(line?.final_offer_unit, line?.quantity));
  const missingOffer = offers.filter((o) => o === null).length;
  const offer = lines.length > 0 && missingOffer === 0 ? offers.reduce((sum, o) => sum + o, 0n) : null;

  const costs = costed.map((row) => extendedCentavos(row?.final_acquire_unit, row?.quantity));
  const missingCost = costs.filter((c) => c === null).length;
  const acquire = costed.length > 0 && missingCost === 0 ? costs.reduce((sum, c) => sum + c, 0n) : null;

  const divisor = scaled(settings?.vatDivisor);
  const taxRate = scaled(settings?.taxRate);
  const retentionRate = scaled(settings?.retentionRate);
  const itrRate = scaled(settings?.itrRate);
  const allowance = extendedCentavos(settings?.itrAllowance, 1);

  // Rates are scaled by 10^6, so a rate times a centavo amount divides back by 10^6 once.
  const byRate = (centavos, rate) => (centavos === null || rate === null ? null : roundDiv(centavos * rate, MICRO));

  const vatExclusive = offer === null || divisor === null || divisor <= 0n ? null : roundDiv(offer * MICRO, divisor);
  const tax = byRate(offer, taxRate);
  const retention = byRate(offer, retentionRate);
  const collected =
    offer === null || taxRate === null || retentionRate === null ? null : roundDiv(offer * (MICRO - taxRate - retentionRate), MICRO);
  const itr = offer === null || allowance === null || itrRate === null ? null : roundDiv((offer - allowance) * itrRate, MICRO);
  const revenue =
    offer === null || acquire === null || allowance === null || itrRate === null
      ? null
      : roundDiv((offer - acquire) * MICRO - (offer - allowance) * itrRate, MICRO);

  const ceiling = matrixTotals(lines);

  return {
    finalOfferTotal: pesosFromCentavos(offer),
    vatExclusive: pesosFromCentavos(vatExclusive),
    tax: pesosFromCentavos(tax),
    retention: pesosFromCentavos(retention),
    collected: pesosFromCentavos(collected),
    operationalExpenses: pesosFromCentavos(acquire),
    marketing: pesosFromCentavos(extendedCentavos(matrix?.money?.marketing, 1)),
    opex: pesosFromCentavos(extendedCentavos(matrix?.money?.opex, 1)),
    itr: pesosFromCentavos(itr),
    revenue: pesosFromCentavos(revenue),
    abcTotal: ceiling.abcTotal,
    percentOfAbc: ceiling.percentOfAbc,
    overAbc: ceiling.overAbc,
    incomplete: { missingCost, missingOffer, noTenderLines: lines.length === 0, noCostRows: costed.length === 0 },
  };
}
