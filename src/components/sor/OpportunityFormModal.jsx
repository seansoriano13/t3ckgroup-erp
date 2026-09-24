import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import HRFormModal from "../hr/HRFormModal";
import { TextField, SelectField } from "./SorField";
import OpportunityItemsEditor from "./OpportunityItemsEditor";
import { employeeService } from "../../services/employeeService";
import { opportunityService } from "../../services/opportunityService";
import { odooService } from "../../services/odooService";
import {
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
  isValidSalesReference,
  normalizeSalesReference,
  SALES_REFERENCE_HINT,
} from "../../constants/sor";
import { deriveProjectType } from "../../utils/commission";
import { leadSourceService } from "../../services/leadSourceService";
import { salesFlowService } from "../../services/salesFlowService";
import { formFieldService } from "../../services/formFieldService";
import { resolveFormFields } from "../../constants/sorFormBuilder";
import RegistrationField from "./RegistrationField";
import { Button } from "../ui/button";

const FORM_ID = "opportunity-form";

const blankForm = () => ({
  registration_date: new Date().toISOString().slice(0, 10),
  lead_source: "",
  lead_source_detail: "",
  client_name: "",
  odoo_partner_id: null,
  contact_person: "",
  project_title: "",
  project_type: "SSP",
  sale_type_id: "",
  sales_reference: "",
  expected_award_date: "",
  po_date: "",
  deal_owner_id: "",
  closing_sales_id: "",
  support_sales_1_id: "",
  support_sales_2_id: "",
  sales_director_id: "",
});

const fromRecord = (o) => ({
  registration_date: o.registration_date || "",
  lead_source: o.lead_source || "",
  lead_source_detail: o.lead_source_detail || "",
  client_name: o.client_name || "",
  odoo_partner_id: o.odoo_partner_id ?? null,
  contact_person: o.contact_person || "",
  project_title: o.project_title || "",
  project_type: o.project_type || "SSP",
  sale_type_id: o.sale_type_id || "",
  sales_reference: o.sales_reference || "",
  expected_award_date: o.expected_award_date || "",
  po_date: o.po_date || "",
  deal_owner_id: o.deal_owner_id || "",
  closing_sales_id: o.closing_sales_id || "",
  support_sales_1_id: o.support_sales_1_id || "",
  support_sales_2_id: o.support_sales_2_id || "",
  sales_director_id: o.sales_director_id || "",
});

const toRow = (item) => ({
  product_name: item.product_name || "",
  unit: item.unit || "",
  quantity: item.quantity ?? 1,
  unit_price: item.unit_price ?? "",
});

export default function OpportunityFormModal({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  opportunity = null,
}) {
  const isEdit = !!opportunity;

  // Render-phase sync rather than an effect. `isOpen` is part of the key so the
  // register form starts blank every time it is opened — this component stays
  // mounted while only the Dialog content unmounts, so state would otherwise
  // survive from the previous registration.
  const currentKey = `${opportunity?.id || "new"}:${isOpen}`;
  const [formKey, setFormKey] = useState(currentKey);
  const [form, setForm] = useState(() =>
    opportunity ? fromRecord(opportunity) : blankForm(),
  );

  if (currentKey !== formKey) {
    setFormKey(currentKey);
    setForm(opportunity ? fromRecord(opportunity) : blankForm());
  }

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: isOpen,
  });

  // Issue #36 — the Sale Type a deal is registered against decides which
  // Sales Flow it runs. The list is whatever the Operations Manager has drawn
  // on the Flow Canvas, and is empty until she has drawn one; the field hides
  // itself in that case rather than offering an empty picker.
  const { data: saleTypes = [] } = useQuery({
    queryKey: ["saleTypes"],
    queryFn: () => salesFlowService.getSaleTypes(),
  });

  // The chosen Sale Type decides the form: its flow's builder customization
  // (labels, order, hidden fields) plus any custom fields it adds. No Sale
  // Type, or one whose flow has no customization, resolves to the built-in
  // default form — which is why this needs no loading state.
  const { data: formRows = [] } = useQuery({
    queryKey: ["flowFormFields", "saleType", form.sale_type_id],
    queryFn: () => formFieldService.getForSaleType(form.sale_type_id),
    enabled: isOpen && Boolean(form.sale_type_id),
  });

  const formFields = resolveFormFields(formRows);
  const visibleFields = formFields.filter((f) => !f.isHidden);
  const customFields = visibleFields.filter((f) => f.source === "custom");

  // Answers to the custom fields, keyed by field id. Kept apart from `form`
  // because they are not columns on the SOR — they travel as `formValues` and
  // are written to sor_form_values after the insert.
  const [customValues, setCustomValues] = useState({});

  // Q22: switching Sale Type switches forms. Answers to fields the new form
  // also has are kept; the rest are dropped and the salesperson is told, since
  // silently discarding typed work and silently keeping it against a field
  // that no longer exists are both worse.
  const [customSeedKey, setCustomSeedKey] = useState(form.sale_type_id);
  if (customSeedKey !== form.sale_type_id) {
    setCustomSeedKey(form.sale_type_id);
    const stillValid = new Set(customFields.map((f) => f.id));
    const kept = Object.fromEntries(
      Object.entries(customValues).filter(([fieldId]) => stillValid.has(fieldId)),
    );
    const droppedCount = Object.keys(customValues).length - Object.keys(kept).length;
    setCustomValues(kept);
    if (droppedCount > 0) {
      toast(`${droppedCount} field${droppedCount === 1 ? "" : "s"} don't apply to this Sale Type — their answers were cleared.`);
    }
  }

  const { data: activeLeadSources = [] } = useQuery({
    queryKey: ["leadSources", "active"],
    queryFn: () => leadSourceService.getActiveLeadSources(),
    enabled: isOpen,
  });

  const { data: existingItems } = useQuery({
    queryKey: ["opportunityItems", opportunity?.id],
    queryFn: () => opportunityService.getItems(opportunity.id),
    enabled: isEdit && isOpen,
  });

  // Same render-phase sync as `form` above, but gated on the items query
  // resolving first when editing — otherwise this would seed to [] before
  // `existingItems` arrives and never re-sync once it does.
  const [items, setItems] = useState([]);
  const [itemsSeedKey, setItemsSeedKey] = useState(currentKey);

  if (currentKey !== itemsSeedKey && (!isEdit || existingItems !== undefined)) {
    setItemsSeedKey(currentKey);
    setItems(isEdit ? (existingItems || []).map(toRow) : []);
  }

  // Super admins are selectable: some of them carry deals of their own, and
  // excluding them made those opportunities impossible to attribute correctly.
  const employeeOptions = employees
    .map((e) => ({
      value: e.id,
      label: e.subDepartment ? `${e.name} — ${e.subDepartment}` : e.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const saleTypeOptions = saleTypes.map((t) => ({ value: t.id, label: t.name }));

  const leadSourceOptions = activeLeadSources.map((s) => ({
    value: s.value,
    label: s.label,
  }));

  // The Sales Director is fixed by policy rather than picked per deal, so the
  // field is locked. Resolved from the employee list by role: the column is a
  // uuid FK, and hardcoding the account's display name ("101") made every
  // registration fail with `invalid input syntax for type uuid`.
  const salesDirectorId =
    employees.find((e) => /sales\s*director/i.test(e.role || ""))?.id || "";
  const effectiveSalesDirectorId = form.sales_director_id || salesDirectorId;

  const [fetchingOdoo, setFetchingOdoo] = useState(false);

  // Which fields the last fetch actually changed, so only those wear the
  // highlight. A field Odoo agreed with must not flash: if everything lit up,
  // the highlight would stop meaning "look at this".
  const [odooFilled, setOdooFilled] = useState({});

  // The Company text the fetch displaced, kept so it can be put back. Only set
  // when there was something there to lose: filling a blank Company is not a
  // thing anyone needs to undo, and the field is required, so "undo" into an
  // empty value would just break the form.
  const [displacedCompany, setDisplacedCompany] = useState(null);

  const highlightTimer = useRef(null);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const set = (key) => (e) => {
    const val = e.target.value;
    // Typing in a field the fetch just filled retires its highlight — the
    // highlight reports what Odoo did, and the moment the value is the
    // salesperson's again it is reporting something untrue.
    setOdooFilled((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
    // Typing over the fetched Company retires the offer to restore the older
    // one: two competing "previous values" is a worse position than none.
    if (key === "client_name") setDisplacedCompany(null);
    setForm((prev) => {
      const next = { ...prev, [key]: val };
      // A verification marker that outlives the value it verified makes an
      // unverified Company look checked, so editing the name drops the
      // partner it was fetched from.
      if (key === "client_name" && val !== prev.client_name) {
        next.odoo_partner_id = null;
      }
      if (key === "support_sales_1_id" || key === "support_sales_2_id") {
        next.project_type = deriveProjectType({
          supportSales1Id: next.support_sales_1_id,
          supportSales2Id: next.support_sales_2_id,
          currentProjectType: prev.project_type,
        });
      }
      return next;
    });
  };

  const toggleStrategic = () => {
    setForm((prev) => ({
      ...prev,
      project_type:
        prev.project_type === "STRATEGIC"
          ? deriveProjectType({
            supportSales1Id: prev.support_sales_1_id,
            supportSales2Id: prev.support_sales_2_id,
          })
          : "STRATEGIC",
    }));
  };

  const handleFetchFromOdoo = async () => {
    const ref = normalizeSalesReference(form.sales_reference);
    if (!isValidSalesReference(ref)) {
      toast.error(SALES_REFERENCE_HINT);
      return;
    }
    const hasItems = items.some((it) => (it.product_name || "").trim());
    if (
      hasItems &&
      !window.confirm(
        "This replaces the current Product List with the items from Odoo. Continue?",
      )
    ) {
      return;
    }

    setFetchingOdoo(true);
    try {
      const result = await odooService.fetchOrderLines(ref);
      if (!result?.success) {
        toast.error(
          result?.message ||
          "Could not fetch items from Odoo — enter them manually.",
        );
        return;
      }

      const customer = result.customer || {};
      const changed = {};
      const previousCompany = form.client_name.trim();
      setDisplacedCompany(
        customer.company && previousCompany && customer.company !== previousCompany
          ? previousCompany
          : null,
      );

      // The two fields are filled with opposite trust rules (ADR 0006).
      // Company is whatever Odoo says — that is the field salespeople get
      // wrong, and the quotation is the record of who is actually being sold
      // to. Contact Person is filled only when empty, because a typed one
      // usually carries a mobile number or a working name ("Sir Prado") that
      // Odoo has never held, and overwriting that destroys information.
      setForm((prev) => {
        const next = { ...prev };
        if (customer.company && customer.company !== prev.client_name) {
          next.client_name = customer.company;
          changed.client_name = true;
        }
        if (customer.company_id) {
          next.odoo_partner_id = customer.company_id;
        }
        if (customer.contact && !(prev.contact_person || "").trim()) {
          next.contact_person = customer.contact;
          changed.contact_person = true;
        }
        return next;
      });
      setOdooFilled(changed);
      // The highlight is a glance, not a state to be dismissed: it retires
      // itself and fades out through the border transition the field already
      // carries.
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setOdooFilled({}), 1500);

      // An empty list means the quotation is half-built, NOT that its products
      // were deleted — replacing the editor with nothing would throw away work
      // the salesperson typed. Only a list with something in it replaces one.
      if (result.items.length) setItems(result.items.map(toRow));

      const quotation = result.order?.name || ref;
      const from = [quotation, customer.company]
        .filter(Boolean)
        .join(" — ");
      toast.success(
        result.items.length
          ? `Pulled ${result.items.length} item(s) from ${from}.`
          : `Fetched ${from} — no product lines on it yet, so enter them below.`,
      );
    } catch (err) {
      toast.error(err.message || "Could not reach Odoo — enter items manually.");
    } finally {
      setFetchingOdoo(false);
    }
  };

  // Restores the Company the fetch displaced. The verification marker goes
  // with it: the name is no longer the one Odoo gave, so it is no longer
  // vouched for by an Odoo customer.
  const handleUndoCompany = () => {
    setForm((prev) => ({
      ...prev,
      client_name: displacedCompany,
      odoo_partner_id: null,
    }));
    setOdooFilled((prev) => ({ ...prev, client_name: false }));
    setDisplacedCompany(null);
  };

  // Everything RegistrationField needs to draw a live, working field. Bundled
  // rather than passed one prop at a time so the builder's inert equivalent
  // (SAMPLE_FIELD_CTX) is obviously the same shape.
  const fieldCtx = {
    form,
    set,
    odooFilled,
    displacedCompany,
    handleUndoCompany,
    handleFetchFromOdoo,
    fetchingOdoo,
    leadSourceOptions,
    customValues,
    onCustomChange: (fieldId, value) =>
      setCustomValues((prev) => ({ ...prev, [fieldId]: value })),
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const sales_reference = normalizeSalesReference(form.sales_reference);
    if (sales_reference && !isValidSalesReference(sales_reference)) {
      toast.error(SALES_REFERENCE_HINT);
      return;
    }
    const derivedType = deriveProjectType({
      supportSales1Id: form.support_sales_1_id,
      supportSales2Id: form.support_sales_2_id,
      currentProjectType: form.project_type,
    });
    onSubmit({
      ...form,
      project_type: derivedType,
      sale_type_id: form.sale_type_id || null,
      sales_reference,
      sales_director_id: effectiveSalesDirectorId,
      items,
      // Only the custom fields still on this form — see the Sale Type switch
      // above. `createOpportunity` writes these to sor_form_values.
      formValues: customValues,
    });
  };

  return (
    <HRFormModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEdit
          ? `Opportunity ${opportunity.sales_reference || opportunity.client_name}`
          : "Register Opportunity"
      }
      badge="OPP"
      formId={FORM_ID}
      isPending={isPending}
      submitLabel={isEdit ? "Save Changes" : "Register"}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4 transition-[padding] duration-300 ease-in-out [&:has([data-state=open])]:pb-64">
        {!isEdit && (
          <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 border border-border rounded-xl px-3 py-2.5">
            Register before bid, proposal, or quotation issuance. The
            registration date establishes deal ownership and cannot be changed
            afterwards. The opportunity number is issued automatically.
          </p>
        )}

        {/* Issue #36 — chosen at registration, and changeable afterwards only
            while the deal is still on its flow's first Stage, which is why the
            edit form does not offer it.

            It leads the form because it now *chooses* the form: the flow's
            builder decides which fields appear below, their labels and their
            order. Left mid-form, the page visibly grew under the cursor of
            someone who had already started filling it in. */}
        {!isEdit && saleTypes.length > 0 && (
          <SelectField
            label="Sale Type"
            placeholder="Select sale type…"
            options={saleTypeOptions}
            value={form.sale_type_id}
            onChange={set("sale_type_id")}
          />
        )}

        {!isEdit && saleTypes.length > 0 && (
          <p className="-mt-2 text-xs leading-snug text-muted-foreground">
            {form.sale_type_id
              ? `Showing ${visibleFields.length} field${visibleFields.length === 1 ? "" : "s"} for ${
                  saleTypes.find((t) => t.id === form.sale_type_id)?.name || "this Sale Type"
                }. Change the Sale Type and the fields below change with it.`
              : "The fields below depend on the Sale Type you choose."}
          </p>
        )}

        {!isEdit && (
          <TextField
            label="Registration Date"
            type="date"
            required
            disabled
            value={form.registration_date}
            onChange={set("registration_date")}
          />
        )}

        {/* Drawn by the same component the Flow Canvas builder draws, so what
            the builder shows and what a salesperson fills in cannot drift
            apart. The builder decides order and presence; RegistrationField
            decides appearance. */}
        {visibleFields.map((field) => (
          <RegistrationField key={field.key} field={field} ctx={fieldCtx} />
        ))}

        <div className="grid grid-cols-1 gap-3">
          <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">
                Sales Division
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={toggleStrategic}
                className={`h-auto text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors ${form.project_type === "STRATEGIC"
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-muted/50 text-muted-foreground hover:text-foreground border-border hover:bg-muted"
                  }`}
                title="Toggle Strategic project override"
              >
                {form.project_type === "STRATEGIC" ? "★ Strategic" : "Mark as Strategic"}
              </Button>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <span
                data-testid="project-type-badge"
                className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-lg border ${form.project_type === "STRATEGIC"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : form.project_type === "CP"
                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  }`}
              >
                {PROJECT_TYPE_LABELS[form.project_type] || form.project_type}
              </span>
            </div>
          </div>
          {/* Expected Award Date is NOT rendered here any more — it is one of
              the builder-ordered fields above, and leaving a second copy here
              put it on the form twice. PO Date is no longer offered at all;
              its column, its writer and every value already recorded are
              untouched, and the form still round-trips the value it loaded so
              editing an SOR never blanks it. */}
        </div>

        <div className="pt-2 border-t border-border/50">
          <OpportunityItemsEditor items={items} onChange={setItems} />
        </div>

        <div className="pt-2 border-t border-border/50 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Ownership
            </p>
            {(!form.deal_owner_id || !effectiveSalesDirectorId || (form.project_type === "STRATEGIC" && !form.closing_sales_id)) && (
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                Advisory: Unassigned roles leave shares unattributed
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField
              label={form.project_type === "STRATEGIC" ? "Deal Owner / Originator" : "Deal Owner"}
              required
              options={employeeOptions}
              value={form.deal_owner_id}
              onChange={set("deal_owner_id")}
            />
            {form.project_type === "STRATEGIC" && (
              <SelectField
                label="Closing Salesperson"
                options={employeeOptions}
                value={form.closing_sales_id}
                onChange={set("closing_sales_id")}
              />
            )}
            <SelectField
              label="Sales Director"
              disabled
              options={employeeOptions}
              value={effectiveSalesDirectorId}
              onChange={set("sales_director_id")}
            />
            <SelectField
              label="Support Sales 1"
              options={employeeOptions}
              value={form.support_sales_1_id}
              onChange={set("support_sales_1_id")}
            />
            <SelectField
              label="Support Sales 2"
              options={employeeOptions}
              value={form.support_sales_2_id}
              onChange={set("support_sales_2_id")}
            />
          </div>
        </div>
      </form>
    </HRFormModal>
  );
}
