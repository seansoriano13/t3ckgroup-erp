/**
 * Issue #900 — a Costing cell names the rule it broke. A negative amount says it
 * must be zero or more; a zero where a number must be above zero says that.
 * Nothing saves on a refusal.
 */
import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"

import { renderWithProviders, setupUser } from "../../test/support"
import { Cell } from "./GridCell"

describe("Cell validation messages (#900)", () => {
  it("says an amount must be zero or more when it is negative, and does not save", async () => {
    const onSave = vi.fn()
    renderWithProviders(<Cell label="ABC 1" noun="ABC" numeric money value={null} onSave={onSave} />)
    const user = setupUser()

    await user.type(screen.getByLabelText("ABC 1"), "-5000")
    await user.tab()

    expect(await screen.findByRole("alert")).toHaveTextContent("ABC must be zero or more.")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("says a zero must be more than zero where a number is required, and does not save", async () => {
    const onSave = vi.fn()
    renderWithProviders(<Cell label="Qty 1" noun="Qty" numeric required value={null} onSave={onSave} />)
    const user = setupUser()

    await user.type(screen.getByLabelText("Qty 1"), "0")
    await user.tab()

    expect(await screen.findByRole("alert")).toHaveTextContent("Qty must be more than zero.")
    expect(onSave).not.toHaveBeenCalled()
  })
})
