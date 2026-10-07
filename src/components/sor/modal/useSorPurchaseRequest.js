import { useQuery } from "@tanstack/react-query";
import { purchaseRequestService } from "../../../services/purchaseRequestService";

/** React Query key of an SOR's Purchase Request overview (#310). */
export const sorPurchaseRequestKey = (opportunityId) => ["sor-purchase-request", opportunityId];

/**
 * The SOR's Purchase Request as the modal shows it: the Buyer and the
 * Requested Items. `data` is null when the SOR has none (or the caller may not
 * read it), and every part of the SOR that shows purchasing then shows nothing.
 */
export function useSorPurchaseRequest(opportunityId, { enabled = true } = {}) {
  return useQuery({
    queryKey: sorPurchaseRequestKey(opportunityId),
    queryFn: () => purchaseRequestService.getSorOverview(opportunityId),
    enabled: !!opportunityId && enabled,
    staleTime: 0,
  });
}

/** Opens the request as a modal over the SOR (#309 stacks it). */
export function openPurchaseRequest(requestId) {
  window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: requestId, type: "PURCHASE_REQUEST" } }));
}
