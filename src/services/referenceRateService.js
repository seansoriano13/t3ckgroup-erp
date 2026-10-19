import { supabase } from "../lib/supabase";

/**
 * Reference Rates (#317): the PHP value of one unit of a foreign currency on a given day,
 * fetched once a day by the currency-rates-fetch edge function. Read-only here except for a
 * Super Admin's override, which the database records with who, when, and what it replaced.
 */
export const referenceRateService = {
  /**
   * The latest Reference Rate on or before `onDate` (YYYY-MM-DD), carrying its own date, or
   * null when there is none. A failed fetch therefore shows yesterday's rate under yesterday's
   * date, never today's.
   */
  async forDay(currency, onDate) {
    const code = String(currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || code === "PHP" || !onDate) return null;
    const { data, error } = await supabase.rpc("reference_rate", { p_currency: code, p_on: onDate });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ?? null;
  },

  /** The most recent rows across every currency, newest first. */
  async recent() {
    const { data, error } = await supabase
      .from("currency_rates")
      .select("currency, rate_date, php_per_unit, source, fetched_at, overridden_at, replaced_php_per_unit, overrider:employees!currency_rates_overridden_by_fkey(name)")
      .order("rate_date", { ascending: false })
      .order("currency")
      .limit(60);
    if (error) throw error;
    return data ?? [];
  },

  /** A Super Admin's correction of one day's rate. */
  async override(currency, rateDate, phpPerUnit) {
    const { error } = await supabase.rpc("override_currency_rate", {
      p_currency: String(currency).trim().toUpperCase(),
      p_rate_date: rateDate,
      p_php_per_unit: Number(phpPerUnit),
    });
    if (error) throw error;
  },
};
