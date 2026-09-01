import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Download, Loader2 } from "lucide-react";
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

  const highlightTimer = useRef(null);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const set = (key) => (e) => {
    const val = e.target.value;
    // Typing in a field the fetch just filled retires its highlight — the
    // highlight reports what Odoo did, and the moment the value is the
    // salesperson's again it is reporting something untrue.
    setOdooFilled((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
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

      setItems(result.items.map(toRow));

      const from = [result.order?.name || ref, customer.company]
        .filter(Boolean)
        .join(" — ");
      if (result.items.length) {
        toast.success(`Pulled ${result.items.length} item(s) from ${from}.`);
      } else {
        // Found, but half-built. The Company still came back and has been
        // filled in, so this reports what is missing rather than failing.
        toast.success(`Fetched ${from}.`);
        toast.error(
          result.message ||
          `${result.order?.name || ref} has no product lines yet — enter them manually.`,
        );
      }
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
    const derivedType = deriveProjectType({
      supportSales1Id: form.support_sales_1_id,
      supportSales2Id: form.support_sales_2_id,
      currentProjectType: form.project_type,
    });
    onSubmit({
      ...form,
      project_type: derivedType,
      sales_reference,
      sales_director_id: effectiveSalesDirectorId,
      items,
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <SelectField
            label="Lead Source"
            required
            placeholder="Select lead source…"
            options={leadSourceOptions}
            value={form.lead_source}
            onChange={set("lead_source")}
          />
        </div>

        {form.lead_source === "OTHERS" && (
          <TextField
            label="Referral"
            required
            placeholder="e.g. John Doe"
            value={form.lead_source_detail}
            onChange={set("lead_source_detail")}
          />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label="Company"
            required
            placeholder="e.g. Acme Corp"
            value={form.client_name}
            onChange={set("client_name")}
            filled={!!odooFilled.client_name}
          />
          <TextField
            label="Contact Person"
            required
            placeholder="e.g. Juan Dela Cruz"
            value={form.contact_person}
            onChange={set("contact_person")}
            filled={!!odooFilled.contact_person}
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
          <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">
                Sales Division
              </label>
              <button
                type="button"
                onClick={toggleStrategic}
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors ${form.project_type === "STRATEGIC"
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-muted/50 text-muted-foreground hover:text-foreground border-border hover:bg-muted"
                  }`}
                title="Toggle Strategic project override"
              >
                {form.project_type === "STRATEGIC" ? "★ Strategic" : "Mark as Strategic"}
              </button>
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
          {/* Two dates, deliberately separate. `expected_award_date` is a
              pre-award forecast; `po_date` is the date printed on the client's
              PO. They shared one field labelled "Purchase Date/Order" until
              migration 0039, which is why some rows hold a future date and
              some a past one. */}
          <TextField
            label="Expected Award Date"
            type="date"
            value={form.expected_award_date}
            onChange={set("expected_award_date")}
          />
          <TextField
            label="PO Date"
            type="date"
            value={form.po_date}
            onChange={set("po_date")}
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
              title="Pull the customer and the product list from this quotation in Odoo"
              className="px-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 text-xs font-bold text-foreground whitespace-nowrap"
            >
              {fetchingOdoo ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Fetch from Odoo
            </button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The Odoo sales quotation number. It confirms a quotation has been
          issued, and is required before this opportunity can move from Lead to
          Qualified — leave it blank until the quotation exists. Use{" "}
          <strong>Fetch from Odoo</strong> to fill the Company and pull the
          Product List straight from the quotation, or enter them manually
          below.
        </p>

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
