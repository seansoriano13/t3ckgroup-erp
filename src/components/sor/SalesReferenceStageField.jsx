import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { opportunityService } from "@/services/opportunityService";
import { S0Input } from "./S0Card";

export const SALES_REFERENCE_COLUMN = "sales_reference";

/**
 * The Sales Reference as a Stage Field or a field-kind checklist condition (#821). It renders the
 * S0 card's own input, so the save goes through the one S0 save step: same refusals, products
 * pulled from Odoo, same change preview. It never uses `saveRecordField`.
 */
export default function SalesReferenceStageField({ opportunityId, value = "", onSaved }) {
  const queryClient = useQueryClient();

  const { data: card } = useQuery({
    queryKey: ["salesReferenceCard", opportunityId],
    queryFn: () => opportunityService.getSalesReferenceCard(opportunityId),
    enabled: Boolean(opportunityId),
  });

  const saved = (result) => {
    toast.success(result?.sales_reference ? "S0 saved." : "S0 cleared.");
    // The same refresh the S0 card does.
    queryClient.invalidateQueries({ queryKey: ["salesReferenceCard", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["globalOpportunity", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["opportunity", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["opportunityItems", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
    onSaved?.(result);
  };

  return (
    <S0Input
      opportunityId={opportunityId}
      value={card?.sales_reference ?? value ?? ""}
      needsReason={card?.lock === "locked"}
      onSaved={saved}
      autoFocus={false}
    />
  );
}
