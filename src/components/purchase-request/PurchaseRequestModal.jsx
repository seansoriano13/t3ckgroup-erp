import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RecordModalContent } from "@/components/ui/record-modal";
import PurchaseRequestView from "./PurchaseRequestView";
import { usePurchaseRequest } from "./requestHooks";
import { REQUEST_MODAL_LAYER } from "./stacking";
import { sorClosedLabel } from "@/constants/purchaseRequest";

/**
 * Issue #309 — a Purchase Request opened from anywhere but the queue (an SOR,
 * a notification) as a RecordModal, the way tasks open. Same
 * `PurchaseRequestView` the queue's pane shows, Buyer included.
 *
 * It sits on REQUEST_MODAL_LAYER, over the SOR modal; every dialog the view
 * opens (add items, PO, confirmations) uses OVER_REQUEST_MODAL to show above it.
 */
export default function PurchaseRequestModal({ requestId, onClose }) {
  const { data: request } = usePurchaseRequest(requestId);
  const title = request?.project_title || "Purchase Request";
  const sorState = sorClosedLabel(request?.sor_closed) ?? request?.stage_name;
  const subtitle = [request?.sales_reference, sorState].filter(Boolean).join(" · ");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <RecordModalContent className={`${REQUEST_MODAL_LAYER} flex flex-col`}>
        <div className="shrink-0 border-b border-border px-6 py-4 pr-14">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription className="mt-1">{subtitle || "Purchase Request"}</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <PurchaseRequestView requestId={requestId} />
        </div>
      </RecordModalContent>
    </Dialog>
  );
}
