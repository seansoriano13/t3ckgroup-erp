import { useState } from "react";
import { MessageSquare, PackageSearch, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import QueryError from "@/components/ui/QueryError";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import RequestPills from "./RequestPills";
import RequestMembers from "./RequestMembers";
import RequestedItems from "./RequestedItems";
import RequestChat from "./RequestChat";
import { usePurchaseRequest } from "./requestHooks";

const SIDE_PANELS = [
  { key: "members", label: "Members", icon: Users },
  { key: "chat", label: "Chat", icon: MessageSquare },
];

/**
 * Issue #308 — one Purchase Request's body: its pills (Buyer, SOR, Stage,
 * Items), the Members and Chat toggles, its Requested Items with their
 * statuses, and the side panel the toggles open. The record window mounts it
 * at every width, under its header. Everything is read by `requestId`; each
 * part refreshes itself.
 */
export default function PurchaseRequestView({ requestId, focusChat = false, className = "" }) {
  const { data: request, isLoading, isError, refetch } = usePurchaseRequest(requestId);
  const [panel, setPanel] = useState(focusChat ? "chat" : null);

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

  // Members and Chat sit behind two toggles and open as one side panel (below the items on a phone),
  // so nothing competes with the list.
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <RequestPills request={request} />
        <div className="ml-auto flex items-center gap-2" role="group" aria-label="Side panel">
          {SIDE_PANELS.map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              type="button"
              variant={panel === key ? "secondary" : "outline"}
              size="sm"
              aria-pressed={panel === key}
              onClick={() => setPanel((current) => (current === key ? null : key))}
              className="h-9 gap-1.5"
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <RequestedItems request={request} />
        </div>
        {panel === "members" && (
          <aside className="w-full shrink-0 rounded-2xl border border-border bg-muted/20 px-4 py-4 md:w-[300px]">
            <RequestMembers request={request} rail />
          </aside>
        )}
        {panel === "chat" && (
          <aside className="w-full shrink-0 overflow-hidden rounded-2xl border border-border md:w-[380px]">
            <RequestChat request={request} focusOnMount={focusChat} className="h-[28rem] rounded-none border-0" />
          </aside>
        )}
      </div>
    </div>
  );
}
