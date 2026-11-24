// The typed bodies of the IPAS's sections, shown inside the record's own section
// blocks while the page is in edit mode (#581). `form` and `set(key, value)` come
// from useIpasEditForm. Only the sign-offs stay buttons: signing is an action, not a field.

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import {
  IPAS_OPTION_LIST,
  IPAS_OVERRIDE,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCE,
  IPAS_SOURCE_LABELS,
} from "@/constants/ipas";
import { optionsForPicker } from "@/utils/ipasPayments";
import { formatDate } from "@/utils/formatDate.js";
import { Embedded, Field, GroupTitle, PickField, ReadValue, Tick } from "./FormFields";
import { GRID } from "./formHelpers";
import { BankFields, ChargesFields, CostingFields, DocumentsFields, FreightField, PaymentsFields, WithholdingField } from "./MoneyFields";
import { actualCheckingStampable } from "./editFormModel";

/** The sections that type in place while editing. Filing and History are read-only here. */
export const EDITABLE_SECTIONS = new Set(["order", "payments", "costs", "delivery", "documents"]);

/** The typed sections' bodies: `form` and `set(key, value)` come from the form. */
function PartBody({ sectionKey, ipas, form, set, blocks, disabled, onEditPurpose, money }) {
  const odoo = (key) => ipas.overrides?.[key]?.odoo;
  switch (sectionKey) {
    case "header":
      return (
        <div className="space-y-4">
          <div className={GRID}>
            <ReadValue label="PO">{ipas.po_number}</ReadValue>
            <Field id="f-entity" label="Entity" odoo={odoo(IPAS_OVERRIDE.ENTITY)} value={form.entity} disabled={disabled} onChange={(v) => set("entity", v)} />
            <ReadValue label="Priority">{IPAS_PRIORITY_LABELS[ipas.priority]}</ReadValue>
            <ReadValue label="Source">{IPAS_SOURCE_LABELS[ipas.source]}</ReadValue>
            <ReadValue label="Date created">{formatDate(ipas.created_at)}</ReadValue>
            <ReadValue label="Created by">{ipas.creator?.name}</ReadValue>
          </div>
          <Field
            id="f-remarks"
            label="Remarks"
            kind="textarea"
            placeholder="Anything the next person should know"
            value={form.remarks}
            disabled={disabled}
            onChange={(v) => set("remarks", v)}
          />
        </div>
      );
    case "purchasing":
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            <GroupTitle>Supplier and P.I</GroupTitle>
            <div className={GRID}>
              <ReadValue label="Supplier" odoo>
                {ipas.supplier}
              </ReadValue>
              <Field id="f-contact" label="Supplier's name" required value={form.contact} disabled={disabled} onChange={(v) => set("contact", v)} />
              <Field id="f-piNumber" label="P.I #" required value={form.piNumber} disabled={disabled} onChange={(v) => set("piNumber", v)} />
              <Field
                id="f-piQtAmount"
                label="P.I/QT Amount"
                kind="amount"
                prefix={(ipas.currency || "PHP").toString().toUpperCase()}
                required
                value={form.piQtAmount}
                disabled={disabled}
                onChange={(v) => set("piQtAmount", v)}
              />
              <FreightField ipas={ipas} form={form} set={set} disabled={disabled} />
              {ipas.source === IPAS_SOURCE.LOCAL && <WithholdingField form={form} set={set} disabled={disabled} />}
            </div>
          </div>
        </div>
      );
    case "payments-only":
      return (
        <div className="space-y-6">
          <PaymentsFields
            ipas={ipas}
            form={form}
            rows={money.rows}
            fresh={money.fresh}
            canRecord={money.can.record}
            onRemoveSaved={money.onRemoveSaved}
          />
          <BankFields ipas={ipas} form={form} set={set} canChange={money.can.change} />
        </div>
      );
    case "finance":
      return (
        <div className="space-y-6">
          <ChargesFields
            ipas={ipas}
            form={form}
            rows={money.rows}
            fresh={money.fresh}
            canRecord={money.can.record}
            onRemoveSaved={money.onRemoveSaved}
          />
        </div>
      );
    case "documents-only":
      return (
        <DocumentsFields
          ipas={ipas}
          form={form}
          rows={money.rows}
          fresh={money.fresh}
          canChange={money.can.change}
          canTickFinance={money.can.tickFinance}
          onRemoveSaved={money.onRemoveDocument}
          onSuggest={money.onSuggest}
        />
      );
    case "costing":
      return (
        <Embedded>
          <CostingFields ipas={ipas} form={form} set={set} canChange={money.can.change} canSetStatus={money.can.setStatus} />
        </Embedded>
      );
    case "filing":
      return <Embedded>{blocks.filing}</Embedded>;
    case "sales":
      return (
        <div className={GRID}>
          <ReadValue label="Purpose">{IPAS_PURPOSE_LABELS[ipas.purpose]}</ReadValue>
          <div className="min-w-0">
            <div className="pl-1 text-label font-bold tracking-widest text-muted-foreground uppercase">SORs</div>
            {ipas.sors.length === 0 ? (
              <p className="mt-1.5 pl-1 text-sm text-muted-foreground">
                {ipas.isProject ? "No SOR named" : `None; ${IPAS_PURPOSE_LABELS[ipas.purpose]} names no SOR`}
              </p>
            ) : (
              <ul className="mt-1.5 space-y-0.5 pl-1 text-sm">
                {ipas.sors.map((sor) => (
                  <li key={sor.id}>
                    <span className="font-mono font-semibold">{sor.salesReference}</span>
                    <span className="text-muted-foreground"> · {sor.projectTitle}</span>
                  </li>
                ))}
              </ul>
            )}
            {onEditPurpose && !disabled && (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onEditPurpose}>
                Change purpose and SORs
              </Button>
            )}
          </div>
          <Field id="f-sourceDoc" label="Source Doc. Odoo" odoo={odoo(IPAS_OVERRIDE.SOURCE_DOC)} value={form.sourceDoc} disabled={disabled} onChange={(v) => set("sourceDoc", v)} />
          <Field id="f-analytic" label="Analytic Dist." odoo={odoo(IPAS_OVERRIDE.ANALYTIC)} value={form.analytic} disabled={disabled} onChange={(v) => set("analytic", v)} />
        </div>
      );
    case "logistics": {
      const options = optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.ITEM_LOCATION, ipas.item_location_id).map((option) => ({
        value: option.id,
        label: option.active ? option.label : `${option.label} (deactivated)`,
      }));
      return (
        <div className="space-y-3">
          <div className={GRID}>
            <div className="flex flex-col gap-1.5">
              <FieldBox label="Direct delivery" />
              <Tick
                label="Direct delivery to client"
                checked={form.directDelivery}
                // Its own right (Purchasing or Logistics access), not the section's: Logistics access alone may switch it.
                disabled={!(money?.can?.setDirectDelivery ?? !disabled)}
                onChange={(v) => set("directDelivery", v)}
              />
            </div>
          </div>
          {form.directDelivery ? (
            <p className="text-xs text-muted-foreground">
              The supplier delivers straight to the client, so no Item Location or Transmittal is asked for. Pick Delivered from the Status at the top once the client has the goods.
            </p>
          ) : (
            <div className={GRID}>
              <PickField
                id="f-location"
                label="Item Location"
                required
                options={options}
                value={form.location}
                emptyLabel="Not set"
                disabled={disabled}
                onChange={(value) => set("location", value)}
                hint={ipas.itemLocation?.label ? `The Transmittals say ${ipas.itemLocation.label}. Pick one to keep it on this IPAS.` : undefined}
              />
            </div>
          )}
        </div>
      );
    }
    case "status": {
      const stampable = actualCheckingStampable(ipas);
      return (
        <div className="space-y-5">
          <p className="text-xs text-muted-foreground">The IPAS Status is picked from the Status at the top. Each change is posted in the Chat.</p>
          <div className="space-y-3">
            <GroupTitle>Buyer facts</GroupTitle>
            <p className="text-xs text-muted-foreground">Purchase Order, Received in Odoo and Create Bill come from Odoo, so they are not typed.</p>
            <div className={GRID}>
              <div className="flex flex-col gap-1.5">
                <FieldBox label="Actual Checking" />
                <Tick label="Checked on site" checked={form.actualChecking} disabled={disabled || !stampable} onChange={(v) => set("actualChecking", v)} />
              </div>
            </div>
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

/** Each screen section's typed parts, in reading order (1 Order … 5 Documents). */
const PARTS = {
  order: ["purchasing", "sales", "header"],
  payments: ["payments-only"],
  costs: ["finance", "costing"],
  delivery: ["logistics", "status"],
  documents: ["documents-only"],
};

export default function EditSectionBody(props) {
  return (
    <div className="space-y-8">
      {(PARTS[props.sectionKey] ?? []).map((part) => (
        <PartBody key={part} {...props} sectionKey={part} />
      ))}
    </div>
  );
}
