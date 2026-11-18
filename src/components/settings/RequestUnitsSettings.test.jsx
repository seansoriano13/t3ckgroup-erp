import { describe, it, expect, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { requestUnitService } from "@/services/requestUnitService"
import RequestUnitsSettings from "./RequestUnitsSettings"

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const seed = () =>
  db.seed("request_units", [
    { label: "unit", sort: 10, active: true },
    { label: "pc", sort: 20, active: true },
  ])

describe("Request units in Purchasing settings", () => {
  it("lists the units in order", async () => {
    seed()
    renderWithProviders(<RequestUnitsSettings />)

    const rows = await screen.findAllByTestId("request-unit-row")

    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("unit"), expect.stringContaining("pc")])
  })

  it("adds a unit", async () => {
    seed()
    renderWithProviders(<RequestUnitsSettings />)
    const user = setupUser()

    await user.type(await screen.findByLabelText("New unit"), "carton")
    await user.click(screen.getByRole("button", { name: "Add" }))

    await waitFor(() => expect(screen.getAllByTestId("request-unit-row")).toHaveLength(3))
    expect((await requestUnitService.list()).map((u) => u.label)).toEqual(["unit", "pc", "carton"])
  })

  it("switches a unit off, and it stays on the list", async () => {
    seed()
    renderWithProviders(<RequestUnitsSettings />)
    const user = setupUser()

    await user.click(await screen.findByRole("switch", { name: "pc is offered" }))

    await waitFor(async () => expect((await requestUnitService.list()).find((u) => u.label === "pc").active).toBe(false))
    expect(within(screen.getAllByTestId("request-unit-row")[1]).getByText("pc")).toBeInTheDocument()
  })

  it("moves a unit up", async () => {
    seed()
    renderWithProviders(<RequestUnitsSettings />)
    const user = setupUser()

    await user.click(await screen.findByRole("button", { name: "Move pc up" }))

    await waitFor(async () => expect((await requestUnitService.list()).map((u) => u.label)).toEqual(["pc", "unit"]))
  })
})
