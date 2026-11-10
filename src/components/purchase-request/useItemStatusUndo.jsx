import toast from "react-hot-toast";

import { CustomToast } from "@/components/ui/CustomToast";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { ITEM_STATUS_LABELS } from "../../constants/purchaseRequest";
import { refusal, useRefreshRequest } from "./requestHooks";

/** How long the Undo button stays. The database allows a little longer, for a slow click. */
export const UNDO_MS = 10_000;

/**
 * After a Requested Item's status changes: a toast saying so, with an Undo
 * button for ten seconds. Undo puts the item back to the status it had
 * (`purchaseRequestService.undoItemStatus`); it reverses that one change only.
 *
 * Returns `announce(item, updated, message, { variant })`: `item` as it was
 * before the change, `updated` as the database returned it (without its
 * `status_changed_at` there is no Undo). `variant` is the
 * toast's look (`success`, or `warning` for an Ordered PO Odoo didn't check).
 */
export function useItemStatusUndo(requestId) {
  const refresh = useRefreshRequest(requestId);

  const undo = async (item, updated) => {
    try {
      await purchaseRequestService.undoItemStatus(item.id, updated.status_changed_at);
      toast.success(`${item.name}: back to ${ITEM_STATUS_LABELS[item.status] || item.status}.`);
    } catch (error) {
      toast.error(refusal(error));
    } finally {
      refresh();
    }
  };

  return (item, updated, message, { variant = "success" } = {}) => {
    const undoable = !!updated?.status_changed_at;
    toast.custom(
      (t) => (
        <CustomToast
          t={undoable ? { ...t, action: { label: `Undo: back to ${ITEM_STATUS_LABELS[item.status] || item.status}`, onClick: () => undo(item, updated) } } : t}
          variant={variant}
          description={message}
        />
      ),
      { duration: UNDO_MS, id: `item-status-${item.id}` },
    );
  };
}
