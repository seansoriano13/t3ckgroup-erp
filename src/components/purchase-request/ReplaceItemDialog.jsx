import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { PO_NUMBER_HINT, isValidPoNumber, normalizePoNumber } from "../../constants/procurement";
import { useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/**
 * #687 - Purchasing replaces a product with another. Name the new product, optionally give its
 * P0, and say why (required). The old line is Cancelled with "Replaced by B - reason", its open
 * Canvass stops, and B joins Other requests with the same quantity. An S0 line keeps warning
 * "S0 still lists A" until Sales updates the S0.
 */
export default function ReplaceItemDialog({ open, onOpenChange, item, requestId }) {
  const refresh = useRefreshRequest(requestId);
  const [name, setName] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [reason, setReason] = useState("");
  const po = normalizePoNumber(poNumber);
  const poInvalid = !!po && !isValidPoNumber(po);
  const valid = name.trim() && reason.trim() && !poInvalid;

  const close = () => {
    setName("");
    setPoNumber("");
    setReason("");
    onOpenChange(false);
  };

  const replaceMutation = useMutation({
    mutationFn: async () => {
      const newId = await purchaseRequestService.replaceItem(item.id, { name: name.trim(), reason: reason.trim() });
      // B follows its own P0. The replacement is already saved, so a P0 Odoo refuses is reported
      // on its own and B stays at Not checked for Purchasing to attach again.
      if (po) {
        try {
          await purchaseRequestService.attachP0(newId, po);
        } catch (error) {
          return { newId, poError: refusal(error) };
        }
      }
      return { newId };
    },
    onSuccess: ({ poError }) => {
      toast.success(`${item.name} replaced.`);
      if (poError) toast.error(`The P0 was not attached: ${poError}`);
      refresh();
      close();
    },
    onError: (error) => toast.error(refusal(error)),
  });
  const busy = replaceMutation.isPending;

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Replace a product"]}
      actions={
        <Button size="lg" disabled={!valid || busy} onClick={() => replaceMutation.mutate()}>
          {busy && <Spinner size="sm" />}
          Replace product
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {`${item.name} is cancelled and its Canvass stops. The new product joins Other requests with the same quantity.`}
        {item.sor_item_id && !item.removed_from_s0 ? " The S0 still lists the old product until Sales updates it." : ""}
      </p>
      <div className="space-y-3">
        <FieldBox bare label="Replace with">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="The product bought instead" />
        </FieldBox>
        <FieldBox bare label="P0 for the new product (optional)">
          <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="P01234" />
          {poInvalid && <p className="mt-1 text-xs text-destructive">{PO_NUMBER_HINT}</p>}
        </FieldBox>
        <FieldBox bare label="Reason">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why it is being replaced, in a few words"
          />
        </FieldBox>
      </div>
    </ModalShell>
  );
}
