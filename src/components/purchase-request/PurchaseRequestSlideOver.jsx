import { useState } from "react";
import { PackageSearch } from "lucide-react";

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

const OPEN_AS = { DRAWER: "drawer", FULL: "full" };
const openAsKey = (userId) => `purchase_request_open_as:${userId ?? "anon"}`;

function readOpenAs(userId) {
  try {
    return localStorage.getItem(openAsKey(userId)) === OPEN_AS.FULL ? OPEN_AS.FULL : OPEN_AS.DRAWER;
  } catch {
    return OPEN_AS.DRAWER;
  }
}

function writeOpenAs(userId, openAs) {
  try {
    localStorage.setItem(openAsKey(userId), openAs);
  } catch {
    // Storage is blocked or full: the choice just isn't remembered.
  }
}

/**
 * A Purchase Request picked from a list (the Purchase Requests list, the
 * Purchasing Dashboard), open beside it in the slide-over or full screen in
 * the RecordModal. "Open full" in the slide-over and "Show in side panel" in
 * the modal switch between them, and the last choice is remembered per person
 * in this browser, so their next request opens the same way. Storage that is
 * missing or throws only means it opens in the slide-over.
 *
 * `request` is a queue-shaped row (null = closed); `index`, `total` and
 * `onStep` step through the list it came from.
 */
export default function PurchaseRequestSlideOver({ request, userId, crumb, index, total, onStep, onClose }) {
  const [openAs, setOpenAs] = useState(() => readOpenAs(userId));
  const choose = (next) => {
    setOpenAs(next);
    writeOpenAs(userId, next);
  };

  if (openAs === OPEN_AS.FULL) {
    if (!request) return null;
    return (
      <PurchaseRequestModal
        requestId={request.id}
        onClose={onClose}
        onShowSidePanel={() => choose(OPEN_AS.DRAWER)}
      />
    );
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
      onOpenFull={() => choose(OPEN_AS.FULL)}
      openFullLabel="Open full"
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
