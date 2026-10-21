import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import ModalShell from "./ui/ModalShell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { canvassService } from "../services/canvassService";
import { CANVASS_LIST_KEY } from "../constants/canvass";

/**
 * Creates one Purchase Request from Canvasses with no subject yet (ADR 0034): one Requested Item
 * for each, filled from its winner. `canvasses` is `[{ id, number, winner, signedOffAt }]`. Every
 * one needs a winner; one not signed off is allowed, with a warning. Used by the Canvasses page for
 * the picked rows and by the Canvass panel for the one it is showing.
 */
export default function CreatePurchaseRequestModal({ open, onOpenChange, canvasses, onCreated }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const noWinner = canvasses.filter((c) => !c.winner);
  const unsigned = canvasses.filter((c) => !c.signedOffAt);

  const create = useMutation({
    mutationFn: () => canvassService.createPurchaseRequest({ title, items: canvasses.map((c) => ({ canvassId: c.id })) }),
    onSuccess: (made) => {
      toast.success("Purchase Request created.");
      const numbers = canvasses.filter((c) => made.unsignedCanvassIds.includes(c.id)).map((c) => c.number);
      if (numbers.length > 0) toast.warning(`Not signed off yet: ${numbers.join(", ")}.`);
      setTitle("");
      queryClient.invalidateQueries({ queryKey: CANVASS_LIST_KEY });
      queryClient.invalidateQueries({ queryKey: ["canvass"] });
      onCreated?.(made);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Canvass", "Create Purchase Request"]}
      actions={
        <Button type="button" size="lg" disabled={create.isPending || !title.trim() || noWinner.length > 0} onClick={() => create.mutate()}>
          Create request
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        One request with one Requested Item for each of the {canvasses.length} Canvass{canvasses.length === 1 ? "" : "es"}, filled from its winner.
      </p>
      <Input aria-label="Purchase Request title" placeholder="Title of the request" value={title} onChange={(e) => setTitle(e.target.value)} />
      {noWinner.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          No winner yet: {noWinner.map((c) => c.number).join(", ")}. Pick a winner first.
        </p>
      )}
      {unsigned.length > 0 && (
        <p role="status" className="text-sm text-amber-600">
          Not signed off yet: {unsigned.map((c) => c.number).join(", ")}. You can still create the request.
        </p>
      )}
    </ModalShell>
  );
}
