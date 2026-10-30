import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Save, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { transmittalService } from "@/services/transmittalService";
import { ipasService } from "@/services/ipasService";
import { companyService } from "@/services/companyService";
import { TRANSMITTAL_LINE_KIND, TRANSMITTAL_OPTION_LIST } from "@/constants/transmittals";
import { matchCompany, slipGaps } from "@/utils/transmittals";
import FillFromIpas from "./form/FillFromIpas";
import LineLiner from "./form/LineLiner";
import PoLineBrowser from "./form/PoLineBrowser";
import ReadinessStrip from "./form/ReadinessStrip";
import SlipProperties from "./form/SlipProperties";
import SectionTitle from "./SectionTitle";
import { transmittalKeys } from "./transmittalKeys";
import { ipasErrorMessage } from "../../utils/ipas";

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

/** A P0 line picked from an IPAS: its name and unit are the Odoo ones, and its SORs the choices. */
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

function typedLine(description = "") {
  return {
    key: nextLineKey(),
    kind: TRANSMITTAL_LINE_KIND.TYPED,
    ipasId: null,
    ipasNumber: null,
    poNumber: null,
    odooPoLineId: null,
    description,
    unit: "",
    quantity: "",
    sorId: null,
    sorOptions: [],
    serialNumbers: "",
    boxQuantity: "",
  };
}

const sameLine = (line, pick) => line.ipasId === pick.ipasId && line.odooPoLineId === pick.odooPoLineId;

/**
 * A Transmittal's header, products, references and lines (#252). Creates a
 * draft, or replaces an existing draft (`existing`). "Save draft" keeps it a
 * draft; "Submit" saves and submits it, which fixes it and opens the first
 * stage. The database refuses anything the screen lets through.
 *
 * Two panes: the live P0 lines on the left (click one to put it on the slip),
 * the slip on the right (header as property pills, lines as one-line rows).
 *
 * `actionsSlot`: when the form sits in a modal, the footer node to put Save draft
 * and Submit in (null while the footer is not mounted yet); left out, they sit
 * under the form.
 */
export default function TransmittalForm({ existing = null, defaultOrigin = "", onSaved, onCancel, actionsSlot }) {
  const queryClient = useQueryClient();
  const [header, setHeader] = useState(() => headerFrom(existing, defaultOrigin));
  const [productIds, setProductIds] = useState(() => existing?.products.map((p) => p.id) ?? []);
  const [referenceIds, setReferenceIds] = useState(() => existing?.references.map((r) => r.id) ?? []);
  const [lines, setLines] = useState(() => (existing ? existing.lines.map(lineFrom) : []));
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
  const locationChoices = options.filter((o) => o.list === "item_location").map((o) => ({ value: o.id, label: o.label }));

  const setField = (field) => (value) => setHeader((prev) => ({ ...prev, [field]: value }));
  const patchHeader = (patch) => setHeader((prev) => ({ ...prev, ...patch }));

  const updateLine = (key, patch) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key) => setLines((prev) => prev.filter((line) => line.key !== key));

  // The first P0 line sets the Company, unless one was already picked.
  const addPickedLine = (pick) => {
    setLines((prev) => [...prev, poLineFromPick(pick)]);
    setHeader((prev) => (prev.entity ? prev : { ...prev, entity: matchCompany(companyNames, pick.entity) }));
  };
  const togglePick = (pick) =>
    lines.some((line) => sameLine(line, pick))
      ? setLines((prev) => prev.filter((line) => !sameLine(line, pick)))
      : addPickedLine(pick);
  const addPicks = (picks) => picks.filter((pick) => !lines.some((line) => sameLine(line, pick))).forEach(addPickedLine);
  const addTyped = (description = "") => setLines((prev) => [...prev, typedLine(description)]);

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
      const payload = { header, productIds, referenceIds, lines: linesPayload };
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

  // Why Submit is off, in plain words (null when it is on).
  const gaps = slipGaps({ header, lines });
  const submitBlocker = gaps.length > 0 ? `${gaps[0].text} to submit.` : null;
  const canSubmit = submitBlocker === null;

  const saveButtons = (
    <>
      <Button type="button" variant="outline" onClick={() => save({ submit: false })} disabled={busy} className="gap-1.5">
        <Save size={14} />
        Save draft
      </Button>
      <Button type="button" onClick={() => save({ submit: true })} disabled={busy || !canSubmit} className="gap-1.5">
        <Send size={14} />
        Submit
      </Button>
    </>
  );
  const blockerNote = submitBlocker && (
    <p className="-mt-3 text-right text-[12px] text-muted-foreground" data-testid="transmittal-submit-reason">
      {submitBlocker}
    </p>
  );

  return (
    <div className="grid gap-8 pb-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="min-w-0">
        <SectionTitle title="Live P0 lines" note="Click a line to put it on the slip. Click it again to take it off." />
        <FillFromIpas onFill={addPicks} />
        <PoLineBrowser lines={lines} onToggle={togglePick} onAddAll={addPicks} onAddTyped={addTyped} />
      </aside>

      <section className="min-w-0 space-y-6">
        <div>
          <SectionTitle title="The slip" note="Click a pill to set it. Company follows the first P0 line." />
          <SlipProperties
            header={header}
            setField={setField}
            patchHeader={patchHeader}
            productIds={productIds}
            referenceIds={referenceIds}
            setProductIds={setProductIds}
            setReferenceIds={setReferenceIds}
            companyNames={companyNames}
            productOptions={productOptions}
            referenceOptions={referenceOptions}
            locationChoices={locationChoices}
            gaps={gaps}
          />
        </div>

        <div>
          <SectionTitle
            title={lines.length ? `On the slip · ${lines.length}` : "On the slip"}
            aside={
              <Button type="button" size="sm" variant="outline" onClick={() => addTyped()} className="gap-1.5">
                <Plus size={14} /> Typed line
              </Button>
            }
          />
          {lines.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nothing on the slip yet. Pick lines on the left, or add a typed line for anything not on a PO.
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line, index) => (
                <LineLiner
                  key={line.key}
                  line={line}
                  index={index}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onRemove={() => removeLine(line.key)}
                />
              ))}
            </ul>
          )}
        </div>

        <ReadinessStrip gaps={gaps} header={header} />
      </section>

      {actionsSlot === undefined ? (
        <div className="space-y-3 border-t border-border pt-4 lg:col-span-2">
          <div className="flex flex-wrap justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )}
            {saveButtons}
          </div>
          {blockerNote}
        </div>
      ) : (
        actionsSlot &&
        createPortal(
          <>
            {submitBlocker && (
              <span className="max-w-72 text-right text-label font-medium text-muted-foreground" data-testid="transmittal-submit-reason">
                {submitBlocker}
              </span>
            )}
            {saveButtons}
          </>,
          actionsSlot,
        )
      )}
    </div>
  );
}
