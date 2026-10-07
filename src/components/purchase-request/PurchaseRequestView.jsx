import { useQuery } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";

import { cn } from "@/lib/utils";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import RequestBuyer from "./RequestBuyer";
import RequestMembers from "./RequestMembers";
import RequestedItems from "./RequestedItems";
import RequestChat from "./RequestChat";
import { purchaseRequestKeys } from "./queryKeys";

/** One request's header (a `listQueue`-shaped row), shared by every part that needs it. */
export function usePurchaseRequest(requestId) {
  return useQuery({
    queryKey: purchaseRequestKeys.header(requestId),
    queryFn: () => purchaseRequestService.get(requestId),
    enabled: !!requestId,
  });
}

/**
 * Issue #308 — one Purchase Request: its Buyer, members, Requested Items with
 * their statuses, and its Chat. Knows nothing of its container: the
 * Procurement Queue mounts it in a slide-over (with the Buyer pinned in the
 * footer, `hideBuyer`), and the modal opened from elsewhere (#309) mounts it
 * whole. Everything is read by `requestId`; each part refreshes itself.
 */
export default function PurchaseRequestView({ requestId, hideBuyer = false, className = "" }) {
  const { data: request, isLoading, isError } = usePurchaseRequest(requestId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (isError || !request) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={isError ? "Couldn't load this request" : "Request not available"}
        description={isError ? "Try again in a moment." : "It may have been removed, or you aren't one of its members."}
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {!hideBuyer && <RequestBuyer request={request} />}
      <RequestMembers request={request} />
      <RequestedItems request={request} />
      <RequestChat request={request} className="h-[28rem] shrink-0 overflow-hidden rounded-xl border border-border" />
    </div>
  );
}
