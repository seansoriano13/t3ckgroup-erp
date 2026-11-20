import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ArrowUpRight, Briefcase, Trash2 } from "lucide-react";

import ModalShell from "@/components/ui/ModalShell";
import RecordHeader from "@/components/record/RecordHeader";
import NewOdooPoLink from "@/components/ui/NewOdooPoLink";
import RecordMoreMenu from "@/components/record/RecordMoreMenu";
import { sorHref } from "@/utils/sorLink";
import { ODOO_NEW_PO_URL } from "@/utils/odooLinks";
import { useAuth } from "@/context/AuthContext";
import { getPermissionContext } from "@/utils/permissions";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import CanvassReasonDialog from "./CanvassReasonDialog";
import OpenSorButton from "./OpenSorButton";
import PurchaseRequestView from "./PurchaseRequestView";
import { useDeleteRequest, usePurchaseRequest } from "./requestHooks";
import { REQUEST_STATE_TONES, requestStateOf } from "./queueList";
import { REQUEST_KIND, requestIdentity, requestKind, requestStageLabel } from "@/constants/purchaseRequest";
import { useIsPhone } from "@/hooks/useScreenBand";

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

/** "PR_0042 · Purchase Request for S01001 · Stage · 2 open of 5" — the one quiet line under the title. */
function headerLine(request) {
  const direct = requestKind(request) === REQUEST_KIND.DIRECT;
  const count = request.item_count ? `${request.open_count ?? request.open_item_count ?? 0} open of ${request.item_count}` : null;
  const lead = direct ? "Direct Purchase Request" : `Purchase Request for ${request.sales_reference || "an SOR"}`;
  return [request.pr_number, lead, requestStageLabel(request), count].filter(Boolean).join(" · ");
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
export default function PurchaseRequestModal({ requestId, focusChat = false, tab = null, openCount = 0, onClose, onPanelChange, className }) {
  const { data: request } = usePurchaseRequest(requestId);
  useEffect(clearOldOpenAsChoice, []);
  const { reference, title } = requestIdentity(request);
  const { state, label } = request ? requestStateOf(request) : {};
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { user } = useAuth();
  const { hasPurchasingFlow, isSuperAdmin } = getPermissionContext(user);
  const [deleting, setDeleting] = useState(false);
  const deleteRequest = useDeleteRequest(requestId);
  // The requester may delete their own; Purchasing and Super Admin any. The database decides in the end.
  const { data: openedByMe = false } = useQuery({
    queryKey: ["purchase-request", requestId, "opened-by-me", user?.id],
    queryFn: () => purchaseRequestService.openedByMe(requestId, user?.id),
    enabled: !!requestId && !!user?.id,
  });
  const canDelete = !!request && (hasPurchasingFlow || isSuperAdmin || openedByMe);
  // On a phone the two header actions go into a More menu so the breadcrumb has room.
  const moreItems = [
    {
      key: "po",
      label: "Create a PO in Odoo",
      icon: ArrowUpRight,
      onSelect: () => window.open(ODOO_NEW_PO_URL, "_blank", "noopener,noreferrer"),
    },
  ];
  if (request && requestKind(request) === REQUEST_KIND.PROJECT) {
    moreItems.push({
      key: "sor",
      label: "Open SOR",
      icon: Briefcase,
      onSelect: () => {
        onClose({ leaving: true });
        navigate(sorHref(request.opportunity_id));
      },
    });
  }

  if (canDelete) {
    moreItems.push({ key: "delete", label: "Delete request", icon: Trash2, destructive: true, onSelect: () => setDeleting(true) });
  }

  return (
    <ModalShell
      open
      onOpenChange={(open) => !open && onClose()}
      size="record"
      crumbs={["Purchase Request", request ? reference : null].filter(Boolean)}
      headerActions={
        phone ? (
          <RecordMoreMenu items={moreItems} />
        ) : (
          <>
            <NewOdooPoLink />
            <OpenSorButton request={request} onBeforeOpen={() => onClose({ leaving: true })} />
            {canDelete && <RecordMoreMenu items={moreItems.filter((item) => item.key === "delete")} />}
          </>
        )
      }
      className={className}
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
      <PurchaseRequestView requestId={requestId} focusChat={focusChat} tab={tab} openCount={openCount} onPanelChange={onPanelChange} onBack={() => onClose()} />
      {deleting && (
        <CanvassReasonDialog
          open
          onOpenChange={setDeleting}
          crumbs={["Purchase Request", reference, "Delete"].filter(Boolean)}
          title={`Delete ${reference || "this request"}?`}
          intro="It disappears from every list. Purchasing can restore it later. This is refused once a line is purchased, received or on an IPAS."
          label="Why are you deleting it?"
          placeholder="One line, for the history"
          confirmLabel="Delete request"
          onSubmit={async (reason) => {
            await deleteRequest.mutateAsync(reason);
            onClose();
          }}
        />
      )}
    </ModalShell>
  );
}
