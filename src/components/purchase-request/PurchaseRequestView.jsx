import { PackageSearch } from "lucide-react";

import QueryError from "@/components/ui/QueryError";
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
  const { data: request, isLoading, isError, refetch } = usePurchaseRequest(requestId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (isError) {
    return <QueryError title="Couldn’t load this request." onRetry={refetch} />;
  }
  if (!request) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="Request not available"
        description="It may have been removed, or you aren’t one of its members."
      />
    );
  }

  const open = request.open_count ?? request.open_item_count ?? 0;
  const summary = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {!hideBuyer && (
        <div className="min-w-[260px] flex-1">
          <RequestBuyer request={request} />
        </div>
      )}
      {request.item_count > 0 && (
        <p className="text-xs font-medium text-muted-foreground">
          {open} open of {request.item_count}
        </p>
      )}
    </div>
  );

  // Slide-over: items first, members under them in one card, chat below.
  if (layout !== "split") {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        {summary}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="px-4 py-4">
            <RequestedItems request={request} />
          </div>
          <div className="border-t border-border bg-muted/20 px-3 py-3">
            <RequestMembers request={request} rail />
          </div>
        </div>
        <RequestChat request={request} className="h-[26rem] shrink-0 overflow-hidden rounded-2xl border border-border" />
      </div>
    );
  }

  // Full screen: member rail | items | chat, in one bordered card (like Group Tasks).
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-5", className)}>
      {summary}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="w-[240px] shrink-0 overflow-y-auto border-r border-border bg-muted/20 px-3 py-4">
          <RequestMembers request={request} rail />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <RequestedItems request={request} />
        </div>
        <div className="flex w-[380px] shrink-0 flex-col border-l border-border">
          <RequestChat request={request} className="h-full flex-1 rounded-none border-0" />
        </div>
      </div>
    </div>
  );
}
