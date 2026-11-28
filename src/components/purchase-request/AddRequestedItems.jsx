import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ImagePlus, PackagePlus, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { FileInput } from "@/components/ui/FileInput";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import { AttachmentPreviews } from "@/components/ui/Attachments";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { useFileAttachments } from "../../hooks/useFileAttachments";
import { REQUEST_PURPOSES } from "../../constants/procurement";
import { useRequestUnits } from "../../hooks/useRequestUnits";
import { purchaseRequestKeys } from "./queryKeys";
import { useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";
import OdooProductField from "./OdooProductField";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/** The database takes at most this many in one go. */
const MAX_PRODUCTS = 50;

let nextKey = 0;
const blankProduct = () => ({
  key: `product-${(nextKey += 1)}`,
  name: "",
  // Set when the product is picked from Odoo's list; typing afterwards drops it (as Replace does, #687).
  odooProductId: null,
  quantity: "1",
  // Empty until someone picks one; empty means the list's first unit (see useRequestUnits).
  unit: "",
  description: "",
  purpose: "client",
});

const isFilled = (product) => product.name.trim() && Number(product.quantity) > 0;

/**
 * One product on the form: picked from Odoo or typed, with its quantity, unit, what it is for,
 * a description and images. The images stay here until the form is sent; `uploaders` lets the
 * form upload every product's images at once. `product.initialImages` are photos it already has
 * (Edit), shown at once and kept as they are unless taken off.
 */
export function ProductRow({ product, index, count, onChange, onRemove, uploaders, unitOptions, defaultUnit, busy }) {
  const attachments = useFileAttachments({ initial: product.initialImages });
  const fileRef = useRef(null);
  const set = (key) => (value) => onChange({ ...product, [key]: value });
  const label = count > 1 ? `Product ${index + 1}` : null;

  // The form reads the latest attachments when it sends; dropped again when the row is removed.
  useEffect(() => {
    uploaders.current.set(product.key, attachments);
  });
  useEffect(() => {
    const registry = uploaders.current;
    return () => registry.delete(product.key);
  }, [uploaders, product.key]);

  const addImages = (files) => {
    const list = Array.from(files || []);
    const images = list.filter((f) => f.type?.startsWith("image/"));
    if (images.length < list.length) toast.error("Only images can be attached to a product.");
    if (images.length) attachments.addFiles(images);
  };

  return (
    <fieldset
      aria-label={label ?? "Product"}
      className={count > 1 ? "space-y-3 rounded-lg border border-border p-3" : "space-y-3"}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files || []);
        if (!files.length) return;
        e.preventDefault();
        addImages(files);
      }}
    >
      {label && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">{label}</span>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemove} aria-label={`Remove ${label}`}>
            <Trash2 size={14} aria-hidden="true" />
            Remove
          </Button>
        </div>
      )}
      <FieldBox bare required label="What do you need?">
        <OdooProductField
          label="What do you need?"
          value={product.name}
          onTyped={(typed) => onChange({ ...product, name: typed, odooProductId: null })}
          onPicked={(picked) => onChange({ ...product, name: picked.name, odooProductId: picked.id })}
          placeholder="Search Odoo, or type it in your own words"
        />
      </FieldBox>
      {product.odooProductId && <p className="-mt-2 pl-1 text-label text-muted-foreground">From Odoo</p>}
      <div className="grid grid-cols-2 gap-3">
        <FieldBox bare required label="Quantity">
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
          <SelectField options={unitOptions} value={product.unit || defaultUnit} onChange={set("unit")} />
        </FieldBox>
      </div>
      <FieldBox bare label="What is it for?">
        <SelectField options={REQUEST_PURPOSES} value={product.purpose} onChange={set("purpose")} />
      </FieldBox>
      <FieldBox bare label="Description">
        <Textarea
          value={product.description}
          onChange={(e) => set("description")(e.target.value)}
          rows={count > 1 ? 2 : 3}
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
        <p className="text-label text-muted-foreground">Up to {attachments.max}. You can paste a screenshot.</p>
      </div>
    </fieldset>
  );
}

/**
 * Ask for products: one or more, each picked from Odoo or typed in the asker's own words. All are
 * sent in one database call, so they are all added or none are; each gets its own Chat line.
 */
export function NewProductDialog({ open, onOpenChange, requestId }) {
  const refresh = useRefreshRequest(requestId);
  const [products, setProducts] = useState(() => [blankProduct()]);
  const { options: unitOptions, defaultUnit } = useRequestUnits();
  const uploaders = useRef(new Map());

  const close = () => {
    uploaders.current.forEach((attachments) => attachments.clear());
    setProducts([blankProduct()]);
    onOpenChange(false);
  };

  const update = (key) => (next) => setProducts((prev) => prev.map((p) => (p.key === key ? next : p)));
  const remove = (key) => () => setProducts((prev) => prev.filter((p) => p.key !== key));
  const valid = products.length > 0 && products.every(isFilled);

  const addMutation = useMutation({
    mutationFn: async () => {
      const items = await Promise.all(
        products.map(async (product) => ({
          name: product.name.trim(),
          quantity: Number(product.quantity),
          unit: product.unit || defaultUnit,
          description: product.description.trim(),
          images: (await uploaders.current.get(product.key)?.upload()) ?? [],
          purpose: product.purpose,
          odooProductId: product.odooProductId,
        })),
      );
      return purchaseRequestService.addItems(requestId, items);
    },
    onSuccess: (ids) => {
      toast.success(ids?.length > 1 ? `${ids.length} products added under Other requests.` : "Added under Other requests.");
      refresh();
      close();
    },
    onError: (error) => toast.error(refusal(error)),
  });

  const busy = addMutation.isPending;

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Ask for a product"]}
      actions={
        <Button disabled={!valid || busy} onClick={() => addMutation.mutate()}>
          {busy && <Spinner size="sm" />}
          {products.length > 1 ? `Send ${products.length} requests` : "Send request"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Pick a product from Odoo, or tell us what you need in your own words. Each one shows under Other requests as Not checked.
      </p>

      <div className="space-y-3">
        {products.map((product, index) => (
          <ProductRow
            key={product.key}
            product={product}
            index={index}
            count={products.length}
            onChange={update(product.key)}
            onRemove={remove(product.key)}
            uploaders={uploaders}
            unitOptions={unitOptions}
            defaultUnit={defaultUnit}
            busy={busy}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || products.length >= MAX_PRODUCTS}
          onClick={() => setProducts((prev) => [...prev, blankProduct()])}
        >
          <Plus size={14} aria-hidden="true" />
          Add another product
        </Button>
      </div>
    </ModalShell>
  );
}

/**
 * Issue #305 / #678 — adding to a Purchase Request. The S0's products are on the request by
 * themselves, so what is added here is an Other request: products picked from Odoo or typed in
 * Sales' own words, one or several at a time (a Canvass is never added; it starts on the line,
 * ADR 0047). Shown only to whoever may add (anyone in the request, since 2026-11-28; the database
 * checks again on save, and each product's Chat line records who added it).
 *
 * Self-contained, for the request view to mount (#308): `request` needs `id`.
 */
export default function AddRequestedItems({ request }) {
  const [dialog, setDialog] = useState(null);
  const requestId = request?.id;

  const { data: canAdd } = useQuery({
    queryKey: purchaseRequestKeys.canAddItems(requestId),
    queryFn: () => purchaseRequestService.canAddItems(requestId),
    enabled: !!requestId,
  });
  if (!canAdd) return null;

  const openAs = (name) => (open) => setDialog(open ? name : null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setDialog("new")}>
        <PackagePlus size={14} />
        Ask for a product
      </Button>

      <NewProductDialog open={dialog === "new"} onOpenChange={openAs("new")} requestId={requestId} />
    </div>
  );
}
