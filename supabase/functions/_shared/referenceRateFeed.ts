// Pure and runtime-agnostic: imported by currency-rates-fetch (Deno) and by the
// frontend test runner. No Deno/Node/browser imports here.
//
// The one source of Reference Rates (#317), through Frankfurter: US dollars come from
// the BSP provider (#1212), every other currency from the ECB. Odoo is not the source.
// The date written is the date the provider published the rate for, never today's: a
// weekend or a holiday shows Friday's rate under Friday's date. Each stored rate keeps
// its source.

export const ECB_SOURCE = "ECB via frankfurter.dev";
export const BSP_SOURCE = "BSP via frankfurter.dev";
/** Kept for callers that only know the ECB feed. */
export const FEED_SOURCE = ECB_SOURCE;

export interface FeedRate {
  currency: string;
  rateDate: string;
  phpPerUnit: number;
}

/** BSP covers only PHP and USD, so it is the source for USD alone. */
export function isBspCurrency(currency: string): boolean {
  return currency.toUpperCase() === "USD";
}

export function feedSource(currency: string): string {
  return isBspCurrency(currency) ? BSP_SOURCE : ECB_SOURCE;
}

export function feedUrl(currency: string): string {
  const wanted = currency.toUpperCase();
  if (isBspCurrency(wanted)) return `https://api.frankfurter.dev/v2/rate/${wanted}/PHP?providers=BSP`;
  return `https://api.frankfurter.dev/v1/latest?base=${wanted}&symbols=PHP`;
}

/** The PHP value of one unit of `currency` from a feed answer, or a throw. Never zero, never a guessed date. */
export function readFeedRate(body: unknown, currency: string): FeedRate {
  const wanted = currency.toUpperCase();
  const answer = (body ?? {}) as {
    base?: unknown;
    date?: unknown;
    rates?: Record<string, unknown>;
    quote?: unknown;
    rate?: unknown;
  };
  if (answer.base !== wanted) throw new Error(`The feed answered for ${String(answer.base)}, not ${wanted}.`);
  if (typeof answer.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(answer.date)) {
    throw new Error(`The feed gave no usable date for ${wanted}.`);
  }
  // The v2 single-rate answer (BSP) is { date, base, quote, rate }; the v1 answer (ECB) is { base, date, rates }.
  const php = answer.quote === "PHP" ? answer.rate : answer.rates?.PHP;
  if (typeof php !== "number" || !Number.isFinite(php) || php <= 0) {
    throw new Error(`The feed gave no usable PHP rate for ${wanted}.`);
  }
  return { currency: wanted, rateDate: answer.date, phpPerUnit: php };
}
