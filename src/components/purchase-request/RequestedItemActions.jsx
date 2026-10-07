import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChevronDown, Replace } from "lucide-react";

import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dropdown from "@/components/ui/Dropdown";
import Spinner from "@/components/ui/Spinner";
import { NewProductDialog } from "./AddRequestedItems";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import {
  ITEM_STATUS,
  ITEM_STATUS_LABELS,
  MEMBER_SIDE,
  allowedTransitions,
  isClosedStatus,
} from "../../constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/** Ways out end the item for good, so they ask first. */
const CONFIRM = {
  [ITEM_STATUS.CANCELLED]: {
    title: "Cancel this item?",
    description: "Purchasing stops working on it. A cancelled item can't be reopened; request it again if it's needed.",
    confirmLabel: "Cancel item",
  },
  [ITEM_STATUS.CANNOT_SOURCE]: {
    title: "Mark as Cannot source?",
    description: "Sales will know to re-price or drop it. This closes the item.",
    confirmLabel: "Cannot source",
  },
  [ITEM_STATUS.SUBSTITUTED]: {
    title: "Mark as Substituted?",
    description: "This closes the item. To say what replaces it, offer a substitute instead.",
    confirmLabel: "Mark Substituted",
  },
};

const WAYS_OUT = [ITEM_STATUS.SUBSTITUTED, ITEM_STATUS.CANNOT_SOURCE, ITEM_STATUS.CANCELLED];

function MenuItem({ children, onClick, tone }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={`h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold ${
        tone === "destructive" ? "text-destructive hover:text-destructive" : "text-foreground"
      }`}
    >
      {children}
    </Button>
  );
}

/**
 * Issue #306 — what the signed-in member may do to one Requested Item, for
 * RequestedItems' row action slot.
 *
 * `actor` is `purchaseRequestService.itemActor`'s answer (`{ side,
 * canSubstitute }`). Purchasing gets a menu of the next steps on the path and
 * the ways out (and, for the Buyer, "Offer a substitute"); the sales side gets
 * only Cancel; anyone else gets nothing. The database checks every move again.
 */
export default function RequestedItemActions({ item, request, actor }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(null);
  const [substituting, setSubstituting] = useState(false);
  const requestId = request?.id;

  const moveMutation = useMutation({
    mutationFn: (status) => purchaseRequestService.setItemStatus(item.id, status),
    onSuccess: (_, status) => toast.success(`${item.name}: ${ITEM_STATUS_LABELS[status]}.`),
    onError: (error) => toast.error(refusal(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: purchaseRequestKeys.all(requestId) }),
  });

  const side = actor?.side ?? null;
  const next = allowedTransitions(item.status, side);
  const canSubstitute = !!actor?.canSubstitute && !isClosedStatus(item.status);
  if (next.length === 0 && !canSubstitute) return null;

  const choose = (status) => (CONFIRM[status] ? setConfirming(status) : moveMutation.mutate(status));
  const busy = moveMutation.isPending;

  const confirm = confirming && CONFIRM[confirming];
  const dialogs = (
    <>
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        cancelLabel="Keep it"
        tone="destructive"
        onConfirm={() => moveMutation.mutate(confirming)}
      />
      {canSubstitute && substituting && (
        <NewProductDialog
          open
          onOpenChange={(open) => !open && setSubstituting(false)}
          requestId={requestId}
          substituteFor={item}
        />
      )}
    </>
  );

  // The sales side may only cancel: one plain button, no menu.
  if (side === MEMBER_SIDE.SALES) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => choose(ITEM_STATUS.CANCELLED)}
          aria-label={`Cancel ${item.name}`}
        >
          {busy && <Spinner size="sm" />}
          Cancel
        </Button>
        {dialogs}
      </>
    );
  }

  const onPath = next.filter((s) => !WAYS_OUT.includes(s));
  const waysOut = next.filter((s) => WAYS_OUT.includes(s));

  return (
    <>
      <Dropdown
        usePortal
        placement="bottom-end"
        matchTriggerWidth={false}
        disabled={busy}
        trigger={
          <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`Change status of ${item.name}`}>
            {busy && <Spinner size="sm" />}
            Status
            <ChevronDown size={12} />
          </Button>
        }
      >
        {({ close }) => (
          <div className="flex min-w-[180px] flex-col">
            {onPath.map((status) => (
              <MenuItem
                key={status}
                onClick={() => {
                  close();
                  choose(status);
                }}
              >
                {ITEM_STATUS_LABELS[status]}
              </MenuItem>
            ))}
            {onPath.length > 0 && (waysOut.length > 0 || canSubstitute) && <div className="my-1 h-px bg-border" />}
            {canSubstitute && (
              <MenuItem
                onClick={() => {
                  close();
                  setSubstituting(true);
                }}
              >
                <Replace size={14} />
                Offer a substitute…
              </MenuItem>
            )}
            {waysOut.map((status) => (
              <MenuItem
                key={status}
                tone={status === ITEM_STATUS.CANCELLED ? "destructive" : undefined}
                onClick={() => {
                  close();
                  choose(status);
                }}
              >
                {ITEM_STATUS_LABELS[status]}
              </MenuItem>
            ))}
          </div>
        )}
      </Dropdown>
      {dialogs}
    </>
  );
}
