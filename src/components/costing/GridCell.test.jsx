/**
 * Issue #900 — a Costing cell names the rule it broke. A negative amount says it
 * must be zero or more; a zero where a number must be above zero says that.
 * Nothing saves on a refusal.
 */
import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent } from "@testing-library/react"

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


describe("Cell number box (#1039)", () => {
  it("is a text box with a decimal keypad, so the wheel changes nothing", async () => {
    renderWithProviders(<Cell label="Cost" numeric money value={100} onSave={vi.fn()} />)
    const box = screen.getByLabelText("Cost")
    expect(box).toHaveAttribute("type", "text")
    expect(box).toHaveAttribute("inputmode", "decimal")

    await setupUser().click(box)
    fireEvent.wheel(box, { deltaY: -100 })
    expect(box).toHaveValue("100")
  })

  it.each(["13,199.89", "13199.89"])("saves %s as 13199.89", async (typed) => {
    const onSave = vi.fn()
    renderWithProviders(<Cell label="Cost" numeric money value={null} onSave={onSave} />)
    const user = setupUser()

    await user.type(screen.getByLabelText("Cost"), typed)
    await user.tab()

    expect(onSave).toHaveBeenCalledWith(13199.89)
  })

  it("shows a money value with commas and two decimals at rest, and the plain number when focused", async () => {
    renderWithProviders(<Cell label="Cost" numeric money value={13199.89} onSave={vi.fn()} />)
    const user = setupUser()
    const box = screen.getByLabelText("Cost")

    expect(box).toHaveValue("13,199.89")
    await user.click(box)
    expect(box).toHaveValue("13199.89")
    await user.tab()
    expect(box).toHaveValue("13,199.89")
  })

  it("leaves a non-money number plain", () => {
    renderWithProviders(<Cell label="Qty" numeric value={12000} onSave={vi.fn()} />)
    expect(screen.getByLabelText("Qty")).toHaveValue("12000")
  })
})
