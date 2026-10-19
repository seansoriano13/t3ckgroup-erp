// Pure and runtime-agnostic: imported by currency-rates-fetch (Deno) and by the
// frontend test runner. No Deno/Node/browser imports here.
//
// The one source of Reference Rates (#317): Frankfurter, which republishes the
// European Central Bank's daily reference rates. Odoo is not the source. The
// date written is the date the ECB published the rate for, never today's: a
// weekend or a holiday shows Friday's rate under Friday's date.

export const FEED_SOURCE = "ECB via frankfurter.dev";

export interface FeedRate {
  currency: string;
  rateDate: string;
  phpPerUnit: number;
}

export function feedUrl(currency: string): string {
  return `https://api.frankfurter.dev/v1/latest?base=${currency.toUpperCase()}&symbols=PHP`;
}

/** The PHP value of one unit of `currency` from a feed answer, or a throw. Never zero, never a guessed date. */
export function readFeedRate(body: unknown, currency: string): FeedRate {
  const wanted = currency.toUpperCase();
  const answer = (body ?? {}) as { base?: unknown; date?: unknown; rates?: Record<string, unknown> };
  if (answer.base !== wanted) throw new Error(`The feed answered for ${String(answer.base)}, not ${wanted}.`);
  if (typeof answer.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(answer.date)) {
    throw new Error(`The feed gave no usable date for ${wanted}.`);
  }
  const php = answer.rates?.PHP;
  if (typeof php !== "number" || !Number.isFinite(php) || php <= 0) {
    throw new Error(`The feed gave no usable PHP rate for ${wanted}.`);
  }
  return { currency: wanted, rateDate: answer.date, phpPerUnit: php };
}
