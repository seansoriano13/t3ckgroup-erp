import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import Spinner from "@/components/ui/Spinner";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import {
  PO_NUMBER_HINT,
  PO_VERIFICATION,
  PO_VERIFICATION_LABELS,
  isValidPoNumber,
  normalizePoNumber,
} from "../../constants/procurement";
import { useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/**
 * Issue #312 — setting an item Ordered, with its PO number if there is one.
 * The number is checked against Odoo on save and stored with the answer; an
 * item can be Ordered without one.
 */
export function OrderItemDialog({ open, onOpenChange, item, requestId }) {
  const refresh = useRefreshRequest(requestId);
  const [poNumber, setPoNumber] = useState("");
  const po = normalizePoNumber(poNumber);
  const invalid = !!po && !isValidPoNumber(po);

  const close = () => {
    setPoNumber("");
    onOpenChange(false);
  };

  const orderMutation = useMutation({
    mutationFn: () => purchaseRequestService.orderItem(item.id, { poNumber: po }),
    onSuccess: (updated) => {
      const checked = updated?.po_number
        ? ` PO ${updated.po_number}: ${PO_VERIFICATION_LABELS[updated.po_verification] || updated.po_verification}.`
        : "";
      const message = `${item.name}: Ordered.${checked}`;
      // Odoo didn't answer (#548): the PO is saved, but not checked.
      if (updated?.po_verification === PO_VERIFICATION.PENDING) {
        toast(`${message} Warning: saved without being checked.`, { icon: "⚠️", duration: 8000 });
      } else toast.success(message);
      close();
    },
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });
  const busy = orderMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className={`${OVER_REQUEST_MODAL} sm:max-w-md`}>
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>Mark as Ordered</DialogTitle>
          <DialogDescription>{item.name}. Add the Odoo PO number if you have it; it&apos;s checked against Odoo.</DialogDescription>
        </DialogHeader>

        <form
          id={`order-item-${item.id}`}
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid && !busy) orderMutation.mutate();
          }}
        >
          <FieldBox label="PO number (optional)" bare>
            <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="P01234" autoFocus />
          </FieldBox>
          <p className={`pl-1 text-[11px] ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
            {invalid ? PO_NUMBER_HINT : "Without one, the item is Ordered with no PO."}
          </p>
        </form>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={close}>
            Cancel
          </Button>
          <Button size="lg" type="submit" form={`order-item-${item.id}`} disabled={invalid || busy}>
            {busy && <Spinner size="sm" />}
            {po ? "Check PO and mark Ordered" : "Mark Ordered"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Issue #312 — picking the Odoo PO line(s) an Ordered item is bought on, from
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${OVER_REQUEST_MODAL} sm:max-w-md`}>
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>Pick the PO line</DialogTitle>
          <DialogDescription>
            {item.name}, on PO {item.po_number}. The lines are from the PO&apos;s IPAS copy of Odoo.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
          {lineIds.map((id) => (
            <li key={id} className="py-2.5">
              <FieldBox inline className="gap-3">
                <Checkbox checked={picked.has(id)} onCheckedChange={(on) => toggle(id, on)} />
                <span className="text-sm font-semibold text-foreground">PO line {id}</span>
              </FieldBox>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="lg"
            disabled={pickedIds.length === 0 || pickMutation.isPending}
            onClick={() => pickMutation.mutate(pickedIds)}
          >
            {pickMutation.isPending && <Spinner size="sm" />}
            {pickedIds.length > 1 ? `Pick ${pickedIds.length} lines` : "Pick line"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
