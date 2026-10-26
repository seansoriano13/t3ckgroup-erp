import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import Spinner from "@/components/ui/Spinner";
import { warningToast } from "@/components/ui/CustomToast";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import {
  PO_NUMBER_HINT,
  PO_VERIFICATION,
  PO_VERIFICATION_LABELS,
  isValidPoNumber,
  normalizePoNumber,
} from "../../constants/procurement";
import { useRefreshRequest } from "./requestHooks";
import { useItemStatusUndo } from "./useItemStatusUndo";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/**
 * Tells the buyer how their PO number was checked (#548): a success toast, or,
 * when Odoo didn't answer, a warning that the PO was saved without being checked.
 */
function toastPoVerdict(message, updated) {
  if (updated?.po_verification === PO_VERIFICATION.PENDING) {
    warningToast(`${message} Saved without being checked.`);
  } else toast.success(message);
}

/**
 * Issue #312 — setting an item Purchased, with its PO number if there is one.
 * The number is checked against Odoo on save and stored with the answer; an
 * item can be Purchased without one.
 */
export function OrderItemDialog({ open, onOpenChange, item, requestId }) {
  const refresh = useRefreshRequest(requestId);
  const announce = useItemStatusUndo(requestId);
  const [poNumber, setPoNumber] = useState("");
  const po = normalizePoNumber(poNumber);
  const invalid = !!po && !isValidPoNumber(po);

  const close = () => {
    setPoNumber("");
    onOpenChange(false);
  };

  const orderMutation = useMutation({
    mutationFn: () => purchaseRequestService.orderItem(item.id, { poNumber: po }),
    // The item as it was, for Undo to say what it goes back to.
    onMutate: () => ({ before: item }),
    onSuccess: (updated, _, { before }) => {
      const checked = updated?.po_number
        ? ` PO ${updated.po_number}: ${PO_VERIFICATION_LABELS[updated.po_verification] || updated.po_verification}.`
        : "";
      const pending = updated?.po_verification === PO_VERIFICATION.PENDING;
      announce(before, updated, `${item.name}: Purchased.${checked}${pending ? " Saved without being checked." : ""}`, {
        variant: pending ? "warning" : "success",
      });
      close();
    },
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });
  const busy = orderMutation.isPending;

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Mark as Purchased"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid && !busy) orderMutation.mutate();
      }}
      actions={
        <Button size="lg" type="submit" disabled={invalid || busy}>
          {busy && <Spinner size="sm" />}
          {po ? "Check PO and mark Purchased" : "Mark Purchased"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">{item.name}. Add the Odoo PO number if you have it; it&apos;s checked against Odoo.</p>
      <div className="space-y-1.5">
        <FieldBox label="PO number (optional)" bare>
          <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="P01234" autoFocus />
        </FieldBox>
        <p className={`pl-1 text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
          {invalid ? PO_NUMBER_HINT : "Without one, the item is Purchased with no PO."}
        </p>
      </div>
    </ModalShell>
  );
}

/**
 * Issue #549 — correcting the PO number on an Purchased item. The new number is
 * checked against Odoo like the first; PO lines picked on the old PO are cleared.
 */
export function CorrectPoDialog({ open, onOpenChange, item, requestId }) {
  const refresh = useRefreshRequest(requestId);
  const [poNumber, setPoNumber] = useState("");
  const po = normalizePoNumber(poNumber);
  const invalid = !po || !isValidPoNumber(po);

  const close = () => {
    setPoNumber("");
    onOpenChange(false);
  };

  const correctMutation = useMutation({
    mutationFn: () => purchaseRequestService.correctPo(item.id, po),
    onSuccess: (updated) => {
      toastPoVerdict(
        `${item.name}: PO ${updated?.po_number}: ${PO_VERIFICATION_LABELS[updated?.po_verification] || updated?.po_verification}.`,
        updated,
      );
      close();
    },
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });
  const busy = correctMutation.isPending;

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Correct PO"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid && !busy) correctMutation.mutate();
      }}
      actions={
        <Button size="lg" type="submit" disabled={invalid || busy}>
          {busy && <Spinner size="sm" />}
          Check PO and correct
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {item.name}{item.po_number ? `, now on PO ${item.po_number}` : ", with no PO yet"}. The new number is checked against Odoo, and any PO line picked on the old PO is cleared.
      </p>
      <div className="space-y-1.5">
        <FieldBox label="New PO number" bare>
          <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="P01234" autoFocus />
        </FieldBox>
        <p className={`pl-1 text-xs ${poNumber && invalid ? "text-destructive" : "text-muted-foreground"}`}>
          {PO_NUMBER_HINT}
        </p>
      </div>
    </ModalShell>
  );
}

/**
 * Issue #312 — picking the Odoo PO line(s) an Purchased item is bought on, from
 * the lines its PO has on the IPAS stored Odoo copy (`lineIds`). The caller
 * only offers this when there are lines; the database refuses any other.
 */
export function PickPoLinesDialog({ open, onOpenChange, item, requestId, lineIds }) {
  const refresh = useRefreshRequest(requestId);
  const [picked, setPicked] = useState(() => new Set(item.odoo_po_line_ids || []));

  const toggle = (id, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const pickMutation = useMutation({
    mutationFn: (ids) => purchaseRequestService.pickPoLines(item.id, ids),
    onSuccess: () => {
      toast.success(`${item.name}: PO line picked.`);
      onOpenChange(false);
    },
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });

  const pickedIds = lineIds.filter((id) => picked.has(id));

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Pick the PO line"]}
      actions={
        <Button
          size="lg"
          disabled={pickedIds.length === 0 || pickMutation.isPending}
          onClick={() => pickMutation.mutate(pickedIds)}
        >
          {pickMutation.isPending && <Spinner size="sm" />}
          {pickedIds.length > 1 ? `Pick ${pickedIds.length} lines` : "Pick line"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {item.name}, on PO {item.po_number}. The lines are from the PO&apos;s IPAS copy of Odoo.
      </p>
      <ul className="divide-y divide-border">
          {lineIds.map((id) => (
            <li key={id} className="py-2.5">
              <FieldBox inline className="gap-3">
                <Checkbox checked={picked.has(id)} onCheckedChange={(on) => toggle(id, on)} />
                <span className="text-sm font-semibold text-foreground">PO line {id}</span>
              </FieldBox>
            </li>
          ))}
      </ul>
    </ModalShell>
  );
}
