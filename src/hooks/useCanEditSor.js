import { useQuery } from "@tanstack/react-query";
import { opportunityService } from "../services/opportunityService";

/** #379: whether the database would accept an edit to this SOR. */
export function useCanEditSor(opportunityId, { enabled = true } = {}) {
  const { data } = useQuery({
    queryKey: ["sorCanEdit", opportunityId],
    queryFn: () => opportunityService.canEdit(opportunityId),
    enabled: !!opportunityId && enabled,
  });
  return data === true;
}
