import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import toast from "react-hot-toast";

import { Tooltip } from "@/components/ui/Tooltip";
import { opportunityService } from "@/services/opportunityService";
import { S0Input } from "./S0Card";

export const SALES_REFERENCE_COLUMN = "sales_reference";

/**
 * The Sales Reference as a Stage Field or a field-kind checklist condition (#821). It renders the
 * S0 card's own input, so the save goes through the one S0 save step: same refusals, products
 * pulled from Odoo, same change preview. It never uses `saveRecordField`.
 *
 * Like the card, it offers the input only when the caller may change the S0 now (`can_edit`);
 * otherwise, or when `readOnly`, it shows the S0 as text.
 */
export default function SalesReferenceStageField({ opportunityId, value = "", readOnly = false, onSaved }) {
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

  const current = card?.sales_reference ?? value ?? "";

  if (readOnly || !card?.can_edit) {
    return (
      <span className="flex items-center gap-2 text-sm">
        {current ? (
          <span className="font-mono font-bold text-foreground">{current}</span>
        ) : (
          <span className="font-medium text-muted-foreground">Not set</span>
        )}
        {card?.lock === "locked" && (
          <Tooltip content={`Locked after ${card.first_stage_name}`}>
            <span aria-label="Locked" role="img" className="text-muted-foreground">
              <Lock size={14} aria-hidden />
            </span>
          </Tooltip>
        )}
      </span>
    );
  }

  return (
    <S0Input
      // A new stored S0 (the card loaded, or another save) starts a fresh draft.
      key={current}
      opportunityId={opportunityId}
      value={current}
      needsReason={card.lock === "locked"}
      onSaved={saved}
      autoFocus={false}
    />
  );
}
