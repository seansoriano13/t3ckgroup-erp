import { PackageSearch } from "lucide-react";

import { cn } from "@/lib/utils";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import RequestBuyer from "./RequestBuyer";
import RequestMembers from "./RequestMembers";
import RequestedItems from "./RequestedItems";
import RequestChat from "./RequestChat";
import { usePurchaseRequest } from "./requestHooks";

/**
 * Issue #308 — one Purchase Request: its Buyer, members, Requested Items with
 * their statuses, and its Chat. Knows nothing of its container: the
 * Purchase Requests list mounts it in a slide-over (with the Buyer pinned in the
 * footer, `hideBuyer`), and the modal opened from elsewhere (#309) mounts it
 * whole. Everything is read by `requestId`; each part refreshes itself.
 */
export default function PurchaseRequestView({
  requestId,
  hideBuyer = false,
  layout = "stacked",
  className = "",
}) {
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

  if (layout === "split") {
    return (
      <div className={cn("flex flex-1 flex-col lg:flex-row min-h-0 overflow-hidden", className)}>
        {/* Left pane: Details, Buyer, Members, Requested Items */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar">
          {!hideBuyer && (
            <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
              <RequestBuyer request={request} />
            </div>
          )}
          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <RequestMembers request={request} />
          </div>
          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <RequestedItems request={request} />
          </div>
        </div>

        {/* Right pane: Dedicated Full-Height Chat */}
        <div className="w-full lg:w-[420px] xl:w-[460px] shrink-0 border-t lg:border-t-0 lg:border-l border-border flex flex-col min-h-0 bg-card">
          <RequestChat request={request} className="h-full flex-1 rounded-none border-0" />
        </div>
      </div>
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
