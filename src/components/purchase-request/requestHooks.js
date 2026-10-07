import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { purchaseRequestService } from "@/services/purchaseRequestService";
import { procurementQueueKey, purchaseRequestKeys } from "./queryKeys";

/** The database's refusal, without the function name it leads with. */
export const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/** One request's header (a `listQueue`-shaped row), shared by every part that needs it. */
export function usePurchaseRequest(requestId) {
  return useQuery({
    queryKey: purchaseRequestKeys.header(requestId),
    queryFn: () => purchaseRequestService.get(requestId),
    enabled: !!requestId,
  });
}

/** What refreshes after the Buyer changes: the queue and the request. */
export function useRefreshRequest(requestId) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: procurementQueueKey });
    queryClient.invalidateQueries({ queryKey: purchaseRequestKeys.all(requestId) });
  };
}

/**
 * Take: the signed-in purchaser becomes the Buyer of an unassigned request.
 * Shared by the request view and the queue row.
 */
export function useTakeRequest(requestId) {
  const refresh = useRefreshRequest(requestId);
  return useMutation({
    mutationFn: () => purchaseRequestService.take(requestId),
    onSuccess: () => toast.success("You're the Buyer."),
    onError: (err) => toast.error(refusal(err)),
    onSettled: refresh,
  });
}
