import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import CalendarTab from "./CalendarTab"
import { makeEmployee } from "@/test/factories"

const emp = makeEmployee({ name: "Testing Employee" })
const approved = [{ id: "a1", type: "OFFSET", date: "2026-08-15", employee_id: emp.id, employee: emp, hours: 8 }]

const renderTab = (props = {}) =>
  render(<CalendarTab approvedLeaves={approved} pendingLeaves={[]} monthStart="2026-08-01" {...props} />)

describe("CalendarTab", () => {
  it("opens on the Month grid", () => {
    renderTab()
    expect(screen.getByText("Overview of all approved employee leaves")).toBeInTheDocument()
    expect(screen.queryByText(/with time off/)).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true")
  })

  it("switches to the People timeline and back", () => {
    renderTab()
    fireEvent.click(screen.getByRole("tab", { name: "People" }))
    expect(screen.getByText(/with time off/)).toBeInTheDocument()
    expect(screen.queryByText("Overview of all approved employee leaves")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: "Month" }))
    expect(screen.getByText("Overview of all approved employee leaves")).toBeInTheDocument()
  })

  it("can start on People", () => {
    renderTab({ initialView: "people" })
    expect(screen.getByText(/with time off/)).toBeInTheDocument()
  })
})
