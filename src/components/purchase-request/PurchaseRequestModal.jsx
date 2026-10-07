import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RecordModalContent } from "@/components/ui/record-modal";
import PurchaseRequestView from "./PurchaseRequestView";
import { usePurchaseRequest } from "./requestHooks";

/**
 * Issue #309 — a Purchase Request opened from anywhere but the queue (an SOR,
 * a notification) as a RecordModal, the way tasks open. Same
 * `PurchaseRequestView` the queue's pane shows, Buyer included.
 */
export default function PurchaseRequestModal({ requestId, onClose }) {
  const { data: request } = usePurchaseRequest(requestId);
  const title = request?.project_title || "Purchase Request";
  const subtitle = [request?.client_name, request?.opportunity_no].filter(Boolean).join(" · ");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <RecordModalContent className="z-[70] flex flex-col">
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
