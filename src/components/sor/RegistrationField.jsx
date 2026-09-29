import { Download, Loader2 } from "lucide-react";
import { TextField, SelectField } from "./SorField";
import { isValidSalesReference } from "../../constants/sor";
import { Button } from "../ui/button";

/**
 * One field of the SOR registration form, rendered from its resolved
 * definition.
 *
 * The single renderer behind BOTH the live registration form
 * (`OpportunityFormModal`) and the Flow Canvas form builder
 * (`SorFormBuilder`). That is the whole point of it existing: the builder is
 * supposed to show the form exactly as it will appear, and the only way to
 * guarantee that is for there to be one piece of code that draws it. Two
 * renderers kept in sync by hand is how the builder ended up looking nothing
 * like the form it claimed to preview.
 *
 * `ctx` carries everything the live form owns — values, handlers, and the
 * Odoo state. The builder passes an inert ctx and `disabled`, so the same
 * markup renders as a non-interactive sample.
 */
export default function RegistrationField({ field, ctx, disabled = false }) {
  const { form, set, odooFilled, displacedCompany, handleUndoCompany } = ctx;

  if (field.source === "custom") {
    const value = ctx.customValues?.[field.id] ?? "";
    const onChange = (e) => ctx.onCustomChange?.(field.id, e.target.value);

    if (field.inputType === "choice") {
      return (
        <SelectField
          label={field.label}
          required={field.isRequired}
          placeholder="Select…"
          options={(field.options || []).map((o) => ({ value: o, label: o }))}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }

    return (
      <TextField
        label={field.label}
        required={field.isRequired}
        disabled={disabled}
        type={field.inputType === "number" ? "number" : field.inputType === "date" ? "date" : "text"}
        placeholder={field.help || `Enter ${field.label.toLowerCase()}`}
        value={value}
        onChange={onChange}
      />
    );
  }

  switch (field.key) {
    case "sales_reference":
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <TextField
              label={field.label}
              placeholder="e.g. S01237"
              required={field.isRequired}
              disabled={disabled}
              value={form.sales_reference || ""}
              onChange={set("sales_reference")}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={ctx.handleFetchFromOdoo}
              disabled={disabled || ctx.fetchingOdoo || !isValidSalesReference(form.sales_reference || "")}
              title="Pull the customer and the product list from this quotation in Odoo"
              className="whitespace-nowrap"
            >
              {ctx.fetchingOdoo ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Fetch from Odoo
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Fetching fills the Company, the Contact Person and the Product List from the
            quotation. No quotation yet? Leave it blank — it is required before this
            opportunity can move from Lead to Qualified.
          </p>
        </div>
      );

    case "lead_source":
      return (
        <SelectField
          label={field.label}
          required
          placeholder="Select lead source…"
          options={ctx.leadSourceOptions || []}
          value={form.lead_source || ""}
          onChange={set("lead_source")}
          disabled={disabled}
        />
      );

    case "lead_source_detail":
      // Conditional on the live form, always shown in the builder — otherwise
      // a field you are trying to position would vanish while you position it.
      if (!disabled && form.lead_source !== "OTHERS") return null;
      return (
        <TextField
          label={field.label}
          required
          disabled={disabled}
          placeholder="e.g. John Doe"
          value={form.lead_source_detail || ""}
          onChange={set("lead_source_detail")}
        />
      );

    case "client_name":
      return (
        <TextField
          label={field.label}
          required
          disabled={disabled}
          placeholder="e.g. Acme Corp"
          value={form.client_name || ""}
          onChange={set("client_name")}
          autofilled={!!odooFilled?.client_name}
          action={
            displacedCompany ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleUndoCompany}
                title={`Restore "${displacedCompany}"`}
                className="h-auto -my-1.5 -mr-1 px-1.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-mauve-12 underline underline-offset-2 decoration-mauve-8 hover:decoration-mauve-11 hover:bg-transparent"
              >
                Undo
              </Button>
            ) : null
          }
        />
      );

    case "contact_person":
      return (
        <TextField
          label={field.label}
          required
          disabled={disabled}
          placeholder="e.g. Juan Dela Cruz"
          value={form.contact_person || ""}
          onChange={set("contact_person")}
          autofilled={!!odooFilled?.contact_person}
        />
      );

    case "project_title":
      return (
        <TextField
          label={field.label}
          required
          disabled={disabled}
          placeholder="e.g. 2 Units Boom Lift"
          value={form.project_title || ""}
          onChange={set("project_title")}
        />
      );

    case "expected_award_date":
      return (
        <TextField
          label={field.label}
          type="date"
          required={field.isRequired}
          disabled={disabled}
          value={form.expected_award_date || ""}
          onChange={set("expected_award_date")}
        />
      );

    default:
      return null;
  }
}

/** An inert ctx for the builder: real markup, no live values and no handlers. */
export const SAMPLE_FIELD_CTX = {
  form: {},
  set: () => () => {},
  odooFilled: {},
  displacedCompany: null,
  handleUndoCompany: () => {},
  handleFetchFromOdoo: () => {},
  fetchingOdoo: false,
  leadSourceOptions: [],
  customValues: {},
  onCustomChange: () => {},
};
