import { waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useRequestUnits } from "./useRequestUnits"
import { REQUEST_UNITS } from "../constants/procurement"
import { renderHookWithQuery } from "@/test/support"
import { db } from "@/test/db/store"

/**
 * The Unit dropdown on a Purchasing Request: the units the business set, in its order, only the ones that
 * are on. A request can always be raised, so an empty or unreadable list falls back to the built-in units.
 */
describe("useRequestUnits", () => {
  it("offers the built-in units when the business has not set any", async () => {
    const { result } = renderHookWithQuery(() => useRequestUnits())

    expect(result.current.units).toEqual(REQUEST_UNITS)
    expect(result.current.defaultUnit).toBe(REQUEST_UNITS[0])
  })

  it("offers the units that are on, in the business's order, and starts a new item on the first", async () => {
    db.seed("request_units", [
      { label: "carton", sort: 10, active: true },
      { label: "unit", sort: 20, active: true },
      { label: "pc", sort: 30, active: false },
    ])

    const { result } = renderHookWithQuery(() => useRequestUnits())

    await waitFor(() => expect(result.current.units).toEqual(["carton", "unit"]))
    expect(result.current.defaultUnit).toBe("carton")
    expect(result.current.options).toEqual([
      { value: "carton", label: "carton" },
      { value: "unit", label: "unit" },
    ])
  })

  it("keeps the unit an item already holds in the list, even when it has been switched off", async () => {
    db.seed("request_units", [
      { label: "unit", sort: 10, active: true },
      { label: "pc", sort: 20, active: false },
    ])

    const { result } = renderHookWithQuery(() => useRequestUnits("pc"))

    await waitFor(() => expect(result.current.units).toEqual(["unit", "pc"]))
    // It is only shown, never the starting unit of a new item.
    expect(result.current.defaultUnit).toBe("unit")
  })

  it("does not list the same unit twice when the item's unit is already on", async () => {
    db.seed("request_units", [{ label: "Unit", sort: 10, active: true }])

    const { result } = renderHookWithQuery(() => useRequestUnits("unit"))

    await waitFor(() => expect(result.current.units).toEqual(["Unit"]))
  })
})
