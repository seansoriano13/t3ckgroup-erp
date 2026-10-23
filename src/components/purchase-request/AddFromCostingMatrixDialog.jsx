import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import QueryError from "@/components/ui/QueryError";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "../StatusBadge";
import { costingKeys } from "../costing/costingKeys";
import { useCostingMatrix } from "../costing/useCostingMatrix";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { STATUS_THEME } from "../../constants/statusTheme";
import { componentPickList, formatAmount } from "../../utils/requestedItem";
import { useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/**
 * "Add from the Costing Matrix" (#273): Purchasing picks Components of the SOR's matrix and each
 * becomes a Requested Item. The ones marked For Order start ticked; the rest can be ticked too.
 * Each item copies the Component's name, quantity, unit and Odoo product id and keeps its own
 * copy, so editing the Component later does not rewrite it. The same Component may be requested
 * again (a split order); the list says how many items already name it.
 */
export default function AddFromCostingMatrixDialog({ open, onOpenChange, requestId, opportunityId, items }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshRequest(requestId);
  // null = untouched, so the For Order Components are the pick; once the user ticks anything it is theirs.
  const [touched, setTouched] = useState(null);

  const matrixQuery = useCostingMatrix(open ? opportunityId : null);
  const matrix = matrixQuery.data;
  const components = componentPickList(matrix?.tenderLines, items);
  const picked = touched ?? new Set(components.filter((c) => c.forOrder).map((c) => c.id));

  const toggle = (id, on) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setTouched(next);
  };

  const close = () => {
    setTouched(null);
    onOpenChange(false);
  };

  const addMutation = useMutation({
    mutationFn: (componentIds) => purchaseRequestService.addItemsFromComponents(requestId, componentIds),
    onSuccess: (_, componentIds) => {
      toast.success(componentIds.length === 1 ? "Item requested." : `${componentIds.length} items requested.`);
      queryClient.invalidateQueries({ queryKey: costingKeys.all(opportunityId) });
      close();
    },
    onError: (error) => {
      toast.error(refusal(error));
      // A Component removed since the list loaded: show the matrix as it is now.
      setTouched(null);
      queryClient.invalidateQueries({ queryKey: costingKeys.matrix(opportunityId) });
    },
    onSettled: refresh,
  });

  const pickedIds = components.filter((c) => picked.has(c.id)).map((c) => c.id);

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Add from the Costing Matrix"]}
      actions={
        <Button
          size="lg"
          disabled={pickedIds.length === 0 || addMutation.isPending}
          onClick={() => addMutation.mutate(pickedIds)}
        >
          {addMutation.isPending && <Spinner size="sm" />}
          {pickedIds.length > 1 ? `Request ${pickedIds.length} items` : "Request item"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Components marked For Order are ticked. Each item keeps the Component as it is now. If the Component changes
        later, the item does not.
      </p>
      <div>
          {matrixQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : matrixQuery.isError ? (
            <QueryError title="Couldn't load the Costing Matrix." onRetry={matrixQuery.refetch} />
          ) : !matrix ? (
            <p className="py-10 text-center text-sm text-muted-foreground">This SOR has no Costing Matrix yet.</p>
          ) : components.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">The Costing Matrix has no Components yet.</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="component-picker">
              {components.map((component) => (
                <li key={component.id} className="py-2.5" data-testid="component-pick">
                  <FieldBox inline className="items-start gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={picked.has(component.id)}
                      onCheckedChange={(on) => toggle(component.id, Boolean(on))}
                    />
                    <span className="min-w-0 flex-1 text-sm font-semibold text-foreground break-words">
                      <span className="tabular-nums text-muted-foreground">{component.number}</span>{" "}
                      {component.name}
                    </span>
                  </FieldBox>
                  <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{formatAmount(component.quantity, component.unit)}</span>
                    {component.forOrder && <StatusBadge label="For Order" theme={STATUS_THEME.AMBER} />}
                    {component.bundle && <span className="font-medium">Bundle</span>}
                    {component.requested > 0 && (
                      <span className="font-medium">
                        {component.requested === 1 ? "Already requested" : `Already requested ${component.requested} times`}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </ModalShell>
  );
}
