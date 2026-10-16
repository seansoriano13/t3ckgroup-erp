import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Save, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import { transmittalService } from "@/services/transmittalService";
import { ipasService } from "@/services/ipasService";
import { companyService } from "@/services/companyService";
import {
  TRANSMITTAL_LINE_KIND,
  TRANSMITTAL_ORIGIN,
  TRANSMITTAL_ORIGIN_LABELS,
  TRANSMITTAL_PRIORITIES,
  TRANSMITTAL_PRIORITY_LABELS,
  TRANSMITTAL_OPTION_LIST,
} from "@/constants/transmittals";
import { companyOptions, matchCompany, pickedLineLabel } from "@/utils/transmittals";
import PoLinePicker from "./PoLinePicker";
import { transmittalKeys } from "./transmittalKeys";
import { ipasErrorMessage } from "../../utils/ipas";

const ORIGIN_OPTIONS = Object.values(TRANSMITTAL_ORIGIN).map((value) => ({
  value,
  label: TRANSMITTAL_ORIGIN_LABELS[value],
}));
const PRIORITY_OPTIONS = TRANSMITTAL_PRIORITIES.map((value) => ({
  value,
  label: TRANSMITTAL_PRIORITY_LABELS[value],
}));
const NO_SOR = "__none__";
const NO_LOCATION = "__none__";

let lineCounter = 0;
const nextLineKey = () => `line-${++lineCounter}`;

/** A saved Transmittal's header as the form holds it. */
function headerFrom(existing, defaultOrigin = "") {
  return {
    origin: existing?.origin ?? defaultOrigin,
    originOther: existing?.originOther ?? "",
    checkWarehouse: existing ? existing.checkWarehouse : true,
    checkTechnical: existing ? existing.checkTechnical : false,
    checkOther: existing?.checkOther ?? "",
    priority: existing?.priority ?? "",
    entity: existing?.entity ?? "",
    productOther: existing?.productOther ?? "",
    itemLocationId: existing?.itemLocation?.id ?? null,
  };
}

function lineFrom(line) {
  return {
    key: nextLineKey(),
    kind: line.kind,
    ipasId: line.ipasId,
    ipasNumber: line.ipasNumber,
    poNumber: line.poNumber,
    odooPoLineId: line.odooPoLineId,
    description: line.description ?? "",
    unit: line.unit ?? "",
    quantity: String(line.quantity ?? ""),
    sorId: line.sor?.id ?? null,
    sorOptions: line.sor ? [{ id: line.sor.id, label: line.sor.salesReference }] : [],
    serialNumbers: line.serialNumbers ?? "",
    boxQuantity: line.boxQuantity ?? "",
  };
}

/** A PO line picked from an IPAS: its name and unit are the Odoo ones, and its SORs the choices. */
function poLineFromPick(pick) {
  return {
    key: nextLineKey(),
    kind: TRANSMITTAL_LINE_KIND.PO_LINE,
    ipasId: pick.ipasId,
    ipasNumber: pick.ipasNumber,
    poNumber: pick.poNumber,
    odooPoLineId: pick.odooPoLineId,
    description: pick.productName ?? "",
    unit: pick.unit ?? "",
    quantity: pick.quantity == null ? "" : String(pick.quantity),
    sorId: pick.sors.length === 1 ? pick.sors[0].id : null,
    sorOptions: pick.sors.map((s) => ({ id: s.id, label: s.sales_reference })),
    serialNumbers: "",
    boxQuantity: "",
  };
}

function typedLine() {
  return {
    key: nextLineKey(),
    kind: TRANSMITTAL_LINE_KIND.TYPED,
    ipasId: null,
    ipasNumber: null,
    poNumber: null,
    odooPoLineId: null,
    description: "",
    unit: "",
    quantity: "",
    sorId: null,
    sorOptions: [],
    serialNumbers: "",
    boxQuantity: "",
  };
}

/**
 * A Transmittal's header, products, references and lines (#252). Creates a
 * draft, or replaces an existing draft (`existing`). "Save draft" keeps it a
 * draft; "Submit" saves and submits it, which fixes it and opens the first
 * stage. The database refuses anything the screen lets through.
 */
export default function TransmittalForm({ existing = null, defaultOrigin = "", onSaved, onCancel }) {
  const queryClient = useQueryClient();
  const [header, setHeader] = useState(() => headerFrom(existing, defaultOrigin));
  const [productIds, setProductIds] = useState(() => existing?.products.map((p) => p.id) ?? []);
  const [referenceIds, setReferenceIds] = useState(() => existing?.references.map((r) => r.id) ?? []);
  const [lines, setLines] = useState(() => (existing ? existing.lines.map(lineFrom) : []));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: options = [] } = useQuery({
    queryKey: transmittalKeys.options,
    queryFn: () => ipasService.listOptions(null, { includeInactive: false }),
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: () => companyService.getCompanies(),
  });
  const companyNames = companies.map((c) => c.name);
  const productOptions = options.filter((o) => o.list === TRANSMITTAL_OPTION_LIST.PRODUCT);
  const referenceOptions = options.filter((o) => o.list === TRANSMITTAL_OPTION_LIST.REFERENCE);
  const locationOptions = [
    { value: NO_LOCATION, label: "Not set" },
    ...options.filter((o) => o.list === "item_location").map((o) => ({ value: o.id, label: o.label })),
  ];

  const setField = (field) => (value) => setHeader((prev) => ({ ...prev, [field]: value }));
  const toggleId = (setter) => (id, on) =>
    setter((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  const updateLine = (key, patch) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key) => setLines((prev) => prev.filter((line) => line.key !== key));

  const addPickedLine = (pick) => {
    setLines((prev) => [...prev, poLineFromPick(pick)]);
    setHeader((prev) => (prev.entity ? prev : { ...prev, entity: matchCompany(companyNames, pick.entity) }));
  };

  const linesPayload = lines.map((line) => ({
    kind: line.kind,
    ipasId: line.ipasId,
    odooPoLineId: line.odooPoLineId,
    description: line.description,
    unit: line.unit,
    quantity: line.quantity === "" ? null : Number(line.quantity),
    opportunityId: line.sorId,
    serialNumbers: line.serialNumbers,
    boxQuantity: line.boxQuantity,
  }));

  const save = async ({ submit }) => {
    setBusy(true);
    try {
      const payload = {
        header: {
          ...header,
          itemLocationId: header.itemLocationId === NO_LOCATION ? null : header.itemLocationId,
        },
        productIds,
        referenceIds,
        lines: linesPayload,
      };
      const saved = existing
        ? await transmittalService.updateDraft(existing.id, payload)
        : await transmittalService.create(payload);
      if (submit) await transmittalService.submit(saved.id);

      (saved.warnings ?? []).forEach((w) =>
        toast(`${w.po_number} is on a different Company (${w.entity}). The slip is still raised.`, { icon: "⚠️" }),
      );
      toast.success(submit ? `${saved.number} submitted.` : `${saved.number} saved as a draft.`);
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      onSaved?.(saved.id);
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The Transmittal could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    lines.length > 0 &&
    header.origin !== "" &&
    header.priority !== "" &&
    (header.checkWarehouse || header.checkTechnical) &&
    header.entity.trim() !== "" &&
    lines.every((l) => Number(l.quantity) > 0 && (l.kind === TRANSMITTAL_LINE_KIND.PO_LINE || (l.description.trim() && l.unit.trim())));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-sm font-semibold">Header</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FieldBox label="Origin" bare>
            <SelectField options={ORIGIN_OPTIONS} value={header.origin} onChange={setField("origin")} placeholder="Pick" />
          </FieldBox>
          {header.origin === TRANSMITTAL_ORIGIN.OTHER && (
            <FieldBox label="Origin · Others" bare>
              <Input value={header.originOther} onChange={(e) => setField("originOther")(e.target.value)} />
            </FieldBox>
          )}
          <FieldBox label="Priority" bare>
            <SelectField options={PRIORITY_OPTIONS} value={header.priority} onChange={setField("priority")} placeholder="Pick" />
          </FieldBox>
          <FieldBox label="Company" bare>
            <SelectField
              options={companyOptions(companyNames, header.entity)}
              value={header.entity}
              onChange={setField("entity")}
              placeholder="Defaults from the first PO line"
            />
          </FieldBox>
          <FieldBox label="Item Location" bare>
            <SelectField
              options={locationOptions}
              value={header.itemLocationId ?? NO_LOCATION}
              onChange={(v) => setField("itemLocationId")(v === NO_LOCATION ? null : v)}
            />
          </FieldBox>
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-medium">Checking</p>
          <div className="flex flex-wrap items-center gap-4 text-[13px]">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={header.checkWarehouse}
                onCheckedChange={(v) => setField("checkWarehouse")(Boolean(v))}
                aria-label="Checking · Warehouse"
              />
              <span>Warehouse</span>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={header.checkTechnical}
                onCheckedChange={(v) => setField("checkTechnical")(Boolean(v))}
                aria-label="Checking · TCA Technical"
              />
              <span>TCA Technical</span>
            </div>
            <Input
              className="w-56"
              value={header.checkOther}
              onChange={(e) => setField("checkOther")(e.target.value)}
              placeholder="Others"
            />
          </div>
          {!header.checkWarehouse && !header.checkTechnical && (
            <p className="text-[12px] text-muted-foreground">Tick Warehouse or TCA Technical to submit.</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-[13px] font-medium">Product</p>
            {productOptions.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={productIds.includes(o.id)}
                  onCheckedChange={(v) => toggleId(setProductIds)(o.id, Boolean(v))}
                  aria-label={`Product · ${o.label}`}
                />
                <span>{o.label}</span>
              </div>
            ))}
            <Input
              value={header.productOther}
              onChange={(e) => setField("productOther")(e.target.value)}
              placeholder="Others"
            />
          </div>
          <div className="space-y-2">
            <p className="text-[13px] font-medium">Reference Checklist</p>
            {referenceOptions.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={referenceIds.includes(o.id)}
                  onCheckedChange={(v) => toggleId(setReferenceIds)(o.id, Boolean(v))}
                  aria-label={`Reference · ${o.label}`}
                />
                <span>{o.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Lines</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)} className="gap-1.5">
              <Plus size={14} />
              PO line
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLines((prev) => [...prev, typedLine()])}
              className="gap-1.5"
            >
              <Plus size={14} />
              Typed line
            </Button>
          </div>
        </div>

        {lines.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-[13px] text-muted-foreground">
            No lines yet. Add a PO line from an IPAS, or a typed line for anything not on a PO.
          </p>
        )}

        {lines.map((line, index) => (
          <div key={line.key} className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <p className="text-[12px] text-muted-foreground">
                {index + 1}. {line.kind === TRANSMITTAL_LINE_KIND.PO_LINE ? `${line.poNumber} · ${line.ipasNumber}` : "Typed"}
              </p>
              {line.kind === TRANSMITTAL_LINE_KIND.PO_LINE ? (
                <p className="text-[13px] font-medium">{pickedLineLabel({ productName: line.description, quantity: line.quantity, unit: line.unit })}</p>
              ) : (
                <div className="space-y-2">
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    placeholder="Description"
                  />
                  <Input
                    value={line.unit}
                    onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                    placeholder="Unit"
                  />
                </div>
              )}
            </div>
            <FieldBox label="Quantity" bare className="md:col-span-2">
              <Input
                type="number"
                min="0"
                step="any"
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
              />
            </FieldBox>
            <FieldBox label="Project Name (S.O)" bare className="md:col-span-3">
              <SelectField
                options={[{ value: NO_SOR, label: "None" }, ...line.sorOptions.map((s) => ({ value: s.id, label: s.label }))]}
                value={line.sorId ?? NO_SOR}
                onChange={(v) => updateLine(line.key, { sorId: v === NO_SOR ? null : v })}
              />
            </FieldBox>
            <FieldBox label="SN#" bare className="md:col-span-2">
              <Input value={line.serialNumbers} onChange={(e) => updateLine(line.key, { serialNumbers: e.target.value })} />
            </FieldBox>
            <FieldBox label="Quantity of Box" bare className="md:col-span-1">
              <Input value={line.boxQuantity} onChange={(e) => updateLine(line.key, { boxQuantity: e.target.value })} />
            </FieldBox>
            <div className="flex items-end md:col-span-1 md:justify-end">
              <Button type="button" size="icon" variant="ghost" aria-label="Remove line" onClick={() => removeLine(line.key)}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => save({ submit: false })} disabled={busy} className="gap-1.5">
          <Save size={14} />
          Save draft
        </Button>
        <Button type="button" onClick={() => save({ submit: true })} disabled={busy || !canSubmit} className="gap-1.5">
          <Send size={14} />
          Submit
        </Button>
      </div>

      <PoLinePicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={addPickedLine} />
    </div>
  );
}
