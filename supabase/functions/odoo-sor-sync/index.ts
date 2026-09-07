import {
  authenticate,
  executeKw,
  isConfigured,
  jsonResponse,
  ODOO_URL
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
 * Extract <img src="..."> URLs from raw Odoo message HTML and return them as
 * attachment objects suitable for sales_opportunity_logs.metadata.attachments.
 */
function extractAttachments(rawText: string) {
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const attachments: { url: string; name: string; type: string }[] = [];
  let match;
  while ((match = imgRegex.exec(rawText)) !== null) {
    let url = match[1];
    if (url.startsWith("/")) {
      url = `${ODOO_URL}${url}`;
    }
    attachments.push({ url, name: "Proof_of_Payment.png", type: "image/png" });
  }
  return attachments;
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
      ["name", "create_date", "date_order", "partner_id", "user_id"],
    ]);
  }
  const soMap = Object.fromEntries(saleOrders.map((so: any) => [so.id, so]));

  // Fetch employees once for name matching
  const { data: employees } = await supabase.from("employees").select("id, name");
  const empList = employees || [];

  // Resolve "Shara" as fallback deal owner and "101" as default sales director
  // by name so the UUIDs aren't environment-specific.
  const fallbackOwnerId = requireEmployee(empList, "shara", "Shara (fallback deal owner)");
  const salesDirectorId = requireEmployee(empList, "101", "101 (sales director)");

  // ---------------------------------------------------------------------------
  // Process notes
  // ---------------------------------------------------------------------------
  let newQueueCount = 0;
  let updatedDealerCount = 0;
  let skippedCount = 0;

  for (const note of allNotes) {
    const rawText = typeof note.content === "string" ? note.content : "";
    const cleanText = rawText.replace(/<[^>]*>?/gm, " ").replace(/&nbsp;/g, " ");
    const text = cleanText.toUpperCase();

    // -----------------------------------------------------------------------
    // Shopee retail order: "ORDER INCOME" pattern → write to queue
    // -----------------------------------------------------------------------
    if (text.includes("ORDER INCOME") && text.includes("ORDER ID")) {
      const nameMatch = cleanText.match(/NAME:?\s*([^\n]+)/i);
      const incomeMatch = cleanText.match(/ORDER INCOME:?\s*([\d,.]+)/i);

      if (nameMatch && incomeMatch) {
        const personName = nameMatch[1].trim();
        const expectedValue = parseFloat(incomeMatch[1].replace(/,/g, "")) || 0;
        const soNumber = note.res_name;

        const soData = soMap[note.res_id];
        const odooDateOrder = soData?.date_order || null;
        const odooCreateDate = soData?.create_date || null;
        const partnerName = soData?.partner_id
          ? soData.partner_id[1]
          : `Shopee Retail: ${personName}`;
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
          odoo_partner_name: partnerName,
          odoo_person_name: personName,
          odoo_amount: expectedValue,
          odoo_salesperson_name: odooSalesperson,
          odoo_date_order: odooDateOrder,
          odoo_create_date: odooCreateDate,
          // Pre-filled editable fields
          client_name: partnerName,
          contact_person: personName,
          expected_value: expectedValue,
          lead_source: "SHOPEE",
          project_title: `Shopee Retail: ${partnerName}`,
          deal_owner_id: dealOwnerId,
          sales_director_id: salesDirectorId,
        });

        if (error) {
          console.error(`[odoo-sor-sync] Error queuing ${soNumber}:`, error);
        } else {
          newQueueCount++;
          console.log(`[odoo-sor-sync] Queued Shopee order: ${soNumber}`);
        }
      }

    // -----------------------------------------------------------------------
    // Dealer / regular sale: "MODE OF PAYMENT" + "AMOUNT" → update SOR status
    // -----------------------------------------------------------------------
    } else if (text.includes("MODE OF PAYMENT") && text.includes("AMOUNT")) {
      const amountMatch = cleanText.match(/AMOUNT:?\s*([\d,.]+)/i);
      if (!amountMatch) continue;

      const soNumber = note.res_name;
      let updatedOppId: string | null = null;

      // Try direct match on sales_reference
      const { data: existing } = await supabase
        .from("sales_opportunities")
        .select("id")
        .eq("sales_reference", soNumber)
        .maybeSingle();

      if (existing) {
        updatedOppId = existing.id;
        const { error } = await supabase
          .from("sales_opportunities")
          .update({ status: "CLOSED_WON" })
          .eq("id", updatedOppId);
        if (!error) updatedDealerCount++;
      } else {
        // Fall back: match by partner name on open leads
        const soData = soMap[note.res_id];
        if (soData?.partner_id) {
          const partnerName = soData.partner_id[1];
          const { data: openLeads } = await supabase
            .from("sales_opportunities")
            .select("id")
            .ilike("client_name", `%${partnerName}%`)
            .neq("status", "CLOSED_WON")
            .neq("status", "LOST")
            .order("created_at", { ascending: false })
            .limit(1);

          if (openLeads && openLeads.length > 0) {
            updatedOppId = openLeads[0].id;
            const { error } = await supabase
              .from("sales_opportunities")
              .update({ status: "CLOSED_WON", sales_reference: soNumber })
              .eq("id", updatedOppId);
            if (!error) updatedDealerCount++;
          }
        }
      }

      // Attach Proof of Payment to the SOR log if images present
      if (updatedOppId) {
        const logAttachments = extractAttachments(rawText);
        if (logAttachments.length > 0) {
          const { data: existingLogs } = await supabase
            .from("sales_opportunity_logs")
            .select("id")
            .eq("opportunity_id", updatedOppId)
            .ilike("content", "%Proof of Payment imported%");

          if (!existingLogs || existingLogs.length === 0) {
            await supabase.from("sales_opportunity_logs").insert({
              opportunity_id: updatedOppId,
              type: "SYSTEM",
              content: "Odoo Sync: Proof of Payment imported.",
              metadata: { attachments: logAttachments },
            });
          }
        }
      }
    }
  }

  return {
    activitiesRead: activities.length,
    messagesRead: messages.length,
    newQueuedShopeeOrders: newQueueCount,
    updatedDealerDeals: updatedDealerCount,
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
