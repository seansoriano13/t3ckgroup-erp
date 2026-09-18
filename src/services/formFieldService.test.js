import { beforeEach, describe, expect, it } from "vitest"
import { formFieldService } from "./formFieldService"
import { makeEmployee, makeOpportunity, makeSaleType, makeSalesFlow } from "@/test/factories"

/**
 * The registration form's per-flow customization (`flow_form_fields`).
 *
 * Rows are created through the service rather than a factory, so the shape
 * under test is the shape the app actually writes. The pure resolution logic
 * — how these rows become a form — is covered in constants/sorFormBuilder.test.js.
 */
describe("formFieldService", () => {
  let admin
  let saleType
  let flow

  beforeEach(() => {
    admin = makeEmployee({ name: "Admin Ana" })
    saleType = makeSaleType()
    flow = makeSalesFlow({ sale_type_id: saleType.id })
  })

  describe("customizing a built-in default", () => {
    it("stores a row only for the default that was changed", async () => {
      await formFieldService.customizeDefault(
        { flowId: flow.id, defaultKey: "client_name", label: "Agency" },
        admin.id,
      )

      const rows = await formFieldService.getForFlow(flow.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].default_key).toBe("client_name")
      expect(rows[0].label).toBe("Agency")
      expect(rows[0].source).toBe("default")
    })

    it("edits the same row when the same default is customized twice", async () => {
      await formFieldService.customizeDefault(
        { flowId: flow.id, defaultKey: "client_name", label: "Agency" },
        admin.id,
      )
      await formFieldService.customizeDefault(
        { flowId: flow.id, defaultKey: "client_name", label: "Buyer" },
        admin.id,
      )

      const rows = await formFieldService.getForFlow(flow.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].label).toBe("Buyer")
    })

    it("refuses to hide a field registration cannot complete without", async () => {
      await expect(
        formFieldService.customizeDefault(
          { flowId: flow.id, defaultKey: "client_name", isHidden: true },
          admin.id,
        ),
      ).rejects.toThrow(/required to register/)
    })

    it("refuses to make a core field optional", async () => {
      await expect(
        formFieldService.customizeDefault(
          { flowId: flow.id, defaultKey: "project_title", isRequired: false },
          admin.id,
        ),
      ).rejects.toThrow(/required to register/)
    })

    it("allows a core field to be renamed and reordered", async () => {
      const row = await formFieldService.customizeDefault(
        { flowId: flow.id, defaultKey: "contact_person", label: "Focal Person", sortOrder: 0 },
        admin.id,
      )

      expect(row.label).toBe("Focal Person")
      expect(row.sort_order).toBe(0)
    })

    it("hides an optional field", async () => {
      const row = await formFieldService.customizeDefault(
        { flowId: flow.id, defaultKey: "expected_award_date", isHidden: true },
        admin.id,
      )

      expect(row.is_hidden).toBe(true)
    })

    it("refuses a key that is not on the registration form at all", async () => {
      await expect(
        formFieldService.customizeDefault(
          { flowId: flow.id, defaultKey: "deal_owner_id", label: "Owner" },
          admin.id,
        ),
      ).rejects.toThrow(/not a field on the registration form/)
    })
  })

  describe("custom fields", () => {
    it("appends a custom field after the existing rows", async () => {
      await formFieldService.customizeDefault(
        { flowId: flow.id, defaultKey: "client_name", label: "Agency" },
        admin.id,
      )

      const field = await formFieldService.addCustom(
        { flowId: flow.id, label: "Bid Bond Reference", fieldType: "text" },
        admin.id,
      )

      expect(field.source).toBe("custom")
      expect(field.default_key).toBeNull()
      expect(field.sort_order).toBe(1)
    })

    it("refuses a field type it cannot render", async () => {
      await expect(
        formFieldService.addCustom({ flowId: flow.id, label: "Bond", fieldType: "signature" }, admin.id),
      ).rejects.toThrow(/Field type must be one of/)
    })

    it("refuses a blank label", async () => {
      await expect(
        formFieldService.addCustom({ flowId: flow.id, label: "   ", fieldType: "text" }, admin.id),
      ).rejects.toThrow(/needs a label/)
    })

    it("archives and restores a custom field", async () => {
      const field = await formFieldService.addCustom(
        { flowId: flow.id, label: "Bond", fieldType: "text" },
        admin.id,
      )

      await formFieldService.archiveCustom(field.id, admin.id)
      expect(await formFieldService.getForFlow(flow.id)).toHaveLength(0)

      await formFieldService.restoreCustom(field.id, admin.id)
      expect(await formFieldService.getForFlow(flow.id)).toHaveLength(1)
    })

    it("refuses to edit a default through the custom path", async () => {
      const row = await formFieldService.customizeDefault(
        { flowId: flow.id, defaultKey: "client_name", label: "Agency" },
        admin.id,
      )

      await expect(
        formFieldService.updateCustom(row.id, { label: "Buyer" }, admin.id),
      ).rejects.toThrow(/customizeDefault/)
    })

    it("refuses options on a field that has none", async () => {
      const field = await formFieldService.addCustom(
        { flowId: flow.id, label: "Bond", fieldType: "text" },
        admin.id,
      )

      await expect(
        formFieldService.updateCustom(field.id, { options: ["Yes"] }, admin.id),
      ).rejects.toThrow(/choice field/)
    })
  })

  describe("restoring the default form", () => {
    it("deletes every customization the flow has, leaving nothing to resolve", async () => {
      await formFieldService.customizeDefault(
        { flowId: flow.id, defaultKey: "client_name", label: "Agency" },
        admin.id,
      )
      await formFieldService.addCustom({ flowId: flow.id, label: "Bond", fieldType: "text" }, admin.id)

      await formFieldService.restoreDefaults(flow.id, admin.id)

      expect(await formFieldService.getForFlow(flow.id, { includeArchived: true })).toEqual([])
    })

    it("leaves another flow's form alone", async () => {
      const otherSaleType = makeSaleType({ name: "Private" })
      const otherFlow = makeSalesFlow({ sale_type_id: otherSaleType.id })
      await formFieldService.addCustom({ flowId: otherFlow.id, label: "Keep me", fieldType: "text" }, admin.id)
      await formFieldService.addCustom({ flowId: flow.id, label: "Drop me", fieldType: "text" }, admin.id)

      await formFieldService.restoreDefaults(flow.id, admin.id)

      const survivors = await formFieldService.getForFlow(otherFlow.id)
      expect(survivors.map((r) => r.label)).toEqual(["Keep me"])
    })
  })

  describe("getForSaleType", () => {
    it("finds the flow's rows from the Sale Type the form knows about", async () => {
      await formFieldService.addCustom({ flowId: flow.id, label: "Bond", fieldType: "text" }, admin.id)

      const rows = await formFieldService.getForSaleType(saleType.id)

      expect(rows.map((r) => r.label)).toEqual(["Bond"])
    })

    it("returns nothing, rather than throwing, for a Sale Type with no flow", async () => {
      const orphan = makeSaleType({ name: "Nothing drawn yet" })

      expect(await formFieldService.getForSaleType(orphan.id)).toEqual([])
    })

    it("returns nothing for no Sale Type at all", async () => {
      expect(await formFieldService.getForSaleType(null)).toEqual([])
    })
  })

  describe("registration answers", () => {
    it("saves only the answers that were given", async () => {
      const field = await formFieldService.addCustom(
        { flowId: flow.id, label: "Bond", fieldType: "text" },
        admin.id,
      )
      const opportunity = makeOpportunity({ registered_by: admin.id })

      await formFieldService.saveValues(opportunity.id, { [field.id]: "BB-001" }, admin.id)

      const values = await formFieldService.getValuesFor(opportunity.id)
      expect(values[field.id]).toBe("BB-001")
      expect(Object.keys(values)).toHaveLength(1)
    })

    it("writes nothing when every answer is blank", async () => {
      expect(await formFieldService.saveValues("any-id", { a: "", b: null }, admin.id)).toEqual([])
    })
  })
})
