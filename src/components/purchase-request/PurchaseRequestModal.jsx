import ModalShell from "@/components/ui/ModalShell";
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

function RequestStateBadge({ row }) {
  if (!row) return null;
  const sorClosed = sorClosedLabel(row.sor_closed);
  if (isRequestClosed(row)) return <StatusBadge theme="green" label="Closed" />;
  if (sorClosed) return <StatusBadge theme="red" label={sorClosed} />;
  return <StatusBadge theme="amber" label="Open" />;
}

/**
 * Issue #309 — a Purchase Request opened from anywhere but the queue (an SOR,
 * a notification, or expanding the slide-over) as a ModalShell (the purchasing modal).
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
    <ModalShell
      open
      onOpenChange={(open) => !open && onClose()}
      size="wide"
      expandable
      className={REQUEST_MODAL_LAYER}
      bodyClassName="gap-0 overflow-hidden p-0"
      cancelLabel="Close"
      crumbs={["Purchase Requests", reference].filter(Boolean)}
      headerActions={<OpenSorButton request={request} onBeforeOpen={onClose} />}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-3">
        <h2 className="line-clamp-2 text-base font-bold text-foreground">{title}</h2>
        <RequestStateBadge row={request} />
        {subtitle && <p className="w-full text-xs text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PurchaseRequestView requestId={requestId} layout="split" className="min-h-0 flex-1" />
      </div>
    </ModalShell>
  );
}
