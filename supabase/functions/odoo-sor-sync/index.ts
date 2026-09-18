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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up an employee ID by a partial name match against the employees table.
 * Used to match Odoo salesperson names to internal employees.
 */
function findEmployeeId(employees: { id: string; name: string }[], searchStr: string): string | null {
  if (!employees || !searchStr) return null;
  const s = searchStr.toLowerCase();
  const match = employees.find((e) => {
    const full = (e.name || "").toLowerCase();
    return full.includes(s) || s.includes(full);
  });
  return match ? match.id : null;
}

/**
 * Find the employee whose name contains the given fragment. Returns the UUID.
 * This avoids hardcoding environment-specific UUIDs in the function.
 */
function requireEmployee(
  employees: { id: string; name: string }[],
  nameFragment: string,
  label: string
): string | null {
  const id = findEmployeeId(employees, nameFragment);
  if (!id) console.warn(`[odoo-sor-sync] Could not find employee for "${label}" (searched: "${nameFragment}")`);
  return id;
}

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
 * Issue #172: retail is whoever the Odoo customer is, not what lead source a
 * record was tagged with or what words appear in a note. Production has a
 * ₱144,000 government proposal tagged Shopee, and retail-shaped records
 * appear under three other lead sources — so this checks the one field that
 * actually says who bought it.
 */
function isStorefrontCustomer(partnerName: string | null | undefined, storefronts: string[]): boolean {
  if (!partnerName) return false;
  const name = partnerName.toLowerCase();
  return storefronts.some((s) => name.includes(s.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

async function runSync() {
  const uid = await authenticate();

  // Search window: last 30 days
  const searchDaysAgo = new Date();
  searchDaysAgo.setDate(searchDaysAgo.getDate() - 30);
  const dateStr = searchDaysAgo.toISOString().split("T")[0] + " 00:00:00";

  // Fetch Odoo mail activities and messages for sale.orders in the window
  const [activities, messages] = await Promise.all([
    executeKw(uid, "mail.activity", "search_read", [
      [
        ["res_model", "=", "sale.order"],
        ["create_date", ">=", dateStr],
      ],
      ["id", "res_id", "res_name", "note", "create_date"],
    ]),
    executeKw(uid, "mail.message", "search_read", [
      [
        ["model", "=", "sale.order"],
        ["create_date", ">=", dateStr],
        ["message_type", "in", ["comment", "notification"]],
      ],
      ["id", "res_id", "record_name", "body", "create_date"],
    ]),
  ]);

  const allNotes = [
    ...activities.map((a: any) => ({
      id: `act_${a.id}`,
      res_id: a.res_id,
      res_name: a.res_name,
      content: a.note || "",
      date: a.create_date,
    })),
    ...messages.map((m: any) => ({
      id: `msg_${m.id}`,
      res_id: m.res_id,
      res_name: m.record_name,
      content: m.body || "",
      date: m.create_date,
    })),
  ];

  // Batch-fetch all referenced sale.orders from Odoo
  const soIds = Array.from(new Set(allNotes.map((n) => n.res_id)));
  let saleOrders: any[] = [];
  if (soIds.length > 0) {
    saleOrders = await executeKw(uid, "sale.order", "read", [
      soIds,
      ["name", "create_date", "date_order", "partner_id", "user_id", "amount_total"],
    ]);
  }
  const soMap = Object.fromEntries(saleOrders.map((so: any) => [so.id, so]));

  // Fetch employees once for name matching
  const { data: employees } = await supabase.from("employees").select("id, name");
  const empList = employees || [];

  // Issue #172: configurable storefront list, not a hardcoded lead source or
  // note-text pattern.
  const { data: appSettings } = await supabase
    .from("app_settings")
    .select("retail_storefronts")
    .maybeSingle();
  const storefronts: string[] = appSettings?.retail_storefronts?.length
    ? appSettings.retail_storefronts
    : ["Shopee", "Lazada"];

  // Resolve "Shara" as fallback deal owner and "101" as default sales director
  // by name so the UUIDs aren't environment-specific.
  const fallbackOwnerId = requireEmployee(empList, "shara", "Shara (fallback deal owner)");
  const salesDirectorId = requireEmployee(empList, "101", "101 (sales director)");

  // ---------------------------------------------------------------------------
  // Process notes
  // ---------------------------------------------------------------------------
  let newQueueCount = 0;
  let skippedCount = 0;

  for (const note of allNotes) {
    const rawText = typeof note.content === "string" ? note.content : "";
    const cleanText = toPlainText(rawText);
    const text = cleanText.toUpperCase();
    const soData = soMap[note.res_id];
    const partnerName: string | null = soData?.partner_id ? soData.partner_id[1] : null;

    // -----------------------------------------------------------------------
    // Retail order (issue #172): detected by the Odoo customer matching the
    // configurable storefront list — not by words in the note, and not by
    // lead source. The note, if present and parseable, only enriches the
    // buyer's name; it never gates whether the order is processed.
    // -----------------------------------------------------------------------
    if (isStorefrontCustomer(partnerName, storefronts)) {
      const nameMatch = cleanText.match(/NAME:?\s*([^\n]+)/i);
      const personName = nameMatch ? nameMatch[1].trim() : null;
      // Issue #172: the sale's value is the Odoo order's own total, not a
      // number typed into a note — the note may not even mention one.
      const expectedValue = typeof soData?.amount_total === "number" ? soData.amount_total : 0;
      const soNumber = note.res_name;

      const odooDateOrder = soData?.date_order || null;
      const odooCreateDate = soData?.create_date || null;
      const clientName = partnerName || `Retail: ${personName || soNumber}`;
      const odooSalesperson = soData?.user_id ? soData.user_id[1] : null;
      const odooSoId = soData?.id || note.res_id;

      // Resolve deal owner: try Odoo salesperson, fall back to Shara
      const matchedOwnerId = odooSalesperson
        ? findEmployeeId(empList, odooSalesperson)
        : null;
      const dealOwnerId = matchedOwnerId || fallbackOwnerId;

      // Check: already in queue (any status — we never re-insert dismissed items)
      const { data: existingQueue } = await supabase
        .from("odoo_retail_queue")
        .select("id, status")
        .eq("odoo_so_number", soNumber)
        .maybeSingle();

      if (existingQueue) {
        skippedCount++;
        continue; // already queued/approved/dismissed — do nothing
      }

      // Check: already directly in SOR (pre-queue entries from old sync)
      const { data: existingSor } = await supabase
        .from("sales_opportunities")
        .select("id")
        .eq("sales_reference", soNumber)
        .maybeSingle();

      if (existingSor) {
        skippedCount++;
        continue; // old direct SOR entry — leave it alone
      }

      // Insert into queue
      const { error } = await supabase.from("odoo_retail_queue").insert({
        odoo_so_number: soNumber,
        odoo_so_id: odooSoId,
        odoo_partner_name: clientName,
        odoo_person_name: personName,
        odoo_amount: expectedValue,
        odoo_salesperson_name: odooSalesperson,
        odoo_date_order: odooDateOrder,
        odoo_create_date: odooCreateDate,
        // Pre-filled editable fields
        client_name: clientName,
        contact_person: personName,
        expected_value: expectedValue,
        lead_source: "SHOPEE",
        project_title: `Retail: ${clientName}`,
        deal_owner_id: dealOwnerId,
        sales_director_id: salesDirectorId,
      });

      if (error) {
        console.error(`[odoo-sor-sync] Error queuing ${soNumber}:`, error);
      } else {
        newQueueCount++;
        console.log(`[odoo-sor-sync] Queued retail order: ${soNumber}`);
      }
    }

    // The other half of this loop used to live here: a "MODE OF PAYMENT" +
    // "AMOUNT" note closed the matching SOR as Won, falling back to an
    // ilike('%partner_name%') match against any open lead when the sales
    // reference did not match — overwriting that lead's sales_reference on the
    // way. Running hourly against production, that is a deal silently marked
    // Won because two customers share a word in their name. Removed outright
    // rather than disabled — a hazard one manual invocation away is worse than
    // no feature. The goal is worth keeping, so it is written up as issue #324,
    // to come back with an exact sales_reference match and no fuzzy fallback.
    // This function syncs retail, and nothing else.
  }

  return {
    activitiesRead: activities.length,
    messagesRead: messages.length,
    newQueuedShopeeOrders: newQueueCount,
    skipped: skippedCount,
  };
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
// HTTP handler (manual trigger / local testing)
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
    const stats = await runSync();
    return jsonResponse({ success: true, message: "Sync complete", stats });
  } catch (err: any) {
    console.error("[odoo-sor-sync] Error:", err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
});
