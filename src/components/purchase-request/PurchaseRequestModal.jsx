import { useEffect } from "react";

import ModalShell from "@/components/ui/ModalShell";
import RecordHeader from "@/components/record/RecordHeader";
import OpenSorButton from "./OpenSorButton";
import PurchaseRequestView from "./PurchaseRequestView";
import { usePurchaseRequest } from "./requestHooks";
import { REQUEST_STATE_TONES, requestStateOf } from "./queueList";
import { REQUEST_KIND, requestIdentity, requestKind, requestStageLabel } from "@/constants/purchaseRequest";

/** The old per-person drawer/full choice is gone; clear what it left behind. */
function clearOldOpenAsChoice() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("purchase_request_open_as:")) localStorage.removeItem(key);
    }
  } catch {
    // Storage is blocked: nothing to clean.
  }
}

/** "Purchase Request for S01001 · Stage · 2 open of 5" — the one quiet line under the title. */
function headerLine(request) {
  const direct = requestKind(request) === REQUEST_KIND.DIRECT;
  const count = request.item_count ? `${request.open_count ?? request.open_item_count ?? 0} open of ${request.item_count}` : null;
  const lead = direct ? "Direct Purchase Request" : `Purchase Request for ${request.sales_reference || "an SOR"}`;
  return [lead, requestStageLabel(request), count].filter(Boolean).join(" · ");
}

/**
 * A Purchase Request in the record window (ModalShell `size="record"`), at every
 * width: a full-screen window on a phone, never a side panel. Opened from the
 * Purchase Requests list or the Purchasing Dashboard (`?request=`), an SOR, a
 * notification or a Canvass.
 *
 * Header (`RecordHeader`): "SOR · project" or "Direct · title", the Open /
 * Closed badge and one line. Under it: the pills, the Members and Chat toggles
 * and the Requested Items (`PurchaseRequestView`). Open SOR is the window's one
 * header button. It sits on the record layer; every dialog the view opens (add
 * items, PO, confirmations) uses OVER_REQUEST_MODAL to show above it.
 */
export default function PurchaseRequestModal({ requestId, focusChat = false, onClose }) {
  const { data: request } = usePurchaseRequest(requestId);
  useEffect(clearOldOpenAsChoice, []);
  const { reference, title } = requestIdentity(request);
  const { state, label } = request ? requestStateOf(request) : {};

  return (
    <ModalShell
      open
      onOpenChange={(open) => !open && onClose()}
      size="record"
      crumbs={["Purchase Request", request ? reference : null].filter(Boolean)}
      headerActions={<OpenSorButton request={request} onBeforeOpen={onClose} />}
    >
      {request && (
        <RecordHeader
          reference={reference}
          name={title}
          mono={requestKind(request) !== REQUEST_KIND.DIRECT}
          badge={{ label, theme: REQUEST_STATE_TONES[state] }}
          line={headerLine(request)}
        />
      )}
      <PurchaseRequestView requestId={requestId} focusChat={focusChat} />
    </ModalShell>
  );
}
