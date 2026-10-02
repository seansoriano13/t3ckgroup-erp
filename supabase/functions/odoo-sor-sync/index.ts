import {
  authenticate,
  executeKw,
  isConfigured,
  jsonResponse
} from "../_shared/odoo.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// `state` is stored as-is; the Retail report counts only `sale` and `done`.
const ORDER_FIELDS = [
  "name",
  "create_date",
  "date_order",
  "partner_id",
  "user_id",
  "amount_total",
  "state",
];

// Rows per Odoo read / Supabase upsert. Odoo.com throttles bursts, so a big
// historical load goes through in slices rather than one giant call.
const BATCH_SIZE = 200;

const ROLLING_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip Odoo's message HTML down to plain text, preserving line breaks.
 *
 * Bug (issue #172): stripping tags to a space instead of a newline let the
 * `NAME:` capture — which stops at `[^\n]+` — swallow everything after it on
 * the same "line" of rendered HTML, because there was no `\n` left to stop
 * at. Block-level closes and <br> become a newline first, so a real line
 * break in the rendered note survives into the plain-text version.
 */
function toPlainText(rawText: string): string {
  return rawText
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]*>?/gm, " ")
    .replace(/&nbsp;/g, " ");
}

/**
 * The configured storefront (e.g. "Shopee") an Odoo customer belongs to, or
 * null when it is not a marketplace customer.
 *
 * Issue #172: retail is whoever the Odoo customer is, not what lead source a
 * record was tagged with or what words appear in a note. Production has a
 * ₱144,000 government proposal tagged Shopee, and retail-shaped records
 * appear under three other lead sources — so this checks the one field that
 * actually says who bought it.
 */
function storefrontFor(partnerName: string | null | undefined, storefronts: string[]): string | null {
  if (!partnerName) return null;
  const name = partnerName.toLowerCase();
  return storefronts.find((s) => name.includes(s.toLowerCase())) ?? null;
}

/**
 * Odoo domain: customer matches any storefront, AND the extra leaf.
 * Prefix notation — n storefronts need n-1 leading "|".
 */
function storefrontDomain(storefronts: string[], extraLeaf: unknown[]): unknown[] {
  const ors = storefronts.slice(1).map(() => "|");
  const leaves = storefronts.map((s) => ["partner_id", "ilike", s]);
  return [...ors, ...leaves, extraLeaf];
}

/** Odoo wants "YYYY-MM-DD HH:MM:SS" in UTC. */
function odooDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Odoo timestamps are UTC without a zone marker; Postgres needs one. */
function toTimestamptz(odooValue: string | false | null | undefined): string | null {
  return odooValue ? `${odooValue.replace(" ", "T")}Z` : null;
}

/**
 * Best-effort buyer name from a sale order's chatter ("NAME: ..."). It only
 * enriches the report — an order with no note is still recorded.
 */
async function fetchBuyerNames(uid: number, orderIds: number[]): Promise<Map<number, string>> {
  const buyers = new Map<number, string>();
  const remember = (resId: number, content: unknown) => {
    if (buyers.has(resId) || typeof content !== "string") return;
    const match = toPlainText(content).match(/NAME:?\s*([^\n]+)/i);
    if (match) buyers.set(resId, match[1].trim());
  };

  for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
    const ids = orderIds.slice(i, i + BATCH_SIZE);
    const [activities, messages] = await Promise.all([
      executeKw(uid, "mail.activity", "search_read", [
        [["res_model", "=", "sale.order"], ["res_id", "in", ids]],
        ["res_id", "note"],
      ]),
      executeKw(uid, "mail.message", "search_read", [
        [
          ["model", "=", "sale.order"],
          ["res_id", "in", ids],
          ["message_type", "in", ["comment", "notification"]],
        ],
        ["res_id", "body"],
      ]),
    ]);
    for (const a of activities) remember(a.res_id, a.note);
    for (const m of messages) remember(m.res_id, m.body);
  }
  return buyers;
}

/**
 * Which orders to read. Default is a rolling window of orders changed in the
 * last 30 days, which is how an order that was cancelled or re-priced later gets
 * refreshed. `?since=YYYY-MM-DD` loads every order dated on or after that day
 * (one-time historical load); `?since=earliest` starts from the oldest order
 * already in `retail_orders`.
 */
async function resolveWindow(since: string | null): Promise<{ leaf: unknown[]; label: string }> {
  if (!since) {
    const from = new Date();
    from.setDate(from.getDate() - ROLLING_WINDOW_DAYS);
    return { leaf: ["write_date", ">=", odooDate(from)], label: `changed in the last ${ROLLING_WINDOW_DAYS} days` };
  }

  let day = since;
  if (since === "earliest") {
    const { data } = await supabase
      .from("retail_orders")
      .select("ordered_at")
      .not("ordered_at", "is", null)
      .order("ordered_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data?.ordered_at) {
      throw new Error("since=earliest needs at least one order already in retail_orders.");
    }
    day = data.ordered_at.slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("since must be YYYY-MM-DD or 'earliest'.");
  }
  return { leaf: ["date_order", ">=", `${day} 00:00:00`], label: `dated on or after ${day}` };
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

async function runSync(since: string | null = null) {
  const uid = await authenticate();

  // Issue #172: configurable storefront list, not a hardcoded lead source or
  // note-text pattern.
  const { data: appSettings } = await supabase
    .from("app_settings")
    .select("retail_storefronts")
    .maybeSingle();
  const storefronts: string[] = appSettings?.retail_storefronts?.length
    ? appSettings.retail_storefronts
    : ["Shopee", "Lazada"];

  const { leaf, label } = await resolveWindow(since);
  const domain = storefrontDomain(storefronts, leaf);

  // Read the orders straight from Odoo by customer. This used to discover
  // orders through chatter activity on them, which silently missed any order
  // nobody left a note on — fine for a review queue, wrong for a report.
  const orders: any[] = [];
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const page = await executeKw(uid, "sale.order", "search_read", [domain, ORDER_FIELDS], {
      limit: BATCH_SIZE,
      offset,
      order: "id asc",
    });
    orders.push(...page);
    if (page.length < BATCH_SIZE) break;
  }

  if (orders.length === 0) {
    return { window: label, ordersRead: 0, upserted: 0 };
  }

  const buyers = await fetchBuyerNames(uid, orders.map((o) => o.id));

  // Keep what we already know: a buyer name found once is not erased by a
  // later read whose chatter has since changed.
  const soNumbers = orders.map((o) => o.name);
  const knownBuyers = new Map<string, string>();
  for (let i = 0; i < soNumbers.length; i += BATCH_SIZE) {
    const { data, error } = await supabase
      .from("retail_orders")
      .select("odoo_so_number, buyer_name")
      .in("odoo_so_number", soNumbers.slice(i, i + BATCH_SIZE));
    if (error) throw error;
    for (const row of data || []) {
      if (row.buyer_name) knownBuyers.set(row.odoo_so_number, row.buyer_name);
    }
  }

  // `is_excluded`, `excluded_reason` and `source` are deliberately absent: a new
  // row takes their defaults, and an existing row keeps what it has — the sync
  // never un-excludes an order somebody dismissed.
  const rows = orders.map((so) => {
    const partnerName: string = so.partner_id ? so.partner_id[1] : "";
    return {
      odoo_so_number: so.name,
      odoo_so_id: so.id,
      marketplace: storefrontFor(partnerName, storefronts) ?? partnerName,
      partner_name: partnerName,
      buyer_name: buyers.get(so.id) ?? knownBuyers.get(so.name) ?? null,
      odoo_salesperson_name: so.user_id ? so.user_id[1] : null,
      amount: typeof so.amount_total === "number" ? so.amount_total : 0,
      // The order date, not the record's creation date: the two can land on
      // either side of a month boundary.
      ordered_at: toTimestamptz(so.date_order) ?? toTimestamptz(so.create_date),
      odoo_state: so.state ?? null,
    };
  });

  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { error } = await supabase
      .from("retail_orders")
      .upsert(rows.slice(i, i + BATCH_SIZE), { onConflict: "odoo_so_number" });
    if (error) throw error;
    upserted += Math.min(BATCH_SIZE, rows.length - i);
  }

  // The other half of this function used to close a matching SOR as Won when a
  // "MODE OF PAYMENT" + "AMOUNT" note appeared, falling back to an
  // ilike('%partner_name%') match against any open lead. Running hourly against
  // production, that is a deal silently marked Won because two customers share
  // a word in their name. Removed outright rather than disabled — a hazard one
  // manual invocation away is worse than no feature. The goal is worth keeping,
  // so it is written up as issue #324, to come back with an exact
  // sales_reference match and no fuzzy fallback.
  // This function syncs retail, and nothing else.

  return { window: label, ordersRead: orders.length, upserted };
}

// ---------------------------------------------------------------------------
// Cron (native Supabase edge function scheduling, degrades safely locally)
// ---------------------------------------------------------------------------

if (typeof Deno.cron === "function") {
  Deno.cron("odoo-sor-sync-job", "0 * * * *", async () => {
    console.log("[odoo-sor-sync] Starting cron run...");
    try {
      const stats = await runSync();
      console.log("[odoo-sor-sync] Cron complete:", stats);
    } catch (err) {
      console.error("[odoo-sor-sync] Cron failed:", err);
    }
  });
}

// ---------------------------------------------------------------------------
// HTTP handler (manual trigger / local testing / one-time historical load)
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (!isConfigured()) {
    return jsonResponse({ success: false, message: "Odoo unconfigured" });
  }

  const authHeader = req.headers.get("Authorization");
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const since = new URL(req.url).searchParams.get("since");
    const stats = await runSync(since);
    return jsonResponse({ success: true, message: "Sync complete", stats });
  } catch (err: any) {
    console.error("[odoo-sor-sync] Error:", err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
});
