import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ImagePlus, PackagePlus, Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { FileInput } from "@/components/ui/FileInput";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import { AttachmentPreviews } from "@/components/ui/Attachments";
import AddCanvassedItemsDialog from "./AddCanvassedItemsDialog";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { useFileAttachments } from "../../hooks/useFileAttachments";
import { REQUEST_UNITS } from "../../constants/procurement";
import { purchaseRequestKeys } from "./queryKeys";
import { useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

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
      toast.success(substituteFor ? "Substitute offered." : "Added under Other requests.");
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
 * Issue #305 / #678 — adding to a Purchase Request. The S0's products are on the request by
 * themselves, so what is added here is an Other request: a new product in Sales' own words, or a
 * Canvass (Purchasing). Shown only to whoever may add (the request's sales side or its Buyer; the
 * database checks again on save).
 *
 * Self-contained, for the request view to mount (#308): `request` needs `id`; `items` are the
 * request's items, so the Canvass dialog can say which are taken.
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

  const fromCanvass = canAdd && purchasing === true;
  if (!canAdd) return null;

  const openAs = (name) => (open) => setDialog(open ? name : null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {fromCanvass && (
        <Button type="button" variant="outline" size="sm" onClick={() => setDialog("canvass")}>
          <Scale size={14} />
          Add a Canvass
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => setDialog("new")}>
        <PackagePlus size={14} />
        New product
      </Button>

      {fromCanvass && (
        <AddCanvassedItemsDialog open={dialog === "canvass"} onOpenChange={openAs("canvass")} requestId={requestId} items={items} />
      )}
      <NewProductDialog open={dialog === "new"} onOpenChange={openAs("new")} requestId={requestId} />
    </div>
  );
}
