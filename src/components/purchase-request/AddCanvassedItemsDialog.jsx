import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import ModalShell from "@/components/ui/ModalShell";
import { SelectField } from "@/components/ui/SelectField";
import Spinner from "@/components/ui/Spinner";
import QueryError from "@/components/ui/QueryError";
import { Button } from "@/components/ui/button";
import { warningToast } from "@/components/ui/CustomToast";
import { canvassService } from "../../services/canvassService";
import { CANVASS_KIND, CANVASS_LIST_KEY } from "../../constants/canvass";
import { CANVASS_ATTACHABLE_STATUSES } from "../../constants/purchaseRequest";
import { REQUEST_UNITS } from "../../constants/procurement";
import { refusal, useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

const NEW_ITEM = "__new__";

/** The Canvasses that can still be added to a request: no subject yet, and a winner. */
const addableCanvasses = (rows = []) => rows.filter((row) => row.kind === CANVASS_KIND.NONE && row.winner);

const winnerLabel = (winner) => [winner?.supplierName, winner?.brand].filter(Boolean).join(" · ") || "Winner picked";

/**
 * Adds Canvasses that already exist to this Purchase Request (`canvass_add_to_purchase_request`).
 * Each ticked Canvass either becomes a new Requested Item (with a quantity and unit) or is attached
 * to an item the request already has that has no Canvass yet. Either way the winner's price goes on
 * the item and the Canvass locks. `items` are the request's items, so the picker can offer the ones
 * still open and not yet canvassed.
 */
export default function AddCanvassedItemsDialog({ open, onOpenChange, requestId, items = [] }) {
  const refresh = useRefreshRequest(requestId);
  // canvass id -> { target, quantity, unit } for each ticked Canvass
  const [picked, setPicked] = useState({});

  const listQuery = useQuery({
    queryKey: CANVASS_LIST_KEY,
    queryFn: () => canvassService.list(),
    enabled: open,
  });
  const rows = addableCanvasses(listQuery.data);
  const attachable = items.filter((item) => !item.canvass && CANVASS_ATTACHABLE_STATUSES.includes(item.status));

  const close = () => {
    setPicked({});
    onOpenChange(false);
  };

  const toggle = (id, on) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (on) next[id] = { target: NEW_ITEM, quantity: "1", unit: "unit" };
      else delete next[id];
      return next;
    });
  const patch = (id, change) => setPicked((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }));

  const chosen = rows.filter((row) => picked[row.id]);
  const takenItems = new Set(chosen.map((row) => picked[row.id].target).filter((t) => t !== NEW_ITEM));
  const valid = chosen.length > 0 && chosen.every((row) => picked[row.id].target !== NEW_ITEM || Number(picked[row.id].quantity) > 0);

  const addMutation = useMutation({
    mutationFn: () =>
      canvassService.addToPurchaseRequest(
        requestId,
        chosen.map((row) => {
          const { target, quantity, unit } = picked[row.id];
          return target === NEW_ITEM ? { canvassId: row.id, quantity, unit } : { canvassId: row.id, itemId: target };
        }),
      ),
    onSuccess: (made) => {
      toast.success(chosen.length === 1 ? "Canvass added." : `${chosen.length} Canvasses added.`);
      const numbers = chosen.filter((row) => made.unsignedCanvassIds.includes(row.id)).map((row) => row.number);
      if (numbers.length > 0) warningToast(`Not signed off yet: ${numbers.join(", ")}.`);
      close();
    },
    onError: (error) => toast.error(refusal(error)),
    // The request's items and queue row, and the Canvasses (each one is locked now).
    onSettled: refresh,
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      expandable
      crumbs={["Purchase Requests", "Add a Canvass"]}
      actions={
        <Button size="lg" disabled={!valid || addMutation.isPending} onClick={() => addMutation.mutate()}>
          {addMutation.isPending && <Spinner size="sm" />}
          {chosen.length > 1 ? `Add ${chosen.length} Canvasses` : "Add Canvass"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Pick Canvasses you already did. Each one becomes a Requested Item, or goes onto an item this request already has.
        The winner&apos;s price goes on the item, and the Canvass is locked.
      </p>

      {listQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : listQuery.isError ? (
        <QueryError title="Couldn't load the Canvasses." onRetry={listQuery.refetch} />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="no-addable-canvasses">
          No Canvass is ready. A Canvass needs a winner and no request yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const state = picked[row.id];
            const options = [
              { value: NEW_ITEM, label: "A new item" },
              ...attachable
                .filter((item) => item.id === state?.target || !takenItems.has(item.id))
                .map((item) => ({ value: item.id, label: `On ${item.name}` })),
            ];
            return (
              <li key={row.id} className="space-y-2 py-3" data-testid="addable-canvass">
                <FieldBox inline className="items-start gap-3">
                  <Checkbox className="mt-0.5" checked={Boolean(state)} onCheckedChange={(on) => toggle(row.id, Boolean(on))} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">
                      {row.number} · {row.productName || row.subjectName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {winnerLabel(row.winner)} · {row.offerCount} offer{row.offerCount === 1 ? "" : "s"} ·{" "}
                      {row.signedOffAt ? "Signed off" : "Not signed off"}
                    </span>
                  </span>
                </FieldBox>
                {state && (
                  <div className="grid grid-cols-1 gap-3 pl-7 sm:grid-cols-[1fr_6rem_7rem]">
                    <SelectField
                      aria-label={`Where ${row.number} goes`}
                      options={options}
                      value={state.target}
                      onChange={(next) => patch(row.id, { target: next || NEW_ITEM })}
                    />
                    {state.target === NEW_ITEM && (
                      <>
                        <Input
                          aria-label={`Quantity for ${row.number}`}
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={state.quantity}
                          onChange={(e) => patch(row.id, { quantity: e.target.value })}
                        />
                        <SelectField
                          aria-label={`Unit for ${row.number}`}
                          options={REQUEST_UNITS.map((u) => ({ value: u, label: u }))}
                          value={state.unit}
                          onChange={(next) => patch(row.id, { unit: next })}
                        />
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ModalShell>
  );
}
