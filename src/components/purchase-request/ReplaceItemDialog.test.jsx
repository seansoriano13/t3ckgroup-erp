/**
 * "Replace a product" (#687): product B is picked from Odoo's product list, or typed when Odoo has
 * none. A pick sends its Odoo id; typing after a pick drops it.
 */
import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { stubRpc, stubEdgeFunction } from "@/test/msw/server"
import ReplaceItemDialog from "./ReplaceItemDialog"

vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

const item = { id: "item-1", name: "Old harness", sor_item_id: null }

function setup() {
  const calls = []
  stubRpc("purchase_request_replace_item", (args) => {
    calls.push(args)
    return "new-item"
  })
  stubEdgeFunction("odoo-product-search", () => ({
    success: true,
    products: [{ id: 555, name: "Full Body Harness XL", code: "FBH-XL" }],
  }))
  renderWithProviders(<ReplaceItemDialog open onOpenChange={() => {}} item={item} requestId="req-1" />)
  return { calls, user: setupUser() }
}

/** The dialog moves focus into itself as it opens; let that settle before typing. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 100))
}

describe("ReplaceItemDialog", () => {
  it("sends the Odoo product id when product B is picked from the list", async () => {
    const { calls, user } = setup()
    await settle()
    await user.type(screen.getByRole("combobox", { name: "Replace with" }), "harness")
    await user.click(await screen.findByRole("button", { name: /Full Body Harness XL/ }))
    await user.type(screen.getByPlaceholderText(/Why it is being replaced/), "Out of stock")
    await user.click(screen.getByRole("button", { name: "Replace product" }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ p_name: "Full Body Harness XL", p_odoo_product_id: 555 })
  })

  it("sends no Odoo id for a typed product", async () => {
    const { calls, user } = setup()
    await settle()
    await user.type(screen.getByRole("combobox", { name: "Replace with" }), "Local harness")
    await user.type(screen.getByPlaceholderText(/Why it is being replaced/), "Cheaper")
    await user.click(screen.getByRole("button", { name: "Replace product" }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].p_odoo_product_id).toBeUndefined()
  })
})
