import { COST_SOURCE } from "../constants/costing";

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
 * The unit cost the totals use (#686): the Actual (the attached P0 line's price) when there is
 * one, otherwise Acquire. The typed Acquire is never overwritten; a viewer whose tier was not sent
 * the Actual simply gets Acquire.
 */
export function effectiveAcquireUnit(row) {
  const actual = row?.p0_unit_price;
  return actual !== null && actual !== undefined && actual !== "" ? actual : row?.acquire_unit;
}

/**
 * A Component's (or a cost-only row's) totals: each unit cost times its quantity, null while that
 * unit cost is blank or the viewer's tier never received it. A bundle is priced as a whole, so a
 * bundle at 1 x 2,160,500 totals 2,160,500.
 */
export function componentTotals(component) {
  return {
    acquireTotal: pesosFromCentavos(extendedCentavos(effectiveAcquireUnit(component), component?.quantity)),
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
    acquireTotal: pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(effectiveAcquireUnit(r), r?.quantity)))),
    odooTotal: pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(r?.odoo_unit, r?.quantity)))),
  };
}

/**
 * The cost a row counts at: its Final Acquire (old deals, kept as signed) or else its Acquire
 * (#787; Final Acquire left the screen in #703). Same rule as the database's costing_settled_met.
 */
export function costUnit(row) {
  const final = row?.final_acquire_unit;
  return final !== null && final !== undefined && final !== "" ? final : row?.acquire_unit;
}

/**
 * The cost of a set of Components or cost-only rows added up (#270), or null when there are
 * none or any one has no Final Acquire. Closed Book only: no other tier is sent the figures.
 */
export function finalAcquireTotal(rows) {
  const list = rows ?? [];
  return pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(costUnit(r), r?.quantity))));
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
    acquireTotal: pesosFromCentavos(sumUnlessBlank(list.map((c) => extendedCentavos(effectiveAcquireUnit(c), c?.quantity)))),
    odooTotal: pesosFromCentavos(sumUnlessBlank(list.map((c) => extendedCentavos(c?.odoo_unit, c?.quantity)))),
    landedCost: landedCostRollup(list),
  };
}

/**
 * The Landed Cost of a set of Components added up (#283): `{ total, mark }`, or null while any
 * Component is blank, when there are none, or when the tier was never sent Landed Cost (a
 * Component with no `landed_cost` key). `provisional` while any Component is, else `final`.
 * It is a fourth cost beside Acquire, Odoo and Final Acquire: nothing else here reads it.
 */
export function landedCostRollup(components) {
  const list = components ?? [];
  if (list.length === 0) return null;
  let total = 0n;
  let provisional = false;
  for (const component of list) {
    const landed = component?.landed_cost;
    const cents = landed ? extendedCentavos(landed.total, 1) : null;
    if (cents === null) return null;
    total += cents;
    if (landed.mark !== "final") provisional = true;
  }
  return { total: pesosFromCentavos(total), mark: provisional ? "provisional" : "final" };
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
    // Every Tender Line's Components, blank while any line is (a line with no Component included).
    // Cost-only rows have no Requested Item, so they never take part.
    landedCost: lines.some((line) => (line?.components ?? []).length === 0) ? null : landedCostRollup(lines.flatMap((line) => line.components)),
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
 *   finalVat              VAT-exclusive x final VAT rate (12%, #705)
 *   tax                   Final Offer x tax rate (6%), on the gross offer
 *   retention             Final Offer x retention rate (1%)
 *   collected             Final Offer - tax - retention
 *   operationalExpenses   the Final Acquire total (every Component and cost-only row)
 *   marketing, opex       as typed
 *   itr                   (Final Offer - allowance) x ITR rate (8%); zero at or below the allowance, so it never adds to Revenue
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

  const costs = costed.map((row) => extendedCentavos(costUnit(row), row?.quantity));
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
  const finalVatRate = scaled(settings?.finalVatRate ?? 0.12);
  const finalVat = byRate(vatExclusive, finalVatRate);
  const tax = byRate(offer, taxRate);
  const retention = byRate(offer, retentionRate);
  const collected =
    offer === null || taxRate === null || retentionRate === null ? null : roundDiv(offer * (MICRO - taxRate - retentionRate), MICRO);
  // Only the part of the offer above the allowance is taxed. Below it the sheet's formula goes
  // negative and would add to Revenue, so the taxed amount stops at zero.
  const taxed = taxedOffer(offer, allowance);
  const itr = taxed === null || itrRate === null ? null : roundDiv(taxed * itrRate, MICRO);
  const revenue = revenueCentavos(offer, acquire, taxed, itrRate);

  const ceiling = matrixTotals(lines);

  return {
    finalOfferTotal: pesosFromCentavos(offer),
    vatExclusive: pesosFromCentavos(vatExclusive),
    finalVat: pesosFromCentavos(finalVat),
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

/** Revenue in centavos: (Final Offer - cost) - ITR on the taxed part of the offer. Null while any input is blank. */
function revenueCentavos(offer, cost, taxed, itrRate) {
  if (offer === null || cost === null || taxed === null || itrRate === null) return null;
  return roundDiv((offer - cost) * MICRO - taxed * itrRate, MICRO);
}

/** The part of the offer above the ITR allowance, in centavos (zero at or below it); null while blank. */
function taxedOffer(offer, allowance) {
  return offer === null || allowance === null ? null : offer > allowance ? offer - allowance : 0n;
}

/**
 * The per-SOR totals that Planned and Actual Revenue are worked from (#605), taken from a shaped
 * matrix (Closed Book: Components carry `final_acquire_unit` and `landed_cost`). The Costing Matrix
 * page (#606) builds the same object from its database read, so the page and the SOR's own summary
 * share one set of maths (`revenueComparison`). Pesos, or null where a figure cannot be worked.
 *
 *   finalOfferTotal         the Tender Lines' Final Offers added up (null while any is blank)
 *   finalAcquireTotal       every Component and cost-only row at Final Acquire (null while any is blank)
 *   landedCostTotal         the Landed Cost of the bought Components; 0 when none is bought
 *   boughtFinalAcquireTotal the Final Acquire of those same bought Components; 0 when none is bought
 *   itemsBought, itemsTotal bought Components out of all Components (cost-only rows are never bought)
 *   ipasShort               true while any IPAS of the SOR has not reached LC Odoo Done (the caller says so;
 *                           a bought Component whose Landed Cost is provisional says so too)
 *
 * A Component is bought by isBoughtComponent; its Landed Cost still decides the Actual figures. One with none (not ordered, or its P0 line not
 * picked yet) stays at Final Acquire.
 */
/**
 * One rule for "bought" (#791), the same as the S0 Evaluation list's Items bought in the database: a
 * Component has a Landed Cost, or one of its Purchase Request lines is Purchased or Received.
 */
export function isBoughtComponent(component) {
  if (component?.landed_cost && extendedCentavos(component.landed_cost.total, 1) !== null) return true;
  return (component?.purchases?.requests ?? []).some((r) => r.status === "purchased" || r.status === "received");
}

export function revenueInputs(matrix, { ipasShort = false } = {}) {
  const lines = matrix?.tenderLines ?? [];
  const components = lines.flatMap((line) => line?.components ?? []);
  const costRows = matrix?.costRows ?? [];

  const offers = lines.map((line) => extendedCentavos(line?.final_offer_unit, line?.quantity));
  const offer = lines.length > 0 && offers.every((o) => o !== null) ? offers.reduce((sum, o) => sum + o, 0n) : null;

  const costed = [...components, ...costRows].map((row) => extendedCentavos(costUnit(row), row?.quantity));
  const acquire = costed.length > 0 && costed.every((c) => c !== null) ? costed.reduce((sum, c) => sum + c, 0n) : null;

  let landed = 0n;
  let boughtAcquire = 0n;
  let boughtAcquireKnown = true;
  let itemsBought = 0;
  let provisional = false;
  for (const component of components) {
    if (isBoughtComponent(component)) itemsBought += 1;
    const lc = component?.landed_cost ? extendedCentavos(component.landed_cost.total, 1) : null;
    if (lc === null) continue;
    // A Landed Cost is final only once its IPAS reached LC Odoo Done, so a provisional one is proof of a short IPAS.
    if (component.landed_cost.mark !== "final") provisional = true;
    landed += lc;
    const fa = extendedCentavos(costUnit(component), component?.quantity);
    if (fa === null) boughtAcquireKnown = false;
    else boughtAcquire += fa;
  }

  return {
    finalOfferTotal: pesosFromCentavos(offer),
    finalAcquireTotal: pesosFromCentavos(acquire),
    landedCostTotal: pesosFromCentavos(landed),
    boughtFinalAcquireTotal: boughtAcquireKnown ? pesosFromCentavos(boughtAcquire) : null,
    itemsBought,
    itemsTotal: components.length,
    ipasShort: Boolean(ipasShort) || provisional,
  };
}

/**
 * Planned Revenue and Actual Revenue side by side (#605, glossary "Planned Revenue / Actual
 * Revenue"). Takes the per-SOR totals of `revenueInputs` and the summary's rates (`itrRate`,
 * `itrAllowance`), so the SOR's summary and the Costing Matrix page work the same figures.
 *
 *   planned      exactly the summary's Revenue: (Final Offer - Final Acquire total) - ITR
 *   actual       the same Revenue with each bought Component at its Landed Cost instead of its
 *                Final Acquire; an unbought Component, and every cost-only row, stays at Final Acquire.
 *                ITR is on the offer, so it is the same for both.
 *   difference   actual - planned: negative when buying cost more than planned
 *   actualLower  actual is below planned (the highlight)
 *   estimate     actual is provisional while any IPAS of the SOR is short of LC Odoo Done
 *   itemsBought, itemsTotal, notBought   how many Components are bought, and how many are not yet
 *   plannedCost, actualCost              the cost line each Revenue was worked from
 *
 * Each figure is null while an input is blank (never zero): no Final Offer or a Final Acquire gap
 * blanks both; a bought Component with no Final Acquire, or a missing Landed Cost total, blanks Actual.
 */
export function revenueComparison(totals, settings) {
  const offer = extendedCentavos(totals?.finalOfferTotal, 1);
  const acquire = extendedCentavos(totals?.finalAcquireTotal, 1);
  const landed = extendedCentavos(totals?.landedCostTotal, 1);
  const boughtAcquire = extendedCentavos(totals?.boughtFinalAcquireTotal, 1);
  const itrRate = scaled(settings?.itrRate);
  const taxed = taxedOffer(offer, extendedCentavos(settings?.itrAllowance, 1));

  const actualCost = acquire === null || landed === null || boughtAcquire === null ? null : acquire - boughtAcquire + landed;
  const planned = revenueCentavos(offer, acquire, taxed, itrRate);
  const actual = revenueCentavos(offer, actualCost, taxed, itrRate);
  const itemsBought = Number(totals?.itemsBought) || 0;
  const itemsTotal = Number(totals?.itemsTotal) || 0;

  return {
    planned: pesosFromCentavos(planned),
    actual: pesosFromCentavos(actual),
    difference: planned === null || actual === null ? null : pesosFromCentavos(actual - planned),
    actualLower: planned !== null && actual !== null && actual < planned,
    estimate: Boolean(totals?.ipasShort),
    itemsBought,
    itemsTotal,
    notBought: Math.max(itemsTotal - itemsBought, 0),
    plannedCost: pesosFromCentavos(acquire),
    actualCost: pesosFromCentavos(actualCost),
  };
}

// ---------------------------------------------------------------------------
// Markup (#269)
// ---------------------------------------------------------------------------

/** A blank (null, undefined or empty) is not a number: it never counts as zero. */
const blank = (value) => value === null || value === undefined || value === "";

/**
 * Markup Price per unit: Acquire x factor, rounded half up to the centavo. Null while Acquire or the
 * factor is blank, never zero. The database computes the same figure for the price tier
 * (`costing_markup_price`); a policy test (80) holds the two to the same answers.
 */
export function markupPriceUnit(acquireUnit, factor) {
  const acquire = scaled(acquireUnit);
  const f = scaled(factor);
  if (acquire === null || f === null) return null;
  return pesosFromCentavos(roundDiv(acquire * f, CENTAVO));
}

/**
 * Markup Price for `quantity` units: the per-unit price (already rounded to the centavo, so the price
 * tier, which only receives that, adds up to the same total) times the quantity. Null while Acquire,
 * the factor or the quantity is blank.
 */
export function markupPrice(acquireUnit, quantity, factor) {
  const unit = markupPriceUnit(acquireUnit, factor);
  return unit === null ? null : extended(unit, quantity);
}

/**
 * The factor a row is priced at: its own override, else the matrix default; a cost-only row with no
 * override of its own is x1.00 (pass `costOnly`). Null while neither is known, which includes a viewer
 * whose tier never received the factor. Returns a number.
 */
export function effectiveFactor(row, defaultFactor, { costOnly = false } = {}) {
  const own = scaled(row?.markup_factor);
  if (own !== null) return Number(own) / 1_000_000;
  if (costOnly) return 1;
  const fallback = scaled(defaultFactor);
  return fallback === null ? null : Number(fallback) / 1_000_000;
}

/**
 * A Component's (or cost-only row's) markup figures:
 *
 *   factor       the factor it is priced at (see effectiveFactor), or null
 *   priceUnit    Markup Price per unit. A tier that received the server's figure
 *                (`markup_price_unit`, the price tier's only way in) uses it; otherwise it is worked out
 *                from Acquire and the factor, which only the Closed Book has.
 *   priceTotal   priceUnit x quantity
 *
 * Every figure is null while an input is blank or was never received.
 */
export function componentMarkup(row, defaultFactor, { costOnly = false } = {}) {
  const factor = effectiveFactor(row, defaultFactor, { costOnly });
  const priceUnit =
    row && "markup_price_unit" in row
      ? blank(row.markup_price_unit)
        ? null
        : pesosFromCentavos(extendedCentavos(row.markup_price_unit, 1))
      : markupPriceUnit(row?.acquire_unit, factor);
  return { factor, priceUnit, priceTotal: priceUnit === null ? null : extended(priceUnit, row?.quantity) };
}

/** Factors and ratios come back to four decimals, half up (what numeric(10,4) holds). */
function ratio(numeratorCentavos, denominatorCentavos) {
  if (numeratorCentavos === null || denominatorCentavos === null || denominatorCentavos <= 0n) return null;
  return Number(roundDiv(numeratorCentavos * 10_000n, denominatorCentavos)) / 10_000;
}

/** The one factor shared by every row, else the blend (Markup Price over Acquire); null when unknown. */
function targetOf(markups, priceCentavos, acquireCentavos) {
  if (markups.length === 0 || markups.some((m) => m.factor === null)) return null;
  const distinct = new Set(markups.map((m) => m.factor));
  if (distinct.size === 1) return markups[0].factor;
  return ratio(priceCentavos, acquireCentavos);
}

/**
 * A Tender Line's markup (cost-only rows are never part of it):
 *
 *   priceTotal       the Components' Markup Prices added up; null when the line has no Component or any
 *                    Component's Markup Price is blank
 *   targetFactor     the factor the Markup Price suggests: the one factor every Component shares, else
 *                    the blend (Markup Price total / Acquire total); null when unknown
 *   achievedFactor   Final Offer total / the Components' Acquire total, to four decimals; null while
 *                    either is blank, so only a tier that received both (the Closed Book) has it
 *
 * `tenderLine` carries `quantity` and `final_offer_unit` when the tier received it; `components` are the
 * line's Components with their costs merged in and their `markup` (componentMarkup) attached.
 */
export function lineMarkup(tenderLine, components, defaultFactor) {
  const list = (components ?? []).map((c) => c.markup ?? componentMarkup(c, defaultFactor));
  const price = sumUnlessBlank(list.map((m) => extendedCentavos(m.priceTotal, 1)));
  const acquire = sumUnlessBlank((components ?? []).map((c) => extendedCentavos(effectiveAcquireUnit(c), c?.quantity)));
  const offer = extendedCentavos(tenderLine?.final_offer_unit, tenderLine?.quantity);
  return {
    priceTotal: pesosFromCentavos(price),
    targetFactor: targetOf(list, price, acquire),
    achievedFactor: ratio(offer, acquire),
  };
}

/**
 * The whole matrix's markup, counting the cost-only rows (they carry cost and a x1.00 markup but no Final
 * Offer, so they pull the overall figure down and leave every line's alone):
 *
 *   achievedFactor   the Final Offer total / every Component's and cost-only row's Acquire total. Null
 *                    while any Tender Line has no Final Offer or no Component, or any Acquire is blank.
 *   targetFactor     see lineMarkup, over every Component and cost-only row
 *   priceTotal       the Markup Prices of the Tender Lines added up (null while any is blank)
 *
 * `tenderLines` carry their `components` (with `markup`); `costRows` carry `markup` too.
 */
export function matrixMarkup(tenderLines, costRows, defaultFactor) {
  const lines = tenderLines ?? [];
  const rows = costRows ?? [];
  const components = lines.flatMap((l) => l.components ?? []);
  const markups = [
    ...components.map((c) => c.markup ?? componentMarkup(c, defaultFactor)),
    ...rows.map((r) => r.markup ?? componentMarkup(r, defaultFactor, { costOnly: true })),
  ];
  const everyLineCosted = lines.length > 0 && lines.every((l) => (l.components ?? []).length > 0);
  const acquire = everyLineCosted
    ? sumUnlessBlank([...components, ...rows].map((c) => extendedCentavos(effectiveAcquireUnit(c), c?.quantity)))
    : null;
  const price = sumUnlessBlank(markups.map((m) => extendedCentavos(m.priceTotal, 1)));
  const offer = sumUnlessBlank(lines.map((l) => extendedCentavos(l?.final_offer_unit, l?.quantity)));
  const linesPrice = sumUnlessBlank(lines.map((l) => extendedCentavos(l?.markup?.priceTotal, 1)));
  return {
    priceTotal: pesosFromCentavos(linesPrice),
    targetFactor: everyLineCosted ? targetOf(markups, price, acquire) : null,
    achievedFactor: ratio(offer, acquire),
  };
}

/** A factor as the percentage over cost it stands for: 1.35 is 35, 0.9 is -10. */
export function percentOver(factor) {
  const f = scaled(factor);
  return f === null ? null : Number(roundDiv((f - MICRO) * 100n, 10_000n)) / 100;
}

/** The Markup Prices of rows that carry a `markup` (componentMarkup) added up; null when there are none or one is blank. */
export function markupPriceSum(rows) {
  return pesosFromCentavos(sumUnlessBlank((rows ?? []).map((r) => extendedCentavos(r?.markup?.priceTotal, 1))));
}

/**
 * How a set of Components stands against what was asked (#271): `deviates` have a Deviates
 * verdict, `notEvaluated` have no verdict yet, and `total` is how many there are. A Component
 * that complies is neither. Per Tender Line when given the line's Components, for the whole
 * offer when given them all. Blank (null, undefined or any unknown word) is not evaluated.
 */
export function complianceRollup(components) {
  const list = components ?? [];
  let deviates = 0;
  let notEvaluated = 0;
  for (const component of list) {
    if (component?.compliance === "deviates") deviates += 1;
    else if (component?.compliance !== "complies") notEvaluated += 1;
  }
  return { deviates, notEvaluated, total: list.length };
}

/**
 * A roll-up in words: "2 of 5 deviate · 1 not evaluated". Nothing to say (null) for no
 * Components; "All 5 comply" when every one does.
 */
export function describeComplianceRollup(rollup) {
  const { deviates = 0, notEvaluated = 0, total = 0 } = rollup ?? {};
  if (total === 0) return null;
  const parts = [];
  if (deviates > 0) parts.push(`${deviates} of ${total} ${total === 1 ? "deviates" : "deviate"}`);
  if (notEvaluated > 0) parts.push(`${notEvaluated} not evaluated`);
  if (parts.length === 0) return total === 1 ? "Complies" : `All ${total} comply`;
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Costing settled (#272)
// ---------------------------------------------------------------------------

/** A count that is present and zero. Absent (null/undefined) is not zero: a missing count fails closed. */
const isZeroCount = (value) => value !== null && value !== undefined && Number(value) === 0;

/** The checks "Costing settled" can fail, in the order they are reported. */
export const COSTING_SETTLED_CHECKS = [
  "no_matrix",
  "not_settled",
  "no_tender_lines",
  "missing_final_offer",
  "incomplete_summary",
  "evaluation_not_approved",
  "over_abc",
  "bid_not_go",
];

/**
 * Whether the bid is ready to go: the matrix is finished (a Final Offer on every Tender Line, a
 * complete summary, an approved evaluation, the offer within ABC) AND the boss has said Go.
 *
 * `inputs` is what `costing_condition_inputs` returns, booleans and counts only (no peso figure
 * reaches the browser; the ABC comparison is done in SQL, to the centavo, so one centavo over
 * fails):
 *
 *   has_matrix, line_count, missing_offer, over_abc, costed_rows, missing_cost,
 *   evaluation_approved, bid_verdict ('go' | 'no_go' | 'revise' | null)
 * or, for a caller outside the price and Closed Book tiers, only `{ has_matrix, settled_met }`
 * (the database judged it; the single failing check is `not_settled`).
 *
 * Returns `{ met, failing }`, `failing` being the keys of COSTING_SETTLED_CHECKS that fail. No
 * matrix fails on that alone (nothing else can be judged). The summary counts as incomplete when
 * there is no Component or cost-only row to cost, or any has no Final Acquire; a missing Final
 * Offer or no Tender Line is its own check, not repeated there. Missing inputs fail closed.
 */
export function costingSettled(inputs) {
  if (!inputs || inputs.has_matrix !== true) return { met: false, failing: ["no_matrix"] };
  // A caller outside the price and Closed Book tiers is sent no settled evidence, only the
  // database's own verdict (`settled_met`): one failing check, no reasons (#266 review).
  if (inputs.line_count === undefined && inputs.settled_met !== undefined) {
    return inputs.settled_met === true ? { met: true, failing: [] } : { met: false, failing: ["not_settled"] };
  }
  const failing = [];
  const lines = Number(inputs.line_count) || 0;
  if (lines === 0) failing.push("no_tender_lines");
  else if (!isZeroCount(inputs.missing_offer)) failing.push("missing_final_offer");
  if (!(Number(inputs.costed_rows) > 0) || !isZeroCount(inputs.missing_cost)) failing.push("incomplete_summary");
  if (inputs.evaluation_approved !== true) failing.push("evaluation_not_approved");
  if (inputs.over_abc !== false) failing.push("over_abc");
  if (inputs.bid_verdict !== "go") failing.push("bid_not_go");
  return { met: failing.length === 0, failing };
}

// ---------------------------------------------------------------------------
// Words for a summary figure that cannot be worked yet (#270, used by the screen and the print)
// ---------------------------------------------------------------------------

const countOf = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** What stands in for an offer-based summary figure while a Tender Line has no Final Offer (or there is none). Null when nothing is missing. */
export function offerIncomplete(incomplete) {
  if (incomplete.missingOffer > 0) {
    return `Incomplete — ${countOf(incomplete.missingOffer, "tender line has", "tender lines have")} no Final Offer`;
  }
  return incomplete.noTenderLines ? "Incomplete — no Tender Lines yet" : null;
}

/** What stands in for a cost-based summary figure while a Component or cost-only row has no Final Acquire. Null when nothing is missing. */
export function costIncomplete(incomplete) {
  if (incomplete.missingCost > 0) return `Incomplete — ${countOf(incomplete.missingCost, "row has", "rows have")} no cost`;
  return incomplete.noCostRows ? "Incomplete — no Components or cost-only rows yet" : null;
}

/** A markup factor as the sheet writes it: ×1.35, with up to four decimals when it needs them (×2.0644). */
export const factorLabel = (factor) => {
  if (factor === null || factor === undefined || !Number.isFinite(Number(factor))) return "—";
  const text = Number(factor).toFixed(4).replace(/0{1,2}$/, "");
  return `×${text}`;
};

// ---------------------------------------------------------------------------
// Costing priced (#463)
// ---------------------------------------------------------------------------

/** The checks "Costing priced" can fail, in the order they are reported. */
export const COSTING_PRICED_CHECKS = ["no_matrix", "no_components", "missing_acquire", "no_purchasing_incharge"];

/**
 * Whether Purchasing has costed the matrix: at least one Component, every Component and cost-only
 * row has an Acquire unit cost (Inclusions are unpriced and don't count), and a Purchasing
 * Incharge is named on the matrix. Reads the same evidence as costingSettled
 * (`costing_condition_inputs`), keys `component_count`, `missing_acquire` and
 * `has_purchasing_incharge`. No matrix fails on that alone. Missing inputs fail closed.
 * Returns `{ met, failing }`.
 */
export function costingPriced(inputs) {
  if (!inputs || inputs.has_matrix !== true) return { met: false, failing: ["no_matrix"] };
  const failing = [];
  if (!(Number(inputs.component_count) > 0)) failing.push("no_components");
  if (!isZeroCount(inputs.missing_acquire)) failing.push("missing_acquire");
  if (inputs.has_purchasing_incharge !== true) failing.push("no_purchasing_incharge");
  return { met: failing.length === 0, failing };
}

// ---------------------------------------------------------------------------
// Where a row's cost came from (#701)
// ---------------------------------------------------------------------------

const hasValue = (value) => value !== null && value !== undefined && value !== "";

/**
 * A Component's cost and where it came from, or null while it has none. A typed cost wins over
 * every other source (a fill never replaces it); then the Canvass winner, the attached P0's price,
 * Odoo's `standard_price`.
 *
 * Returns `{ source, pesos, price, currency }`: `source` is "typed" | "canvass" | "p0" | "odoo",
 * `pesos` the unit cost in pesos, `price` the figure as quoted (the same as `pesos`, except for a
 * foreign P0). A viewer whose tier was not sent the cost columns gets null.
 */
export function resolveCost(component) {
  const c = component ?? {};
  const acquire = c.acquire_unit;
  const own = (source) => ({ source, pesos: acquire, price: acquire, currency: "PHP" });
  if (hasValue(acquire) && c.acquire_source === COST_SOURCE.TYPED) return own(COST_SOURCE.TYPED);
  if (hasValue(acquire) && c.acquire_from_offer_id) return own(COST_SOURCE.CANVASS);
  if (hasValue(c.p0_unit_price)) {
    return {
      source: COST_SOURCE.P0,
      pesos: c.p0_unit_price,
      price: hasValue(c.p0_quoted_unit_price) ? c.p0_quoted_unit_price : c.p0_unit_price,
      currency: c.p0_currency || "PHP",
    };
  }
  if (hasValue(acquire)) return own(c.acquire_source === COST_SOURCE.ODOO ? COST_SOURCE.ODOO : COST_SOURCE.TYPED);
  if (hasValue(c.odoo_unit)) return { source: COST_SOURCE.ODOO, pesos: c.odoo_unit, price: c.odoo_unit, currency: "PHP" };
  return null;
}

/**
 * The cost of one S0 line, per unit of the line. One Component: its own resolved cost. Several: their
 * costs added up over the line's quantity, `source` the one they share or "mixed". Null while any
 * part has no cost, or the line has no Component.
 */
export function lineCost(line) {
  const parts = line?.components ?? [];
  if (parts.length === 0) return null;
  const costs = parts.map(resolveCost);
  if (costs.some((cost) => cost === null)) return null;
  if (parts.length === 1) return costs[0];
  const quantity = Number(line.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const total = parts.reduce((sum, part, i) => sum + (extendedCentavos(costs[i].pesos, part.quantity) ?? 0n), 0n);
  const pesos = Math.round(Number(total) / quantity) / 100;
  const sources = new Set(costs.map((cost) => cost.source));
  return { source: sources.size === 1 ? [...sources][0] : COST_SOURCE.MIXED, pesos, price: pesos, currency: "PHP" };
}

/**
 * The estimated landed cost of a unit: its peso cost plus the add-on percent (18 means +18%),
 * rounded to the centavo. Null while the cost is blank or the percent is not a number.
 */
export function estimateLanded(pesosCost, percent) {
  const factor = 1 + Number(percent ?? 0) / 100;
  if (!Number.isFinite(factor)) return null;
  const cents = extendedCentavos(pesosCost, factor);
  return cents === null ? null : pesosFromCentavos(cents);
}

/**
 * The Landed / unit figure for one S0 line (#702). Once the line's Components all have an IPAS Landed
 * Cost, that real figure wins, `{ kind: "real", unit, mark }` (mark "provisional" | "final"). Until then
 * it is an estimate on the peso cost: a foreign-currency row takes the Import add-on, a peso row the Local
 * one, `{ kind: "estimate", unit, percent, local }`. Null while the line has no cost, or the viewer's tier
 * was not sent Landed Cost. Nothing here feeds markup or the price side.
 *
 * `addons` is `{ import, local }`, both in percent.
 */
export function lineLanded(line, addons) {
  const real = landedCostRollup(line?.components);
  const quantity = Number(line?.quantity);
  if (real && Number.isFinite(quantity) && quantity > 0) {
    const parts = line.components;
    const own = parts.length === 1 ? parts[0].landed_cost?.unit : null;
    const unit = hasValue(own) ? Number(own) : Math.round((real.total / quantity) * 100) / 100;
    return { kind: "real", unit, mark: real.mark };
  }
  const cost = lineCost(line);
  if (!cost) return null;
  const local = cost.currency === "PHP";
  const percent = Number((local ? addons?.local : addons?.import) ?? 0);
  const unit = estimateLanded(cost.pesos, percent);
  return unit === null ? null : { kind: "estimate", unit, percent, local };
}

/**
 * Costing Matrix, the Evaluation of Specification is approved (#707): the one check the
 * Evaluation of Specification Stage Action holds its Stage to. Reads the same evidence as
 * costingSettled (`costing_condition_inputs`), key `evaluation_approved`.
 */
export function costingEvaluationApproved(inputs) {
  if (!inputs || inputs.has_matrix !== true) return { met: false, failing: ["no_matrix"] };
  return inputs.evaluation_approved === true
    ? { met: true, failing: [] }
    : { met: false, failing: ["evaluation_not_approved"] };
}

// ---------------------------------------------------------------------------
// The sheet's markup columns (#703)
// ---------------------------------------------------------------------------

/**
 * The multiplier an S0 line is priced at. A line's own is the one its parts all carry; else the matrix
 * default. `own` says which. `factor` is a number, or null while neither is known (a viewer whose tier
 * is not sent the multiplier).
 */
export function lineMultiplier(line, defaultFactor) {
  const parts = line?.components ?? [];
  const owns = parts.map((part) => scaled(part?.markup_factor));
  if (parts.length > 0 && owns.every((own) => own !== null && own === owns[0])) {
    return { factor: Number(owns[0]) / 1_000_000, own: true };
  }
  const fallback = scaled(defaultFactor);
  return { factor: fallback === null ? null : Number(fallback) / 1_000_000, own: false };
}

const toCentavos = (value) => (blank(value) || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100));

/**
 * One S0 line's markup figures, per unit of the line (spec #699, ticket #703):
 *
 *   suggested   the bare peso price x the multiplier (not x the landed cost), to the centavo. A tower's
 *               price carries what comes with it: the bare peso price of every included item, spread over
 *               the line's quantity, goes in before the multiplier ("with N included")
 *   cost        what the line really costs per unit: its own landed cost plus the landed cost of every item
 *               included in it (a tower's parts), spread over the line's quantity
 *   margin      suggested - cost, and `percent` of the suggested price
 *   included    how many items come with the line
 *
 * `landedOf(line)` gives a line's landed cost per unit in pesos (null when unknown); `kids` are the lines
 * included in this one. Every figure is null while an input is unknown.
 */
export function lineSheetMarkup(line, kids, defaultFactor, landedOf) {
  const { factor, own } = lineMultiplier(line, defaultFactor);
  const cost = lineCost(line);
  const quantity = Number(line?.quantity);
  let groupPesos = cost ? toCentavos(cost.pesos) : null;
  for (const kid of kids ?? []) {
    const kidCost = lineCost(kid);
    const kidCentavos = kidCost ? toCentavos(kidCost.pesos) : null;
    if (groupPesos === null || kidCentavos === null || !(quantity > 0)) {
      groupPesos = null;
      break;
    }
    groupPesos += Math.round((kidCentavos * Number(kid.quantity)) / quantity);
  }
  const suggestedCentavos = groupPesos !== null && factor !== null ? toCentavos(markupPriceUnit(groupPesos / 100, factor)) : null;
  let costCentavos = toCentavos(landedOf(line));
  for (const kid of kids ?? []) {
    const kidLanded = toCentavos(landedOf(kid));
    if (costCentavos === null || kidLanded === null || !(quantity > 0)) {
      costCentavos = null;
      break;
    }
    costCentavos += Math.round((kidLanded * Number(kid.quantity)) / quantity);
  }
  const marginCentavos = suggestedCentavos === null || costCentavos === null ? null : suggestedCentavos - costCentavos;
  return {
    factor,
    own,
    suggested: suggestedCentavos === null ? null : suggestedCentavos / 100,
    cost: costCentavos === null ? null : costCentavos / 100,
    margin: marginCentavos === null ? null : marginCentavos / 100,
    percent: marginCentavos === null || !suggestedCentavos ? null : Math.round((marginCentavos / suggestedCentavos) * 1000) / 10,
    included: (kids ?? []).length,
  };
}
