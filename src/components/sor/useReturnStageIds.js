import { useQuery } from "@tanstack/react-query";
import { opportunityService } from "../../services/opportunityService";

/** Issue #390 — the Stages a move to which is a Return (the SOR has an earlier visit there). */
export const returnStageIdsQuery = (opportunity) => ({
  queryKey: ["returnStageIds", opportunity?.id, opportunity?.flow_stage_id],
  queryFn: () => opportunityService.getReturnStageIds(opportunity.id),
});

export function useReturnStageIds(opportunity, enabled = true) {
  const { data = [] } = useQuery({
    ...returnStageIdsQuery(opportunity),
    enabled: Boolean(enabled && opportunity?.id && opportunity?.flow_stage_id),
  });
  return data;
}
