import { useQuery } from "@tanstack/react-query";
import { costingMatrixService } from "../../services/costingMatrixService";
import { costingKeys } from "./costingKeys";

/**
 * The caller's Costing Matrix read tier on an SOR (#267): `closed_book`, `cost`,
 * `price`, `participant`, or null. The Costing Matrix section of the PMS tab shows when it is not null. A
 * failed read hides the section rather than guess.
 */
export function useCostingTier(opportunityId) {
  return useQuery({
    queryKey: costingKeys.tier(opportunityId),
    queryFn: () => costingMatrixService.tier(opportunityId),
    retry: false,
    staleTime: 60_000,
    // Leave `enabled` unset when there is an id, so the Release Notes
    // SampleProvider's off-by-default queries keep this off the network.
    ...(opportunityId ? {} : { enabled: false }),
  });
}

/**
 * The SOR's Costing Matrix as the caller's tier may read it. `data` is null when
 * the SOR has no matrix yet (a normal state, not an error) or the caller has no
 * tier.
 */
export function useCostingMatrix(opportunityId) {
  return useQuery({
    queryKey: costingKeys.matrix(opportunityId),
    queryFn: () => costingMatrixService.get(opportunityId),
    staleTime: 0,
    ...(opportunityId ? {} : { enabled: false }),
  });
}

/**
 * Does the caller edit the markup presets (#269)? Super Admins and the Final Acquire list, as the database
 * decides. `enabled: false` skips the question for someone whose answer does not matter.
 */
export function useCanManageMarkup({ enabled = true } = {}) {
  return useQuery({
    queryKey: costingKeys.canManageMarkup(),
    queryFn: () => costingMatrixService.canManageMarkup(),
    retry: false,
    staleTime: 60_000,
    enabled,
  });
}
