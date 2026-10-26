import { useRef, useState } from "react";
import QueryError from "@/components/ui/QueryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Calculator, ImagePlus, ListPlus, PackagePlus, Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { FileInput } from "@/components/ui/FileInput";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import { AttachmentPreviews } from "@/components/ui/Attachments";
import StatusBadge from "../StatusBadge";
import StaleStockBadge from "./StaleStockBadge";
import AddFromCostingMatrixDialog from "./AddFromCostingMatrixDialog";
import AddCanvassedItemsDialog from "./AddCanvassedItemsDialog";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { useFileAttachments } from "../../hooks/useFileAttachments";
import { REQUEST_UNITS } from "../../constants/procurement";
import { STOCK_BADGE_THEME, isStockStale, stockBadge } from "../../constants/stock";
import { formatDate } from "../../utils/formatDate";
import { formatAmount, isLineRequested } from "../../utils/requestedItem";
import { purchaseRequestKeys } from "./queryKeys";
import { useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/**
 * Picks lines off the SOR's Product List. Each picked line becomes one item,
 * copied as the line is now; the dialog says so, because later SOR edits
 * won't follow it.
 */
export function PickSorLinesDialog({ open, onOpenChange, requestId, opportunityId, items }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshRequest(requestId);
  const [picked, setPicked] = useState(() => new Set());

  const linesQuery = useQuery({
    queryKey: purchaseRequestKeys.pickableLines(requestId),
    queryFn: () => purchaseRequestService.pickableLines(requestId),
    enabled: open,
  });
  const { data: stockSnapshot } = useQuery({
    queryKey: purchaseRequestKeys.stock(requestId),
    queryFn: () => purchaseRequestService.stockSnapshot(requestId),
    enabled: open && !!opportunityId,
  });

  const lines = linesQuery.data || [];
  const toggle = (id, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const close = () => {
    setPicked(new Set());
    onOpenChange(false);
  };

  const addMutation = useMutation({
    mutationFn: async (lineIds) => {
      for (const lineId of lineIds) {
        await purchaseRequestService.addItemFromLine(requestId, lineId);
      }
    },
    onSuccess: (_, lineIds) => {
      toast.success(lineIds.length === 1 ? "Item requested." : `${lineIds.length} items requested.`);
      close();
    },
    onError: (error) => {
      toast.error(refusal(error));
      // A line re-saved since the list loaded has a new id: show the list as it is now.
      setPicked(new Set());
      queryClient.invalidateQueries({ queryKey: purchaseRequestKeys.pickableLines(requestId) });
    },
    // The whole request (the items, and the chat each new item posts in) and its queue row.
    onSettled: refresh,
  });

  const pickedIds = lines.filter((l) => picked.has(l.id)).map((l) => l.id);

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Add from the SOR's Product List"]}
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
        Each item keeps the line as it is now. If the SOR changes later, the item says so.
      </p>

        <p className="text-[11px] text-muted-foreground">
          {stockSnapshot?.fetched_at ? `Stock as of ${formatDate(stockSnapshot.fetched_at)}` : "Stock not yet checked"}
          {isStockStale(stockSnapshot?.fetched_at) && <StaleStockBadge className="ml-2" />}
        </p>

        <div>
          {linesQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : linesQuery.isError ? (
            <QueryError title="Couldn't load the product list." onRetry={linesQuery.refetch} />
          ) : lines.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">This SOR&apos;s Product List is empty.</p>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((line) => {
                const product = line.odoo_product_id ? stockSnapshot?.data?.products?.[line.odoo_product_id] || null : null;
                const badge = stockBadge({ quantity: line.quantity, product, odooProductId: line.odoo_product_id });
                const noQuantity = !(Number(line.quantity) > 0);
                return (
                  <li key={line.id} className="py-2.5">
                    <FieldBox inline className="items-start gap-3">
                      <Checkbox
                        className="mt-0.5"
                        checked={picked.has(line.id)}
                        disabled={noQuantity}
                        onCheckedChange={(on) => toggle(line.id, on)}
                      />
                      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground break-words">
                        {line.product_name}
                      </span>
                    </FieldBox>
                    <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{formatAmount(line.quantity, line.unit)}</span>
                      <StatusBadge label={badge.label} theme={STOCK_BADGE_THEME[badge.kind]} />
                      {isLineRequested(line, items) && <span className="font-medium">Already requested</span>}
                      {noQuantity && <span className="font-medium">No quantity</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
    </ModalShell>
  );
}

const blankProduct = (from = null) => ({
  name: "",
  quantity: from ? String(Number(from.quantity)) : "1",
  unit: from?.unit || "unit",
  description: "",
});

/**
 * A product that isn't in Odoo: name, quantity, unit, description and images.
 *
 * With `substituteFor` (an item), the Buyer's substitute for it (#306): the
 * amount starts at the original's, and saving cancels the original
 * and keeps the link.
 */
export function NewProductDialog({ open, onOpenChange, requestId, substituteFor = null }) {
  const refresh = useRefreshRequest(requestId);
  const [product, setProduct] = useState(() => blankProduct(substituteFor));
  const attachments = useFileAttachments();
  const fileRef = useRef(null);
  const set = (key) => (value) => setProduct((prev) => ({ ...prev, [key]: value }));

  const addImages = (files) => {
    const list = Array.from(files || []);
    const images = list.filter((f) => f.type?.startsWith("image/"));
    if (images.length < list.length) toast.error("Only images can be attached to a new product.");
    if (images.length) attachments.addFiles(images);
  };

  const close = () => {
    setProduct(blankProduct(substituteFor));
    attachments.clear();
    onOpenChange(false);
  };

  const quantity = Number(product.quantity);
  const valid = product.name.trim() && quantity > 0;

  const addMutation = useMutation({
    mutationFn: async () => {
      const fields = {
        name: product.name.trim(),
        quantity,
        unit: product.unit,
        description: product.description.trim(),
        images: await attachments.upload(),
      };
      return substituteFor
        ? purchaseRequestService.addSubstitute(substituteFor.id, fields)
        : purchaseRequestService.addNewItem(requestId, fields);
    },
    onSuccess: () => {
      toast.success(substituteFor ? "Substitute offered." : "New product requested.");
      refresh();
      close();
    },
    onError: (error) => toast.error(refusal(error)),
  });

  const busy = addMutation.isPending || attachments.isUploading;

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", substituteFor ? "Offer a substitute" : "Request a new product"]}
      actions={
        <Button size="lg" disabled={!valid || busy} onClick={() => addMutation.mutate()}>
          {busy && <Spinner size="sm" />}
          {substituteFor ? "Offer substitute" : "Request it"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {substituteFor
          ? `For ${substituteFor.name}. It is cancelled and stays linked, so sales can re-price.`
          : "For a product that isn't in Odoo. Describe it so Purchasing can source it."}
      </p>

        <div
          className="space-y-3"
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (!files.length) return;
            e.preventDefault();
            addImages(files);
          }}
        >
          <FieldBox bare label="Product name">
            <Input
              value={product.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="What does the client need?"
            />
          </FieldBox>
          <div className="grid grid-cols-2 gap-3">
            <FieldBox bare label="Quantity">
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={product.quantity}
                onChange={(e) => set("quantity")(e.target.value)}
              />
            </FieldBox>
            <FieldBox bare label="Unit">
              <SelectField
                options={REQUEST_UNITS.map((u) => ({ value: u, label: u }))}
                value={product.unit}
                onChange={set("unit")}
              />
            </FieldBox>
          </div>
          <FieldBox bare label="Description">
            <Textarea
              value={product.description}
              onChange={(e) => set("description")(e.target.value)}
              rows={3}
              placeholder="Specs, brand, the wording the client used"
            />
          </FieldBox>

          <div className="space-y-2">
            {attachments.files.length > 0 && (
              <AttachmentPreviews files={attachments.files} onRemove={attachments.removeFile} disabled={busy} />
            )}
            <FileInput ref={fileRef} multiple accept="image/*" onFiles={addImages} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || attachments.files.length >= attachments.max}
              onClick={() => fileRef.current?.open()}
            >
              <ImagePlus size={14} />
              Add images
            </Button>
            <p className="text-[11px] text-muted-foreground">Up to {attachments.max}. You can paste a screenshot.</p>
          </div>
        </div>
    </ModalShell>
  );
}

/**
 * Issue #305 — adding Requested Items to a Purchase Request: picked from the
 * SOR's Product List, or a new product. Shown only to whoever may add (the
 * request's sales side or its Buyer; the database checks again on save).
 *
 * #273: anyone with Purchasing access also gets "Add from the Costing Matrix",
 * which picks the SOR's Components. That button is theirs alone; the other two
 * stay with whoever may add.
 *
 * Self-contained, for the request view to mount (#308): `request` needs `id`
 * and `opportunity_id`; `items` are the request's items, so the picker can say
 * which lines are already requested.
 */
export default function AddRequestedItems({ request, items = [] }) {
  const [dialog, setDialog] = useState(null);
  const requestId = request?.id;

  const { data: canAdd } = useQuery({
    queryKey: purchaseRequestKeys.canAddItems(requestId),
    queryFn: () => purchaseRequestService.canAddItems(requestId),
    enabled: !!requestId,
  });
  const { data: purchasing } = useQuery({
    queryKey: purchaseRequestKeys.hasPurchasing,
    queryFn: () => purchaseRequestService.hasPurchasingAccess(),
    enabled: !!requestId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const fromMatrix = purchasing === true && !!request?.opportunity_id;
  const fromCanvass = canAdd && purchasing === true;
  if (!canAdd && !fromMatrix) return null;

  const openAs = (name) => (open) => setDialog(open ? name : null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canAdd && request.opportunity_id && (
        <Button type="button" variant="outline" size="sm" onClick={() => setDialog("line")}>
          <ListPlus size={14} />
          Add from the SOR
        </Button>
      )}
      {fromMatrix && (
        <Button type="button" variant="outline" size="sm" onClick={() => setDialog("matrix")}>
          <Calculator size={14} />
          Add from the Costing Matrix
        </Button>
      )}
      {fromCanvass && (
        <Button type="button" variant="outline" size="sm" onClick={() => setDialog("canvass")}>
          <Scale size={14} />
          Add a Canvass
        </Button>
      )}
      {canAdd && (
        <Button type="button" variant="outline" size="sm" onClick={() => setDialog("new")}>
          <PackagePlus size={14} />
          New product
        </Button>
      )}

      {canAdd && request.opportunity_id && (
        <PickSorLinesDialog
          open={dialog === "line"}
          onOpenChange={openAs("line")}
          requestId={requestId}
          opportunityId={request.opportunity_id}
          items={items}
        />
      )}
      {fromMatrix && (
        <AddFromCostingMatrixDialog
          open={dialog === "matrix"}
          onOpenChange={openAs("matrix")}
          requestId={requestId}
          opportunityId={request.opportunity_id}
          items={items}
        />
      )}
      {fromCanvass && (
        <AddCanvassedItemsDialog open={dialog === "canvass"} onOpenChange={openAs("canvass")} requestId={requestId} items={items} />
      )}
      {canAdd && <NewProductDialog open={dialog === "new"} onOpenChange={openAs("new")} requestId={requestId} />}
    </div>
  );
}
