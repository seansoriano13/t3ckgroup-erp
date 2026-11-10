// Reference Rate daily fetch (#317). Scheduled by pg_cron (migration
// 20261019220000_currency_reference_rates.sql) through invoke_cron_edge_function,
// authenticated by Bearer CRON_SECRET or the service-role key (_shared/cronAuth.ts).
//
// For each currency in currency_rate_currencies: read one rate from the feed and
// write it with record_currency_rate, which never overwrites a Super Admin's
// override. A currency whose fetch fails writes nothing, so the last good row stays
// in place under its own date; the others still go through.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { isAuthorizedCaller } from "../_shared/cronAuth.ts";
import { FEED_SOURCE, feedUrl, readFeedRate } from "../_shared/referenceRateFeed.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const authorized = isAuthorizedCaller(req.headers.get("Authorization"), {
    cronSecret: Deno.env.get("CRON_SECRET"),
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!authorized) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: currencies, error } = await admin.from("currency_rate_currencies").select("currency");
  if (error) return jsonResponse({ error: error.message }, 500);

  const written: unknown[] = [];
  const failed: unknown[] = [];
  for (const { currency } of currencies ?? []) {
    try {
      const response = await fetch(feedUrl(currency), { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`The feed answered ${response.status} for ${currency}.`);
      const rate = readFeedRate(await response.json(), currency);
      const { error: writeError } = await admin.rpc("record_currency_rate", {
        p_currency: rate.currency,
        p_rate_date: rate.rateDate,
        p_php_per_unit: rate.phpPerUnit,
        p_source: FEED_SOURCE,
      });
      if (writeError) throw new Error(writeError.message);
      written.push(rate);
    } catch (err) {
      console.error(`currency-rates-fetch: ${currency}:`, err);
      failed.push({ currency, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return jsonResponse({ written, failed }, failed.length && !written.length ? 502 : 200);
});
