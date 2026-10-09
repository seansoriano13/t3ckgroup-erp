import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { REQUEST_UNITS } from "../../constants/procurement";
import { procurementQueueKey } from "./queryKeys";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

const TITLE_MAX = 120;
const UNIT_OPTIONS = REQUEST_UNITS.map((u) => ({ value: u, label: u }));

let nextKey = 0;
const blankItem = () => ({ key: nextKey++, name: "", quantity: "1", unit: REQUEST_UNITS[0], description: "" });

const isItemReady = (item) => item.name.trim() !== "" && Number(item.quantity) > 0;

/**
 * Issue #179 — any employee opens a Direct Purchase Request: no SOR, a title,
 * and the products they need. Purchasing hears and takes it from there.
 * Images and more items can be added on the request once it's open.
 * `onOpened(id)` gets the new request.
 */
export default function NewPurchaseRequestDialog({ open, onOpenChange, onOpened }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [items, setItems] = useState(() => [blankItem()]);

  const setItem = (key, field) => (value) =>
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)));

  const close = () => {
    setTitle("");
    setItems([blankItem()]);
    onOpenChange(false);
  };

  const valid = title.trim() !== "" && items.every(isItemReady);

  const openMutation = useMutation({
    mutationFn: () =>
      purchaseRequestService.openDirect(
        title.trim(),
        items.map((item) => ({ ...item, name: item.name.trim(), description: item.description.trim() })),
      ),
    onSuccess: (id) => {
      toast.success("Purchase Request sent to Purchasing.");
      queryClient.invalidateQueries({ queryKey: procurementQueueKey });
      close();
      onOpened?.(id);
    },
    onError: (error) => toast.error(refusal(error)),
  });
  const busy = openMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>New Purchase Request</DialogTitle>
          <DialogDescription>
            For something to buy outside a project. Purchasing picks it up; you follow it here.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[60vh] space-y-4 overflow-y-auto px-1">
          <FieldBox label="What is it for?" bare>
            <Input
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Printer toner for the 3rd floor"
            />
          </FieldBox>

          {items.map((item, index) => (
            <fieldset key={item.key} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <legend className="text-xs font-semibold text-muted-foreground">Item {index + 1}</legend>
                {items.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
              <FieldBox label="Product" bare>
                <Input
                  value={item.name}
                  onChange={(e) => setItem(item.key, "name")(e.target.value)}
                  placeholder="What do you need?"
                />
              </FieldBox>
              <div className="grid grid-cols-2 gap-3">
                <FieldBox label="Quantity" bare>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={item.quantity}
                    onChange={(e) => setItem(item.key, "quantity")(e.target.value)}
                  />
                </FieldBox>
                <FieldBox label="Unit" bare>
                  <SelectField options={UNIT_OPTIONS} value={item.unit} onChange={setItem(item.key, "unit")} />
                </FieldBox>
              </div>
              <FieldBox label="Details" bare>
                <Textarea
                  value={item.description}
                  onChange={(e) => setItem(item.key, "description")(e.target.value)}
                  rows={2}
                  placeholder="Brand, specs, a link"
                />
              </FieldBox>
            </fieldset>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, blankItem()])}>
            <Plus size={14} />
            Add another item
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={close}>
            Cancel
          </Button>
          <Button size="lg" disabled={!valid || busy} onClick={() => openMutation.mutate()}>
            {busy && <Spinner size="sm" />}
            Send to Purchasing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
