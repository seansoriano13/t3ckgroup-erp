import {
  authenticate,
  executeKw,
  isConfigured,
  jsonResponse
} from "../_shared/odoo.ts";
import {
  changedColumns,
  foldNoteFacts,
  keepKnownValues,
  selectRereadOrders,
  type ReadNoteFacts,
} from "../_shared/noteReread.ts";
import { isAuthorizedCaller } from "../_shared/cronAuth.ts";
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

// Orders whose notes are read from Odoo per round trip, and written per batch.
// An Income Note often carries a pasted screenshot: on staging 10 orders' To-Dos
// came to 42 MB, and a run that read them 25 at a time was killed by the runtime
// (WORKER_RESOURCE_LIMIT, reason "Memory"). Small slices keep the peak low, and
// each is written before the next is read so a failure part-way keeps what was
// already read.
const NOTE_BATCH_SIZE = 10;

// `?mode=full` (the nightly run) also re-reads every order whose notes Odoo says
// were touched this recently: two nights, so one missed run is still caught.
const FULL_RUN_NOTES_LOOKBACK_HOURS = 48;

// Order ids per "which notes changed" query.
const TOUCHED_ID_BATCH_SIZE = 500;

/** `pending`: window plus Missing/Suspect orders (every 5 minutes). `full`: that plus recently touched notes (nightly). */
type SyncMode = "pending" | "full";

const ROLLING_WINDOW_DAYS = 30;

// PostgREST caps a response at 1000 rows, so stored orders are read in pages.
const STORED_PAGE_SIZE = 1000;

// Every column this function writes, so a stored order can be compared with
// what a read would write, and rebuilt whole when only its notes changed.
const SYNCED_COLUMNS = [
  "odoo_so_number",
  "odoo_so_id",
  "marketplace",
  "partner_name",
  "buyer_name",
  "marketplace_order_id",
  "marketplace_fee",
  "order_income",
  "odoo_salesperson_name",
  "amount",
  "ordered_at",
  "odoo_state",
].join(", ");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
function storefrontDomain(storefronts: string[], extraLeaves: unknown[][]): unknown[] {
  const ors = storefronts.slice(1).map(() => "|");
  const leaves = storefronts.map((s) => ["partner_id", "ilike", s]);
  return [...ors, ...leaves, ...extraLeaves];
}

/** Odoo wants "YYYY-MM-DD HH:MM:SS" in UTC. */
function odooDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Odoo timestamps are UTC without a zone marker; Postgres needs one. */
function toTimestamptz(odooValue: string | false | null | undefined): string | null {
  return odooValue ? `${odooValue.replace(" ", "T")}Z` : null;
}

type NoteFacts = ReadNoteFacts;

/**
 * Best-effort facts from each sale order's notes: buyer name ("NAME: ...") and
 * the Income Note's Marketplace Order ID / Fee / Order Income. Open To-Do
 * activities are read before chatter messages. The buyer is the first NAME
 * found; Marketplace Order ID and fee are kept whenever a note has them, income
 * or not (#456), and the first note that yields an Order Income is authoritative
 * for the fee. It only enriches the report — an order with no note is still recorded.
 */
async function fetchNoteFacts(
  uid: number,
  orders: { id: number; amount_total?: number }[],
): Promise<Map<number, NoteFacts>> {
  const facts = new Map<number, NoteFacts>();
  const amounts = new Map(orders.map((o) => [o.id, typeof o.amount_total === "number" ? o.amount_total : 0]));
  const remember = (resId: number, content: unknown) => {
    const next = foldNoteFacts(facts.get(resId), content, amounts.get(resId) ?? 0);
    if (next) facts.set(resId, next);
  };

  const ids = orders.map((o) => o.id);
  for (let i = 0; i < ids.length; i += NOTE_BATCH_SIZE) {
    const slice = ids.slice(i, i + NOTE_BATCH_SIZE);
    const [activities, messages] = await Promise.all([
      executeKw(uid, "mail.activity", "search_read", [
        [["res_model", "=", "sale.order"], ["res_id", "in", slice]],
        ["res_id", "note"],
      ]),
      executeKw(uid, "mail.message", "search_read", [
        [
          ["model", "=", "sale.order"],
          ["res_id", "in", slice],
          ["message_type", "in", ["comment", "notification"]],
        ],
        ["res_id", "body"],
      ]),
    ]);
    for (const a of activities) remember(a.res_id, a.note);
    for (const m of messages) remember(m.res_id, m.body);
  }
  return facts;
}

/**
 * Which orders to read. Default is a rolling window of orders changed in the
 * last 30 days, which is how an order that was cancelled or re-priced later gets
 * refreshed. `?since=YYYY-MM-DD` loads every order dated on or after that day
 * (one-time historical load); `?since=earliest` starts from the oldest order
 * already in `retail_orders`.
 */
async function resolveWindow(since: string | null, until: string | null = null): Promise<{ leaves: unknown[][]; label: string }> {
  if (!since) {
    const from = new Date();
    from.setDate(from.getDate() - ROLLING_WINDOW_DAYS);
    return { leaves: [["write_date", ">=", odooDate(from)]], label: `changed in the last ${ROLLING_WINDOW_DAYS} days` };
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
  const leaves: unknown[][] = [["date_order", ">=", `${day} 00:00:00`]];
  let label = `dated on or after ${day}`;
  // `until` (exclusive) splits a long historical load into chunks small
  // enough for the function's compute limit.
  if (until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("until must be YYYY-MM-DD.");
    leaves.push(["date_order", "<", `${until} 00:00:00`]);
    label += ` and before ${until}`;
  }
  return { leaves, label };
}

/**
 * The Odoo ids of orders with a To-Do or chatter message written since `since`.
 * Only ids come back (no note bodies), so this is cheap however large the notes
 * are: Odoo stamps every edit, so an edited or newly added note shows up here
 * even though the order's own change date never moves.
 */
async function fetchOrdersWithTouchedNotes(uid: number, odooIds: number[], since: Date): Promise<Set<number>> {
  const touched = new Set<number>();
  const from = odooDate(since);
  for (let i = 0; i < odooIds.length; i += TOUCHED_ID_BATCH_SIZE) {
    const slice = odooIds.slice(i, i + TOUCHED_ID_BATCH_SIZE);
    const [activities, messages] = await Promise.all([
      executeKw(uid, "mail.activity", "search_read", [
        [["res_model", "=", "sale.order"], ["res_id", "in", slice], ["write_date", ">=", from]],
        ["res_id"],
      ]),
      executeKw(uid, "mail.message", "search_read", [
        [
          ["model", "=", "sale.order"],
          ["res_id", "in", slice],
          ["message_type", "in", ["comment", "notification"]],
          ["write_date", ">=", from],
        ],
        ["res_id"],
      ]),
    ]);
    for (const row of [...activities, ...messages]) touched.add(row.res_id);
  }
  return touched;
}

/** Every order already in `retail_orders`, with the columns this function writes. */
async function loadStoredOrders(): Promise<any[]> {
  const stored: any[] = [];
  for (let from = 0; ; from += STORED_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("retail_orders")
      .select(SYNCED_COLUMNS)
      .order("odoo_so_number", { ascending: true })
      .range(from, from + STORED_PAGE_SIZE - 1);
    if (error) throw error;
    stored.push(...data);
    if (data.length < STORED_PAGE_SIZE) break;
  }
  return stored;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

/**
 * One sync run.
 *
 * 1. Orders in the window (rolling 30 days changed, or `?since=`) are read from
 *    Odoo with their notes.
 * 2. Stored orders outside that window get their notes re-read too: Adding an
 *    Income Note (an Odoo To-Do) does not change the order's change date, so the
 *    window alone never sees a late note. Every run re-reads the orders still
 *    lacking a trustworthy income (Missing or Suspect). `full` mode, the nightly
 *    run, also re-reads every order whose notes Odoo reports touched in the last
 *    two days, so an edit to an old note is caught. It does not download every
 *    order's notes: the screenshots in them make that more than a run can hold.
 *
 * Only rows that actually differ are written. Both reads follow the keep-known
 * rule: a newly read value overwrites the stored one, a read that finds nothing
 * keeps it.
 */
async function runSync(
  since: string | null = null,
  until: string | null = null,
  mode: SyncMode = "pending",
) {
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

  const { leaves, label } = await resolveWindow(since, until);
  const domain = storefrontDomain(storefronts, leaves);

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

  const stored = await loadStoredOrders();
  const known = new Map<string, any>(stored.map((row) => [row.odoo_so_number, row]));
  const touched =
    mode === "full"
      ? await fetchOrdersWithTouchedNotes(
          uid,
          stored.map((row) => row.odoo_so_id).filter((id) => id != null),
          new Date(Date.now() - FULL_RUN_NOTES_LOOKBACK_HOURS * 3600 * 1000),
        )
      : new Set<number>();
  const rereads = selectRereadOrders(stored, touched, new Set(orders.map((o) => o.id)));

  if (orders.length === 0 && rereads.length === 0) {
    return { mode, window: label, ordersRead: 0, notesRereadOutsideWindow: 0, notesTouchedRecently: touched.size, upserted: 0 };
  }

  // One entry per order whose notes get read: what to look up, and what to write
  // once they have been (null when the stored row already says the same, so it
  // is left alone).
  //
  // `is_excluded`, `excluded_reason` and `source` are deliberately absent from
  // every write: a new row takes their defaults, and an existing row keeps what
  // it has — the sync never un-excludes an order somebody dismissed.
  type Write =
    | { upsert: Record<string, unknown> }
    | { update: Record<string, unknown>; odoo_so_number: string };
  const reads: { odooId: number; amount: number; planWrite: (fact: NoteFacts | undefined) => Write | null }[] = [
    ...orders.map((so) => {
      const amount = typeof so.amount_total === "number" ? so.amount_total : 0;
      return {
        odooId: so.id as number,
        amount,
        planWrite: (fact: NoteFacts | undefined): Write | null => {
          const partnerName: string = so.partner_id ? so.partner_id[1] : "";
          const prior = known.get(so.name);
          const next = {
            odoo_so_number: so.name,
            odoo_so_id: so.id,
            marketplace: storefrontFor(partnerName, storefronts) ?? partnerName,
            partner_name: partnerName,
            // buyer, Marketplace Order ID, fee, income: the read value, else the stored one.
            ...keepKnownValues(prior, fact),
            odoo_salesperson_name: so.user_id ? so.user_id[1] : null,
            amount,
            // The order date, not the record's creation date: the two can land on
            // either side of a month boundary.
            ordered_at: toTimestamptz(so.date_order) ?? toTimestamptz(so.create_date),
            odoo_state: so.state ?? null,
          };
          return changedColumns(prior, next) ? { upsert: next } : null;
        },
      };
    }),
    // Orders outside the window: nothing but their notes can have changed, so only
    // the note columns that differ are written, by update. Writing the whole
    // stored row back could undo a concurrent run's fresher amount or state.
    ...rereads.map((row) => ({
      odooId: row.odoo_so_id as number,
      amount: Number(row.amount) || 0,
      planWrite: (fact: NoteFacts | undefined): Write | null => {
        const changes = changedColumns(row, { ...row, ...keepKnownValues(row, fact) });
        return changes ? { update: changes, odoo_so_number: row.odoo_so_number } : null;
      },
    })),
  ];

  let upserted = 0;
  for (let i = 0; i < reads.length; i += NOTE_BATCH_SIZE) {
    const batch = reads.slice(i, i + NOTE_BATCH_SIZE);
    const facts = await fetchNoteFacts(
      uid,
      batch.map((r) => ({ id: r.odooId, amount_total: r.amount })),
    );
    const writes = batch.map((r) => r.planWrite(facts.get(r.odooId))).filter((w) => w !== null);

    const rows = writes.flatMap((w) => ("upsert" in w ? [w.upsert] : []));
    if (rows.length > 0) {
      const { error } = await supabase.from("retail_orders").upsert(rows, { onConflict: "odoo_so_number" });
      if (error) throw error;
    }
    for (const w of writes) {
      if (!("update" in w)) continue;
      const { error } = await supabase.from("retail_orders").update(w.update).eq("odoo_so_number", w.odoo_so_number);
      if (error) throw error;
    }
    upserted += writes.length;
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

  return {
    mode,
    window: label,
    ordersRead: orders.length,
    notesRereadOutsideWindow: rereads.length,
    notesTouchedRecently: touched.size,
    upserted,
  };
}

// Scheduling lives in the database: pg_cron calls this function every 5 minutes
// and nightly with ?mode=full (migration 20261002120000_retail_sync_cron_and_realtime).
// An in-function Deno.cron used to run here hourly; it stopped firing on staging.

// ---------------------------------------------------------------------------
// HTTP handler (manual trigger / local testing / one-time historical load)
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (!isConfigured()) {
    return jsonResponse({ success: false, message: "Odoo unconfigured" });
  }

  // verify_jwt is off for this function (supabase/config.toml), so the public
  // anon key gets no further than here. Callers: pg_cron with Bearer CRON_SECRET,
  // or an operator with the service-role key. Fails closed when CRON_SECRET is
  // unset (#457).
  if (
    !isAuthorizedCaller(req.headers.get("Authorization"), {
      cronSecret: Deno.env.get("CRON_SECRET"),
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    })
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const params = new URL(req.url).searchParams;
    const since = params.get("since");
    const until = params.get("until");
    // `?mode=full` is the nightly run: also re-read orders whose notes were touched recently.
    const modeParam = params.get("mode");
    if (modeParam !== null && modeParam !== "full") {
      return jsonResponse({ success: false, error: "mode must be 'full' or left out." }, 400);
    }
    const stats = await runSync(since, until, modeParam === "full" ? "full" : "pending");
    console.log("[odoo-sor-sync] Sync complete:", stats);
    return jsonResponse({ success: true, message: "Sync complete", stats });
  } catch (err: any) {
    console.error("[odoo-sor-sync] Error:", err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
});
