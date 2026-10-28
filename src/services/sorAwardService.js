import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import { formatDateWith } from "../utils/formatDate";

/**
 * "Awarded" (#746, spec #735): an SOR with a Date of Award. The Date of Award
 * itself is set elsewhere (the Notice of Award move or the Deal Team typing it);
 * this tells Purchasing about it and reads the dates for the Purchase Requests
 * list and the Purchasing Dashboard badge.
 */
export const sorAwardService = {
  /** A Map of SOR id to Date of Award for the SORs that have one. A failed read leaves the badge out. */
  async forSors(opportunityIds) {
    const ids = [...new Set((opportunityIds ?? []).filter(Boolean))];
    if (ids.length === 0) return new Map();
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select("id, date_of_award")
      .in("id", ids)
      .not("date_of_award", "is", null);
    if (error) return new Map();
    return new Map((data ?? []).map((row) => [row.id, row.date_of_award]));
  },

  /**
   * Tells every Purchasing holder the SOR is Awarded. Call it once, when the
   * Date of Award goes from blank to filled. Best effort: it never fails the save.
   */
  async notifyPurchasing(opportunity, actorId = null) {
    try {
      if (!opportunity?.id || !opportunity.date_of_award) return;
      const { data: holders, error } = await supabase
        .from("employees")
        .select("id")
        .eq("has_purchasing_flow", true)
        .neq("is_deleted", true);
      if (error) throw error;
      const label = opportunity.sales_reference || opportunity.project_title || "An SOR";
      const on = formatDateWith(opportunity.date_of_award, { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
      await Promise.all(
        (holders ?? []).map((holder) =>
          notificationService.createNotification({
            recipient_id: holder.id,
            sender_id: actorId,
            type: "SOR_AWARDED",
            title: "SOR Awarded",
            message: `${label} is Awarded (Date of Award ${on}).`,
            reference_id: opportunity.id,
          }),
        ),
      );
    } catch (err) {
      console.error("Failed to notify Purchasing of an Awarded SOR:", err);
    }
  },
};
