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
 * A Tender Line's totals. `tenderLine` carries `quantity`, and `abc_unit` and
 * `final_offer_unit` when the viewer's tier received them. The Components the
 * later tickets add are not read yet.
 *
 *   abcTotal, finalOfferTotal   unit x quantity, null while blank
 *   overAbc                     Final Offer total above ABC total (one centavo is enough)
 *   percentOfAbc                Final Offer total as a percentage of ABC total
 */
export function lineTotals(tenderLine) {
  const abc = extendedCentavos(tenderLine?.abc_unit, tenderLine?.quantity);
  const offer = extendedCentavos(tenderLine?.final_offer_unit, tenderLine?.quantity);
  return {
    abcTotal: pesosFromCentavos(abc),
    finalOfferTotal: pesosFromCentavos(offer),
    overAbc: abc !== null && offer !== null && offer > abc,
    percentOfAbc: abc !== null && offer !== null ? percentOf(pesosFromCentavos(offer), pesosFromCentavos(abc)) : null,
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
