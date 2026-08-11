import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Target, Download, Loader2 } from "lucide-react";
import HRFormModal from "../hr/HRFormModal";
import { TextField, SelectField } from "./SorField";
import OpportunityItemsEditor from "./OpportunityItemsEditor";
import { employeeService } from "../../services/employeeService";
import { opportunityService } from "../../services/opportunityService";
import { odooService } from "../../services/odooService";
import {
  LEAD_SOURCES,
  PROJECT_TYPES,
  isValidSalesReference,
  normalizeSalesReference,
  SALES_REFERENCE_HINT,
} from "../../constants/sor";

const FORM_ID = "opportunity-form";

const blankForm = () => ({
  registration_date: new Date().toISOString().slice(0, 10),
  lead_source: "",
  lead_source_detail: "",
  client_name: "",
  contact_person: "",
  project_title: "",
  project_type: "SSP",
  sales_reference: "",
  expected_award_date: "",
  deal_owner_id: "",
  support_sales_1_id: "",
  support_sales_2_id: "",
  sales_director_id: "",
});

const fromRecord = (o) => ({
  registration_date: o.registration_date || "",
  lead_source: o.lead_source || "",
  lead_source_detail: o.lead_source_detail || "",
  client_name: o.client_name || "",
  contact_person: o.contact_person || "",
  project_title: o.project_title || "",
  project_type: o.project_type || "SSP",
  sales_reference: o.sales_reference || "",
  expected_award_date: o.expected_award_date || "",
  deal_owner_id: o.deal_owner_id || "",
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

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const [fetchingOdoo, setFetchingOdoo] = useState(false);

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
      setItems(result.items.map(toRow));
      toast.success(
        `Pulled ${result.items.length} item(s) from ${result.order?.name || ref}.`,
      );
    } catch (err) {
      toast.error(err.message || "Could not reach Odoo — enter items manually.");
    } finally {
      setFetchingOdoo(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const sales_reference = normalizeSalesReference(form.sales_reference);
    if (sales_reference && !isValidSalesReference(sales_reference)) {
      toast.error(SALES_REFERENCE_HINT);
      return;
    }
    onSubmit({ ...form, sales_reference, items });
  };

  return (
    <HRFormModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Opportunity ${opportunity.opportunity_no}` : "Register Opportunity"}
      subtitle={isEdit ? "Edit" : "New"}
      icon={Target}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!isEdit && (
            <TextField
              label="Registration Date"
              type="date"
              required
              value={form.registration_date}
              onChange={set("registration_date")}
            />
          )}
          <SelectField
            label="Lead Source"
            required
            options={LEAD_SOURCES}
            value={form.lead_source}
            onChange={set("lead_source")}
          />
          <TextField
            label="Lead Source Detail"
            placeholder="e.g. Bayambang"
            value={form.lead_source_detail}
            onChange={set("lead_source_detail")}
          />
          <TextField
            label="Client"
            required
            placeholder="e.g. LGU - Tuguegarao"
            value={form.client_name}
            onChange={set("client_name")}
          />
          <TextField
            label="Contact Person"
            placeholder="e.g. Juan Dela Cruz"
            value={form.contact_person}
            onChange={set("contact_person")}
          />
        </div>

        <TextField
          label="Project"
          required
          placeholder="e.g. 2 Units Boom Lift"
          value={form.project_title}
          onChange={set("project_title")}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField
            label="Sales Division"
            required
            placeholder="Select project type…"
            options={PROJECT_TYPES}
            value={form.project_type}
            onChange={set("project_type")}
          />
          <TextField
            label="Expected Award"
            type="date"
            value={form.expected_award_date}
            onChange={set("expected_award_date")}
          />
          <div className="sm:col-span-2 flex gap-2">
            <TextField
              label="Sales Reference"
              placeholder="e.g. S01237"
              value={form.sales_reference}
              onChange={set("sales_reference")}
              className="flex-1"
            />
            <button
              type="button"
              onClick={handleFetchFromOdoo}
              disabled={fetchingOdoo || !isValidSalesReference(form.sales_reference)}
              title="Pull the product list from this quotation in Odoo"
              className="px-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 text-xs font-bold text-foreground whitespace-nowrap"
            >
              {fetchingOdoo ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Fetch Items
            </button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The Odoo sales quotation number. It confirms a quotation has been
          issued, and is required before this opportunity can move from Lead to
          Qualified — leave it blank until the quotation exists. Use{" "}
          <strong>Fetch Items</strong> to pull the Product List straight from
          the quotation, or enter it manually below.
        </p>

        <div className="pt-2 border-t border-border/50">
          <OpportunityItemsEditor items={items} onChange={setItems} />
        </div>

        <div className="pt-2 border-t border-border/50 space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Ownership
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField
              label="Deal Owner"
              required
              options={employeeOptions}
              value={form.deal_owner_id}
              onChange={set("deal_owner_id")}
            />
            <SelectField
              label="Sales Director"
              options={employeeOptions}
              value={form.sales_director_id}
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
