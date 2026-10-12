import { ChevronRight, PackageSearch, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RecordModalContent } from "@/components/ui/record-modal";
import StatusBadge from "@/components/StatusBadge";
import OpenSorButton from "./OpenSorButton";
import PurchaseRequestView from "./PurchaseRequestView";
import { usePurchaseRequest } from "./requestHooks";
import { REQUEST_MODAL_LAYER } from "./stacking";
import {
  REQUEST_KIND,
  requestIdentity,
  requestKind,
  requestStageLabel,
  sorClosedLabel,
} from "@/constants/purchaseRequest";
import { isRequestClosed } from "@/services/purchaseRequestService";
import { cn } from "@/lib/utils";

function RequestStateBadge({ row }) {
  if (!row) return null;
  const sorClosed = sorClosedLabel(row.sor_closed);
  if (isRequestClosed(row)) return <StatusBadge theme="green" label="Closed" />;
  if (sorClosed) return <StatusBadge theme="red" label={sorClosed} />;
  return <StatusBadge theme="amber" label="Open" />;
}

/**
 * Issue #309 — a Purchase Request opened from anywhere but the queue (an SOR,
 * a notification, or expanding the slide-over) as a RecordModal, the way tasks open.
 * Redesigned with a dedicated two-column split layout: Left details & items pane,
 * Right full-height collaborative Chat thread.
 *
 * It sits on REQUEST_MODAL_LAYER, over the SOR modal; every dialog the view
 * opens (add items, PO, confirmations) uses OVER_REQUEST_MODAL to show above it.
 */
export default function PurchaseRequestModal({ requestId, onClose }) {
  const { data: request } = usePurchaseRequest(requestId);
  const { reference, title } = requestIdentity(request);
  const direct = request && requestKind(request) === REQUEST_KIND.DIRECT;
  const sorState = sorClosedLabel(request?.sor_closed) ?? requestStageLabel(request);
  const countSummary = request?.item_count
    ? `${request.open_count ?? request.open_item_count ?? 0} open of ${request.item_count}`
    : null;
  const subtitle = direct
    ? "Direct Purchase Request"
    : [request?.sales_reference, sorState, countSummary].filter(Boolean).join(" · ");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <RecordModalContent
        showCloseButton={false}
        className={cn(REQUEST_MODAL_LAYER, "flex flex-col bg-card")}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border bg-muted/20 px-6 py-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
            <PackageSearch size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-muted-foreground">Purchase Requests</span>
              {reference && (
                <>
                  <ChevronRight size={11} className="text-muted-foreground/60" />
                  <span className="font-mono">{reference}</span>
                </>
              )}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <DialogTitle className="line-clamp-2 text-base font-bold text-foreground sm:text-lg">
                {title}
              </DialogTitle>
              <RequestStateBadge row={request} />
            </div>
            {subtitle && (
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                {subtitle}
              </DialogDescription>
            )}
          </div>
          <OpenSorButton request={request} onBeforeOpen={onClose} />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PurchaseRequestView requestId={requestId} layout="split" className="min-h-0 flex-1" />
        </div>
      </RecordModalContent>
    </Dialog>
  );
}
