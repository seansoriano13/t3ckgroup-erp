import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import BalancesTable from "./BalancesTable"

describe("BalancesTable", () => {
  it("shows the derived LWOP this month column in hours", () => {
    const employees = [
      { id: "e1", name: "Ana Reyes", department: "Sales", offset_hours_balance: 0, sil_hours_balance: 0, undertime_this_month: 0, lwop_this_month: 12 },
    ]
    render(<BalancesTable employees={employees} pendingLeaves={[]} onOpenPerson={() => {}} />)

    expect(screen.getByText("LWOP this month")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
  })
})
