import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { CustomToast } from "@/components/ui/CustomToast";
import { FieldBox } from "@/components/ui/FieldBox";
import { Textarea } from "@/components/ui/textarea";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { ITEM_STATUS, ITEM_STATUS_LABELS, bulkStatuses } from "../../constants/purchaseRequest";
import { shortStockOf } from "../../utils/requestedItem";
import { refusal, useRefreshRequest } from "./requestHooks";
import { UNDO_MS } from "./useItemStatusUndo";
import { OVER_REQUEST_MODAL } from "./stacking";

const WAYS_OUT = [ITEM_STATUS.CANNOT_SOURCE, ITEM_STATUS.CANCELLED];

const plural = (n) => `${n} ${n === 1 ? "line" : "lines"}`;

/**
 * #852 (spec #844, decision 7): the bar over the product list while lines are ticked. It offers
 * only the statuses valid for every ticked line. Cancelled and Cannot source ask for one reason,
 * applied to every line (so does Available when a ticked line is short on stock). The batch is one
 * database call, so it makes one notification per recipient and one Undo.
 *
 * `items` are the ticked lines as they now stand; `side` is the member's side of the request.
 */
export default function BulkStatusBar({ requestId, items, side, stockSnapshot, onClear }) {
  const refresh = useRefreshRequest(requestId);
  const [asking, setAsking] = useState(null);
  const [reason, setReason] = useState("");
  const statuses = bulkStatuses(items, side);
  const anyShort = items.some((item) => shortStockOf(item, stockSnapshot));

  const undo = async (before, updated) => {
    try {
      await purchaseRequestService.undoItemsStatus(
        updated.map((item) => ({ item_id: item.id, changed_at: item.status_changed_at })),
      );
      toast.success(`${plural(before.length)} back to how they were.`);
    } catch (error) {
      toast.error(refusal(error));
    } finally {
      refresh();
    }
  };

  const mutation = useMutation({
    mutationFn: ({ status, why }) => purchaseRequestService.setItemsStatus(items.map((i) => i.id), status, why),
    onSuccess: (updated, { status }) => {
      const before = items;
      const undoable = updated.length > 0 && updated.every((item) => item.status_changed_at);
      toast.custom(
        (t) => (
          <CustomToast
            t={undoable ? { ...t, action: { label: "Undo", onClick: () => undo(before, updated) } } : t}
            variant="success"
            description={`${plural(updated.length)}: ${ITEM_STATUS_LABELS[status]}.`}
          />
        ),
        { duration: UNDO_MS, id: `bulk-status-${requestId}` },
      );
      setAsking(null);
      setReason("");
      onClear();
    },
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });

  if (items.length === 0) return null;

  const choose = (status) => {
    if (WAYS_OUT.includes(status) || (status === ITEM_STATUS.AVAILABLE && anyShort)) setAsking(status);
    else mutation.mutate({ status, why: null });
  };
  const closeAsk = () => {
    setAsking(null);
    setReason("");
  };
  const isWayOut = WAYS_OUT.includes(asking);

  return (
    <div
      role="region"
      aria-label="Change many lines"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm"
    >
      <span className="text-[13px] font-semibold text-foreground">{items.length} selected</span>
      {statuses.length === 0 ? (
        <span className="text-xs text-muted-foreground">No status fits all of them.</span>
      ) : (
        statuses.map((status) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => choose(status)}
          >
            {ITEM_STATUS_LABELS[status]}
          </Button>
        ))
      )}
      <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear
      </Button>
      <ConfirmDialog
        open={!!asking}
        onOpenChange={(open) => !open && closeAsk()}
        title={isWayOut ? `${ITEM_STATUS_LABELS[asking]}: ${plural(items.length)}?` : "Available on short stock"}
        description={
          isWayOut
            ? "Say why. The same reason is kept in the request history for every line."
            : "Some of these lines have less free stock than they need. Say why they are Available anyway. The reason is kept in the request history."
        }
        confirmLabel={isWayOut ? (asking === ITEM_STATUS.CANCELLED ? "Cancel lines" : "Cannot source") : "Mark Available"}
        cancelLabel="Keep them"
        tone={isWayOut ? "destructive" : "default"}
        confirmDisabled={!reason.trim() || mutation.isPending}
        className={OVER_REQUEST_MODAL}
        onConfirm={() => mutation.mutate({ status: asking, why: reason.trim() })}
      >
        <FieldBox bare label="Reason">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={200}
            placeholder="Why, in a few words"
          />
        </FieldBox>
      </ConfirmDialog>
    </div>
  );
}
