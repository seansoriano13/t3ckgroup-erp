import { useEffect } from "react";
import { PackageSearch } from "lucide-react";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import SlideOver, { SlideOverBody, SlideOverFooter } from "@/components/ui/SlideOver";
import StatusBadge from "@/components/StatusBadge";
import OpenSorButton from "./OpenSorButton";
import PurchaseRequestModal from "./PurchaseRequestModal";
import PurchaseRequestView from "./PurchaseRequestView";
import RequestBuyer from "./RequestBuyer";
import { isRequestClosed } from "@/services/purchaseRequestService";
import { requestIdentity, requestStageLabel, sorClosedLabel } from "@/constants/purchaseRequest";

/** A request's own state: Closed, its SOR's closed reason, or Open. */
export function RequestState({ row }) {
  if (isRequestClosed(row)) return <StatusBadge theme="green" label="Closed" />;
  const sorClosed = sorClosedLabel(row.sor_closed);
  if (sorClosed) return <StatusBadge theme="red" label={sorClosed} />;
  return <StatusBadge theme="amber" label="Open" />;
}

function itemsSummary(row) {
  if (!row.item_count) return "No items yet";
  return `${row.open_count} open of ${row.item_count}`;
}

const sheetIdentity = (row) => ({
  ref: requestIdentity(row).reference,
  title: requestIdentity(row).title,
  badge: <RequestState row={row} />,
  subtitle: [requestStageLabel(row), itemsSummary(row)].filter(Boolean).join(" · "),
});

/** Desktop widths open a request full screen; narrower ones use the drawer. */
const DESKTOP = "(min-width: 768px)";

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

/**
 * A Purchase Request picked from a list (the Purchase Requests list, the
 * Purchasing Dashboard). A request holds too much for a drawer, so on desktop
 * widths it opens full screen in the RecordModal; on mobile widths it opens in
 * the slide-over.
 *
 * `request` is a queue-shaped row (null = closed); `index`, `total` and
 * `onStep` step through the list it came from (drawer only).
 */
export default function PurchaseRequestSlideOver({ request, crumb, index, total, onStep, onClose }) {
  const desktop = useMediaQuery(DESKTOP);
  useEffect(clearOldOpenAsChoice, []);

  if (desktop) {
    if (!request) return null;
    return <PurchaseRequestModal requestId={request.id} onClose={onClose} />;
  }

  return (
    <SlideOver
      record={request}
      icon={PackageSearch}
      crumb={crumb}
      identity={sheetIdentity}
      index={index}
      total={total}
      onStep={onStep}
      onClose={onClose}
      headerActions={(row) => <OpenSorButton request={row} compact />}
    >
      {(row) => (
        <>
          <SlideOverBody>
            <PurchaseRequestView requestId={row.id} hideBuyer />
          </SlideOverBody>
          <SlideOverFooter>
            <RequestBuyer request={row} />
          </SlideOverFooter>
        </>
      )}
    </SlideOver>
  );
}
