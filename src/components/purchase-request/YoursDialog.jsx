import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import DetailGrid from "@/components/record/DetailGrid";
import ModalShell from "@/components/ui/ModalShell";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "../StatusBadge";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../../constants/purchaseRequest";
import { formatAmount } from "../../utils/requestedItem";
import { refusal, useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

/** #688 - the P0 line's delivery as the request carries it ("Purchased · 3 of 6 received"). */
const deliveryOf = (request) => {
  if (request.po_state === "rfq") return `RFQ ${request.po_number}, not confirmed yet`;
  if (request.po_ordered > 0) return `${request.po_received || 0} of ${request.po_ordered} received`;
  return null;
};

/**
 * #688 - "Is this from your purchase request?": the new S0 line beside the Other request that may
 * be the same product. Yes moves the P0 onto the S0 line and closes the request; No clears the
 * question. The database does either in one call.
 */
export function YoursDialog({ open, onOpenChange, item, other, requestId }) {
  const refresh = useRefreshRequest(requestId);
  const answer = useMutation({
    mutationFn: (same) => purchaseRequestService.answerYours(item.id, same),
    onSuccess: (_updated, same) => {
      toast.success(same ? `${other.po_number} moved onto ${item.name}.` : "Kept as two separate products.");
      onOpenChange(false);
    },
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });
  const busy = answer.isPending;
  const delivery = deliveryOf(other);

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Is this from your purchase request?"]}
      title="Is this from your purchase request?"
      cancelLabel={null}
      actions={
        <>
          <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => answer.mutate(false)}>
            No, they are different
          </Button>
          <Button type="button" size="lg" disabled={busy} onClick={() => answer.mutate(true)}>
            {busy && <Spinner size="sm" />}
            Yes, same product
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-border p-4" aria-label="New on the S0">
          <h3 className="text-sm font-semibold text-foreground">New on the S0</h3>
          <DetailGrid
            min="8rem"
            items={[
              { label: "Product", value: item.name },
              { label: "Quantity", value: formatAmount(item.quantity, item.unit) },
            ]}
          />
        </section>
        <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Your request">
          <h3 className="text-sm font-semibold text-foreground">Your request</h3>
          <p className="min-w-0 text-[13px] font-medium text-foreground">{other.name}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge label={ITEM_STATUS_LABELS[other.status] || other.status} theme={ITEM_STATUS_THEME[other.status]} />
            <span className="font-mono text-foreground">{other.po_number}</span>
          </div>
          {delivery && <p className="text-xs text-muted-foreground">{delivery}</p>}
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        Yes moves {other.po_number} and its delivery onto the S0 line, and closes the request. Nothing is deleted.
      </p>
    </ModalShell>
  );
}

/** #688 - the "Is this yours?" badge on an S0 line. A button for those who may answer. */
export function YoursBadge({ item, other, requestId, canAnswer }) {
  const [open, setOpen] = useState(false);
  const badge = <StatusBadge label="Is this yours?" theme="amber" />;
  if (!canAnswer || !other) return badge;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Is ${item.name} yours? Compare it with your request`}
        className="h-auto rounded-full p-0 align-middle hover:bg-transparent"
      >
        {badge}
      </Button>
      {open && <YoursDialog open onOpenChange={setOpen} item={item} other={other} requestId={requestId} />}
    </>
  );
}
