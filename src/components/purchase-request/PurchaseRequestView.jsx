import { useEffect, useState } from "react";
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
 * part refreshes itself. `openCount` changes on every open from outside, so a
 * mention clicked while the request is already open opens the Chat again.
 */
export default function PurchaseRequestView({ requestId, focusChat = false, tab = null, openCount = 0, className = "" }) {
  const { data: request, isLoading, isError, refetch } = usePurchaseRequest(requestId);
  const [panel, setPanel] = useState(focusChat || tab === "chat" ? "chat" : null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an open from outside (a mention) picks the panel
    if (focusChat || tab === "chat") setPanel("chat");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the product lines are always shown; close the side panel
    else if (tab === "items") setPanel(null);
  }, [focusChat, tab, openCount]);

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

  // Members and Chat sit behind two toggles and open as one side column (below the items until the
  // window is wide enough for both, 2xl), so the item tables keep their width at 1440 px.
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center gap-x-3">
        <div className="min-w-0 flex-1">
          <RequestPills request={request} />
        </div>
        <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Side panel">
          {SIDE_PANELS.map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              type="button"
              variant={panel === key ? "secondary" : "outline"}
              size="sm"
              aria-pressed={panel === key}
              onClick={() => setPanel((current) => (current === key ? null : key))}
              aria-label={label}
              className="h-9 gap-1.5 max-sm:w-9 max-sm:px-0"
            >
              <Icon size={14} aria-hidden="true" />
              <span className="max-sm:sr-only">{label}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start">
        <div className="min-w-0 flex-1">
          <RequestedItems request={request} />
        </div>
        {panel === "members" && (
          <aside className="w-full shrink-0 rounded-2xl border border-border bg-muted/20 px-4 py-4 2xl:w-[300px]">
            <RequestMembers request={request} rail />
          </aside>
        )}
        {panel === "chat" && (
          <aside className="w-full min-w-0 shrink-0 overflow-hidden rounded-2xl border border-border 2xl:w-[400px]">
            <RequestChat request={request} focusOnMount={focusChat} openCount={openCount} className="h-[28rem] rounded-none border-0" />
          </aside>
        )}
      </div>
    </div>
  );
}
