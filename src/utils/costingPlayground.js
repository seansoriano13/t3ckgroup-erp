/**
 * The markup playground (Costing Desk): what the matrix would offer at a markup factor nobody has saved
 * yet. Every Component is priced at its own factor when it has one, else at the factor being tried; a
 * line's Final Offer per unit is its Components' Markup Prices over its quantity, kept at its ABC when
 * asked. Only the Closed Book has the Acquires this needs; for anyone else every figure is blank.
 *
 * Figures are in pesos to the centavo, worked in centavos like costingMath. A blank is never zero.
 */
import { effectiveFactor, extended, extendedCentavos, markupPrice, pesosFromCentavos, percentOf } from "./costingMath";

const centavos = (pesos) => extendedCentavos(pesos, 1);

/** Half away from zero, to the centavo. */
const roundToCentavo = (value) => Math.round(value * 100) / 100;

/**
 * One line at `factor`: `{ priceTotal, offerUnit, capped }`. `priceTotal` is the Components' Markup Prices
 * added up (null when the line has no Component or any Acquire is blank); `offerUnit` is that over the
 * line's quantity, at most the ABC per unit when `capAtAbc` and the ABC is known; `capped` says the ABC won.
 * `ignoreOwn` prices every Component at `factor`, its own factor or not.
 */
export function linePlay(line, factor, { capAtAbc = true, ignoreOwn = false } = {}) {
  const components = line?.components ?? [];
  if (components.length === 0) return { priceTotal: null, offerUnit: null, capped: false };
  let total = 0n;
  for (const c of components) {
    const price = markupPrice(c?.acquire_unit, c?.quantity, effectiveFactor(ignoreOwn ? { ...c, markup_factor: null } : c, factor));
    if (price === null) return { priceTotal: null, offerUnit: null, capped: false };
    total += centavos(price);
  }
  const priceTotal = pesosFromCentavos(total);
  const quantity = Number(line?.quantity);
  if (!(quantity > 0)) return { priceTotal, offerUnit: null, capped: false };
  const unit = roundToCentavo(priceTotal / quantity);
  const abc = line?.abc_unit == null ? null : Number(line.abc_unit);
  if (capAtAbc && abc !== null && unit > abc) return { priceTotal, offerUnit: abc, capped: true };
  return { priceTotal, offerUnit: unit, capped: false };
}

/**
 * The whole matrix at `factor`:
 *
 *   lines          `{ id, offerUnit, capped }` per Tender Line (offerUnit null when it cannot be priced)
 *   offerTotal     the lines' offers added up; null while any line cannot be priced
 *   unpriced       how many lines cannot be priced (no Component, or an Acquire is blank)
 *   capped         how many lines were kept at their ABC
 *   cost           every Component's and cost-only row's Acquire added up; null while any is blank
 *   margin         offerTotal - cost; null while either is
 *   marginPercent  margin as a percentage of offerTotal
 *   percentOfAbc   offerTotal as a percentage of the ABC total (only when every line has an ABC)
 */
export function matrixPlay(matrix, factor, { capAtAbc = true, ignoreOwn = false } = {}) {
  const tenderLines = matrix?.tenderLines ?? [];
  const lines = tenderLines.map((line) => ({ id: line.id, ...linePlay(line, factor, { capAtAbc, ignoreOwn }) }));
  const unpriced = lines.filter((l) => l.offerUnit === null).length;
  const capped = lines.filter((l) => l.capped).length;

  let offer = 0n;
  tenderLines.forEach((line, i) => {
    if (lines[i].offerUnit !== null) offer += extendedCentavos(lines[i].offerUnit, line.quantity);
  });
  const offerTotal = tenderLines.length > 0 && unpriced === 0 ? pesosFromCentavos(offer) : null;

  const costed = [...tenderLines.flatMap((l) => l.components ?? []), ...(matrix?.costRows ?? [])];
  let cost = 0n;
  let costKnown = tenderLines.length > 0 && tenderLines.every((l) => (l.components ?? []).length > 0);
  for (const row of costed) {
    const c = extendedCentavos(row?.acquire_unit, row?.quantity);
    if (c === null) costKnown = false;
    else cost += c;
  }
  const costTotal = costKnown ? pesosFromCentavos(cost) : null;
  const margin = offerTotal !== null && costTotal !== null ? extended(offerTotal - costTotal, 1) : null;

  const abc = tenderLines.length > 0 && tenderLines.every((l) => l.abc_unit != null)
    ? pesosFromCentavos(tenderLines.reduce((sum, l) => sum + extendedCentavos(l.abc_unit, l.quantity), 0n))
    : null;

  return {
    lines,
    offerTotal,
    unpriced,
    capped,
    cost: costTotal,
    margin,
    marginPercent: margin !== null && offerTotal ? percentOf(margin, offerTotal) : null,
    percentOfAbc: offerTotal !== null && abc ? percentOf(offerTotal, abc) : null,
  };
}
