import { useQuery } from "@tanstack/react-query";
import { ipasSorStandingService } from "../../services/ipasSorStandingService";
import { ipasSorSummariesKey } from "./ipasKeys";

/**
 * The Project IPAS naming an SOR, as a summary (#249). `data` is an empty list
 * when none names it or the caller may not read the SOR; the section then
 * shows nothing. It carries no money or bank details.
 */
export function useIpasSorSummaries(opportunityId, { enabled } = {}) {
  return useQuery({
    queryKey: ipasSorSummariesKey(opportunityId),
    queryFn: () => ipasSorStandingService.summariesForSor(opportunityId),
    // Leave `enabled` unset when the caller does not say, so the Release Notes
    // SampleProvider's off-by-default queries keep this off the network.
    ...(opportunityId ? (enabled === undefined ? {} : { enabled }) : { enabled: false }),
    staleTime: 0,
  });
}
