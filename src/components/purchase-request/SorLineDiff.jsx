import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import ModalShell from "@/components/ui/ModalShell";
import Spinner from "@/components/ui/Spinner";
import DetailGrid from "@/components/record/DetailGrid";
import { Textarea } from "@/components/ui/textarea";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { ITEM_STATUS, isClosedStatus } from "../../constants/purchaseRequest";
import { SOR_LINE_CHANGE, formatAmount } from "../../utils/requestedItem";
import { purchaseRequestKeys } from "./queryKeys";
import { refusal, useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

const UNIT_NONE = "no unit";

/** A quantity and a unit, with the part that moved bold (and, on the "asked" side, struck through). */
function Amount({ quantity, unit, quantityMoved, unitMoved, struck = false }) {
  const moved = struck ? "text-muted-foreground line-through" : "font-bold text-foreground";
  return (
    <span>
      <span className={quantityMoved ? moved : undefined}>{String(quantity)}</span>{" "}
      <span className={unitMoved ? moved : undefined}>{unit || UNIT_NONE}</span>
    </span>
  );
}

/**
 * What was asked beside what the SOR says now, as the record's own fields
 * (DetailGrid, no table inside a record). Only the part that moved is marked,
 * and the old value stays visible struck through, so a reader never has to
 * remember it. Not colour alone: the moved part is bold, the old one struck.
 */
function ChangeFields({ change }) {
  const { asked, quantityChanged, unitChanged } = change;
  return (
    <DetailGrid
      min="9rem"
      className="max-w-md"
      items={[
        {
          label: "Asked",
          value: (
            <Amount quantity={asked.quantity} unit={asked.unit} quantityMoved={quantityChanged} unitMoved={unitChanged} struck />
          ),
        },
        {
          label: "SOR now",
          value: (
            <Amount quantity={change.quantity} unit={change.unit} quantityMoved={quantityChanged} unitMoved={unitChanged} />
          ),
        },
      ]}
    />
  );
}

/**
 * Confirms "Update to SOR": the same before and after, the reason a PO
 * already placed asks for, and a note when a Canvass was done on the old quantity.
 */
function FollowSorDialog({ open, onOpenChange, item, change }) {
  const refresh = useRefreshRequest(item.request_id);
  const [reason, setReason] = useState("");
  const ordered = item.status === ITEM_STATUS.PURCHASED;

  const close = () => {
    setReason("");
    onOpenChange(false);
  };

  const update = useMutation({
    mutationFn: () => purchaseRequestService.updateItemFromSor(item.id, reason.trim() || null),
    onSuccess: () => {
      toast.success("Item updated to the SOR.");
      refresh();
      close();
    },
    onError: (error) => toast.error(refusal(error)),
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Update to the SOR"]}
      title={`Update ${item.name} to the SOR?`}
      actions={
        <Button size="lg" disabled={update.isPending || (ordered && !reason.trim())} onClick={() => update.mutate()}>
          {update.isPending && <Spinner size="sm" />}
          Update item
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {item.name} will say {formatAmount(change.quantity, change.unit)} instead of{" "}
          {formatAmount(change.asked.quantity, change.asked.unit)}. The request chat will show the change.
        </p>
        <ChangeFields change={change} />
        {item.canvass && change.quantityChanged && (
          <p className="text-sm font-medium text-amber-11">
            Quantity changed since the Canvass. Its prices are per unit and stay as they are, so check they still fit.
          </p>
        )}
        {ordered && (
          <FieldBox bare label="Why follow the SOR now?">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="This item is already ordered. Say what changed."
            />
          </FieldBox>
        )}
      </div>
    </ModalShell>
  );
}

/**
 * The SOR line an item was picked from, when it no longer says what was asked.
 * A changed line shows the Asked / SOR now table with two ways forward: update
 * the item, or keep it as asked. A removed line cannot be followed; the item
 * keeps what was asked. Only whoever may add items gets the buttons, and a
 * closed item gets none, since it keeps what was asked.
 */
export default function SorLineDiff({ item, change }) {
  const [dialog, setDialog] = useState(false);
  const refresh = useRefreshRequest(item.request_id);
  const { data: canAdd } = useQuery({
    queryKey: purchaseRequestKeys.canAddItems(item.request_id),
    queryFn: () => purchaseRequestService.canAddItems(item.request_id),
    enabled: !!item.request_id,
  });

  const keep = useMutation({
    mutationFn: () => purchaseRequestService.keepItemAsAsked(item.id),
    onSuccess: () => {
      toast.success("Kept as asked.");
      refresh();
    },
    onError: (error) => toast.error(refusal(error)),
  });

  const removed = change.kind === SOR_LINE_CHANGE.REMOVED;
  const acts = canAdd === true && !isClosedStatus(item.status) && !removed;

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 font-medium text-amber-11">
        <AlertTriangle size={14} className="shrink-0" />
        {change.label}
      </span>
      {removed ? (
        <p className="text-sm text-muted-foreground">
          The SOR no longer has this line. The item keeps what was asked: {formatAmount(item.quantity, item.unit)}.
        </p>
      ) : (
        <ChangeFields change={change} />
      )}
      {acts && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setDialog(true)}>
            Update to SOR
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={keep.isPending} onClick={() => keep.mutate()}>
            Keep as asked
          </Button>
        </div>
      )}
      {acts && <FollowSorDialog open={dialog} onOpenChange={setDialog} item={item} change={change} />}
    </div>
  );
}
