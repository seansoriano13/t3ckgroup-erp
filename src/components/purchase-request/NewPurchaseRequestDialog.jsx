import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { REQUEST_UNITS } from "../../constants/procurement";
import { ipasService } from "../../services/ipasService";
import { ipasSorSearchKey } from "../ipas/ipasKeys";
import { procurementQueueKey } from "./queryKeys";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

const TITLE_MAX = 120;
const UNIT_OPTIONS = REQUEST_UNITS.map((u) => ({ value: u, label: u }));

let nextKey = 0;
const blankItem = () => ({ key: nextKey++, name: "", quantity: "1", unit: REQUEST_UNITS[0], description: "" });

const isItemReady = (item) => item.name.trim() !== "" && Number(item.quantity) > 0;

const sorLabel = (sor) =>
  [sor.sor_code, sor.sales_reference, sor.project_title].filter(Boolean).join(" · ");

/**
 * #689: the optional "for a project" field. Search an SOR by number or project, pick
 * one, or leave it empty. `value` is the picked SOR (or null).
 */
function ProjectField({ value, onChange }) {
  const [term, setTerm] = useState("");
  const search = term.trim();
  const { data: results = [], isError } = useQuery({
    queryKey: ipasSorSearchKey(search),
    queryFn: () => ipasService.searchSors(search),
    enabled: !value && search.length >= 2,
    staleTime: 30_000,
  });
  return (
    <div className="space-y-1.5">
      {value ? (
        <FieldBox bare label="For a project (optional)">
          <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-[13px]">
            <span className="min-w-0 truncate">{sorLabel(value)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              aria-label="Remove the project"
              onClick={() => onChange(null)}
            >
              <X size={12} />
            </Button>
          </div>
        </FieldBox>
      ) : (
        <>
          <FieldBox bare label="For a project (optional)">
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="SOR number, SO number or project"
            />
          </FieldBox>
          {search.length >= 2 && (
            <ul className="space-y-1">
              {results.map((sor) => (
                <li key={sor.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-muted/40">
                  <span className="min-w-0 truncate">{sorLabel(sor)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="ml-auto"
                    onClick={() => {
                      onChange(sor);
                      setTerm("");
                    }}
                  >
                    Pick
                  </Button>
                </li>
              ))}
              {isError && <li className="px-2.5 text-xs text-destructive">SORs could not be searched. Try again.</li>}
            </ul>
          )}
        </>
      )}
      <p className="pl-1 text-xs text-muted-foreground">
        Shows on that SOR as a Direct request for this project. It is not added to the project&apos;s products.
      </p>
    </div>
  );
}

/**
 * Issue #179 — any employee opens a Direct Purchase Request: no SOR, a title,
 * and the products they need. Purchasing hears and takes it from there.
 * Images and more items can be added on the request once it's open.
 * `onOpened(id)` gets the new request.
 */
export default function NewPurchaseRequestDialog({ open, onOpenChange, onOpened }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [project, setProject] = useState(null);
  const [items, setItems] = useState(() => [blankItem()]);

  const setItem = (key, field) => (value) =>
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)));

  const close = () => {
    setTitle("");
    setProject(null);
    setItems([blankItem()]);
    onOpenChange(false);
  };

  const valid = title.trim() !== "" && items.every(isItemReady);

  const openMutation = useMutation({
    mutationFn: () =>
      purchaseRequestService.openDirect(
        title.trim(),
        items.map((item) => ({ ...item, name: item.name.trim(), description: item.description.trim() })),
        project?.id ?? null,
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
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      crumbs={["Purchase Requests", "New Purchase Request"]}
      actions={
        <Button size="lg" disabled={!valid || busy} onClick={() => openMutation.mutate()}>
          {busy && <Spinner size="sm" />}
          Send to Purchasing
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        For something to buy outside a project. Purchasing picks it up; you follow it here.
      </p>
      <div className="space-y-4">
          <FieldBox bare label="What is it for?">
            <Input
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Printer toner for the 3rd floor"
            />
          </FieldBox>

          <ProjectField value={project} onChange={setProject} />

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
              <FieldBox bare label="Product">
                <Input
                  value={item.name}
                  onChange={(e) => setItem(item.key, "name")(e.target.value)}
                  placeholder="What do you need?"
                />
              </FieldBox>
              <div className="grid grid-cols-2 gap-3">
                <FieldBox bare label="Quantity">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={item.quantity}
                    onChange={(e) => setItem(item.key, "quantity")(e.target.value)}
                  />
                </FieldBox>
                <FieldBox bare label="Unit">
                  <SelectField options={UNIT_OPTIONS} value={item.unit} onChange={setItem(item.key, "unit")} />
                </FieldBox>
              </div>
              <FieldBox bare label="Details">
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
    </ModalShell>
  );
}
