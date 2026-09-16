import { describe, expect, it } from "vitest"
import {
  SOR_FORM_DEFAULT_FIELDS,
  isCoreFormField,
  isFormDefaultKey,
  resolveFormFields,
} from "./sorFormBuilder"

/**
 * The registration form builder's one piece of real logic: turning stored
 * customization rows into the form that actually renders.
 *
 * The load-bearing rule is that a row means "changed" — a default with no row
 * comes back untouched. Restore-to-default is implemented as deleting rows, so
 * if that rule broke, Restore would silently stop restoring.
 */

const labelsOf = (fields) => fields.map((f) => f.label)

describe("resolving a flow's registration form", () => {
  it("returns every built-in default, in order, when nothing has been customized", () => {
    const fields = resolveFormFields([])

    expect(labelsOf(fields)).toEqual(SOR_FORM_DEFAULT_FIELDS.map((f) => f.label))
    expect(fields.every((f) => f.source === "default")).toBe(true)
    expect(fields.some((f) => f.isHidden)).toBe(false)
  })

  it("treats an absent row as an untouched default — what Restore relies on", () => {
    // Restore deletes this flow's rows. If an absent row resolved to anything
    // other than the built-in default, deleting would not restore.
    expect(resolveFormFields([])).toEqual(resolveFormFields(undefined))
  })

  it("applies a renamed label to the default it customizes, leaving the rest alone", () => {
    const fields = resolveFormFields([
      { id: "r1", source: "default", default_key: "client_name", label: "Agency" },
    ])

    expect(fields.find((f) => f.key === "client_name").label).toBe("Agency")
    expect(fields.find((f) => f.key === "contact_person").label).toBe("Contact Person")
  })

  it("falls back to the built-in label when a row stores a blank one", () => {
    const fields = resolveFormFields([
      { id: "r1", source: "default", default_key: "client_name", label: "   " },
    ])

    expect(fields.find((f) => f.key === "client_name").label).toBe("Company")
  })

  it("hides an optional default when its row says so", () => {
    const fields = resolveFormFields([
      { id: "r1", source: "default", default_key: "expected_award_date", is_hidden: true },
    ])

    expect(fields.find((f) => f.key === "expected_award_date").isHidden).toBe(true)
  })

  it("refuses to hide or unrequire a core default, even if a row says to", () => {
    // A row written before the guard existed, or by hand, must not be able to
    // remove a field registration cannot complete without.
    const fields = resolveFormFields([
      { id: "r1", source: "default", default_key: "client_name", is_hidden: true, is_required: false },
    ])

    const company = fields.find((f) => f.key === "client_name")
    expect(company.isHidden).toBe(false)
    expect(company.isRequired).toBe(true)
  })

  it("orders defaults by their stored sort order", () => {
    const fields = resolveFormFields([
      { id: "r1", source: "default", default_key: "project_title", sort_order: -1 },
    ])

    expect(fields[0].key).toBe("project_title")
  })

  it("adds custom fields, carrying their type, options and required flag", () => {
    const fields = resolveFormFields([
      {
        id: "c1",
        source: "custom",
        default_key: null,
        label: "Bid Bond Reference",
        field_type: "choice",
        options: ["Yes", "No"],
        is_required: true,
        sort_order: 99,
      },
    ])

    const custom = fields.find((f) => f.id === "c1")
    expect(custom.source).toBe("custom")
    expect(custom.inputType).toBe("choice")
    expect(custom.options).toEqual(["Yes", "No"])
    expect(custom.isRequired).toBe(true)
  })

  it("interleaves a custom field into the defaults by sort order", () => {
    const fields = resolveFormFields([
      { id: "c1", source: "custom", default_key: null, label: "Bond", field_type: "text", sort_order: 0 },
      { id: "r1", source: "default", default_key: "sales_reference", sort_order: 1 },
    ])

    expect(fields[0].label).toBe("Bond")
    expect(fields[1].key).toBe("sales_reference")
  })

  it("ignores archived rows", () => {
    const fields = resolveFormFields([
      {
        id: "c1",
        source: "custom",
        default_key: null,
        label: "Retired field",
        field_type: "text",
        archived_at: "2026-09-01T00:00:00Z",
      },
      { id: "r1", source: "default", default_key: "client_name", label: "Agency", archived_at: "2026-09-01T00:00:00Z" },
    ])

    expect(fields.some((f) => f.label === "Retired field")).toBe(false)
    // An archived customization row leaves the default at its built-in label,
    // rather than applying an override nobody can see any more.
    expect(fields.find((f) => f.key === "client_name").label).toBe("Company")
  })
})

describe("which registration fields the builder may touch", () => {
  it("knows the built-in keys, and nothing else", () => {
    expect(isFormDefaultKey("client_name")).toBe(true)
    expect(isFormDefaultKey("deal_owner_id")).toBe(false)
    expect(isFormDefaultKey("po_date")).toBe(false)
  })

  it("leaves Ownership out entirely — absence is how it stays out of scope", () => {
    for (const key of ["deal_owner_id", "closing_sales_id", "sales_director_id", "support_sales_1_id", "support_sales_2_id"]) {
      expect(isFormDefaultKey(key)).toBe(false)
    }
  })

  it("does not offer ITB Number — it has never been on the registration form", () => {
    expect(isFormDefaultKey("itb_number")).toBe(false)
  })

  it("marks the fields registration cannot complete without as core", () => {
    for (const key of ["client_name", "contact_person", "project_title", "lead_source"]) {
      expect(isCoreFormField(key), key).toBe(true)
    }
    for (const key of ["sales_reference", "expected_award_date", "lead_source_detail"]) {
      expect(isCoreFormField(key), key).toBe(false)
    }
  })
})
