import { useQuery } from "@tanstack/react-query";
import { opportunityService } from "../../services/opportunityService";

/** Issue #390 — the Stages a move to which is a Return (the SOR has an earlier visit there). */
export const visitedStageIdsQuery = (opportunity) => ({
  queryKey: ["visitedStageIds", opportunity?.id, opportunity?.flow_stage_id],
  queryFn: () => opportunityService.getVisitedStageIds(opportunity.id),
});

export function useVisitedStageIds(opportunity, enabled = true) {
  const { data = [] } = useQuery({
    ...visitedStageIdsQuery(opportunity),
    enabled: Boolean(enabled && opportunity?.id && opportunity?.flow_stage_id),
  });
  return data;
}
