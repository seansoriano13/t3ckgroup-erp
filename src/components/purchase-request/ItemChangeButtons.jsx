import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ModalShell from "@/components/ui/ModalShell";
import Spinner from "@/components/ui/Spinner";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { useRequestUnits } from "../../hooks/useRequestUnits";
import { changeLock, isChangeableItem } from "../../utils/requestedItem";
import { ProductRow } from "./AddRequestedItems";
import { purchaseRequestKeys } from "./queryKeys";
import { refusal, useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The form's starting values: the product as it is now. */
const fromItem = (item) => ({
  key: `edit-${item.id}`,
  name: item.name,
  odooProductId: item.odoo_product_id ?? null,
  quantity: String(item.quantity),
  unit: item.unit ?? "",
  description: item.description ?? "",
  purpose: item.purpose ?? "client",
  initialImages: item.images ?? [],
});

/** Edit one added product, in the same form it was asked for with. */
function EditProductDialog({ open, onOpenChange, item, requestId }) {
  const refresh = useRefreshRequest(requestId);
  const [product, setProduct] = useState(() => fromItem(item));
  const { options: unitOptions, defaultUnit } = useRequestUnits(item.unit);
  const uploaders = useRef(new Map());

  const save = useMutation({
    mutationFn: async () => {
      const images = (await uploaders.current.get(product.key)?.upload()) ?? [];
      return purchaseRequestService.editItem(item.id, {
        name: product.name.trim(),
        quantity: Number(product.quantity),
        // A product saved with no unit keeps none unless one is picked.
        unit: product.unit || (item.unit == null ? null : defaultUnit),
        description: product.description.trim(),
        images,
        purpose: product.purpose,
        odooProductId: product.odooProductId,
      });
    },
    onSuccess: (changed) => {
      toast.success(changed ? "Saved. The Chat says what changed." : "Nothing changed.");
      refresh();
      onOpenChange(false);
    },
    onError: (error) => toast.error(refusal(error)),
  });
  const busy = save.isPending;
  const filled = product.name.trim() && Number(product.quantity) > 0;

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Edit product"]}
      actions={
        <Button disabled={!filled || busy} onClick={() => save.mutate()}>
          {busy && <Spinner size="sm" />}
          Save
        </Button>
      }
    >
      <ProductRow
        product={product}
        index={0}
        count={1}
        onChange={setProduct}
        onRemove={() => {}}
        uploaders={uploaders}
        unitOptions={unitOptions}
        defaultUnit={defaultUnit}
        busy={busy}
      />
    </ModalShell>
  );
}

/**
 * Edit and Remove under an opened Other request, for anyone who may add to the request (the same
 * rule, purchase_request_can_add_items). Off, with the reason on hover, once a P0 is attached.
 * Each change posts its own Chat line; a removed product leaves the list but stays on record.
 */
export default function ItemChangeButtons({ item, request }) {
  const requestId = request?.id;
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const refresh = useRefreshRequest(requestId);
  const changeable = isChangeableItem(item);

  const { data: canChange } = useQuery({
    queryKey: purchaseRequestKeys.canAddItems(requestId),
    queryFn: () => purchaseRequestService.canAddItems(requestId),
    enabled: !!requestId && changeable,
  });

  const remove = useMutation({
    mutationFn: () => purchaseRequestService.removeItem(item.id),
    onSuccess: () => {
      toast.success(`${item.name} removed. The Chat keeps a line about it.`);
      setRemoving(false);
      refresh();
    },
    onError: (error) => toast.error(refusal(error)),
  });

  if (!changeable || !canChange) return null;
  const lock = changeLock(item);

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Change ${item.name}`}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={!!lock}
        title={lock ?? undefined}
        onClick={() => setEditing(true)}
      >
        <Pencil size={12} aria-hidden="true" />
        Edit
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={!!lock || remove.isPending}
        title={lock ?? undefined}
        onClick={() => setRemoving(true)}
      >
        <Trash2 size={12} aria-hidden="true" />
        Remove
      </Button>
      {editing && <EditProductDialog open onOpenChange={setEditing} item={item} requestId={requestId} />}
      <ConfirmDialog
        open={removing}
        onOpenChange={(open) => !open && setRemoving(false)}
        title={`Remove ${item.name}?`}
        description="It comes off this request. The Chat keeps a line saying who removed it."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        tone="destructive"
        className={OVER_REQUEST_MODAL}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
