import userEvent from "@testing-library/user-event"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DocumentCenterTab from "./DocumentCenterTab"
import { makeEmployee } from "@/test/factories"

const mockEmployee = makeEmployee({ name: "Testing Employee" })
const sampleRecord = {
  id: "rec_1",
  type: "OFFSET",
  status: "APPROVED",
  hours: 8,
  date: "2026-08-15",
  employee: mockEmployee
}

describe("DocumentCenterTab", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it("survives a reload and does not clear a stored tray when records are initially empty", async () => {
    // 1. Manually populate localStorage as if the user had previously staged a record.
    localStorage.setItem("documentCenterTray:v1", JSON.stringify([sampleRecord]))

    // 2. Mount with empty records (simulating loading state or different month view)
    const { rerender } = render(
      <DocumentCenterTab
        approvedRecords={[]}
        allLoadedRecords={[]}
        hrId="hr_1"
        onPrinted={vi.fn()}
      />
    )

    // Wait for initial render
    await waitFor(() => {
      // The print order should hold the 1 item from localStorage
      expect(screen.getByText("1 form queued")).toBeInTheDocument()
    })
    expect(screen.getByText("Testing Employee")).toBeInTheDocument()

    // 3. Rerender with records present (e.g. data finishes loading for the month)
    rerender(
      <DocumentCenterTab
        approvedRecords={[sampleRecord]}
        allLoadedRecords={[sampleRecord]}
        hrId="hr_1"
        onPrinted={vi.fn()}
      />
    )

    // The item should STILL be in the tray, unharmed.
    expect(screen.getByText("1 form queued")).toBeInTheDocument()
    expect(screen.getAllByText("Testing Employee").length).toBeGreaterThan(0)
    
    // Verify it wasn't cleared from localStorage
    const saved = JSON.parse(localStorage.getItem("documentCenterTray:v1"))
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe("rec_1")
  })

  it("offers an LWOP record and queues it for printing (#621)", async () => {
    const lwop = { ...sampleRecord, id: "rec_lwop", type: "LWOP", leave_group_id: "g1" }
    render(<DocumentCenterTab approvedRecords={[lwop]} allLoadedRecords={[lwop]} hrId="hr_1" onPrinted={vi.fn()} />)

    expect(screen.getByText(/LWOP/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("checkbox", { name: /LWOP record to the tray/ }))
    await waitFor(() => expect(screen.getByText("1 form queued")).toBeInTheDocument())
  })

  it("drops a genuinely removed record (decision undone)", async () => {
    localStorage.setItem("documentCenterTray:v1", JSON.stringify([sampleRecord]))
    
    // Simulating viewing the month where the record exists, but it's no longer approved.
    // It's in allLoadedRecords (e.g., as pending), but not in approvedRecords.
    const undoneRecord = { ...sampleRecord, status: "PENDING" }
    
    render(
      <DocumentCenterTab
        approvedRecords={[]}
        allLoadedRecords={[undoneRecord]}
        hrId="hr_1"
        onPrinted={vi.fn()}
      />
    )

    // The effect runs and drops the undone record.
    await waitFor(() => {
      expect(screen.getByText("0 forms queued")).toBeInTheDocument()
    })
    
    // Verify it was cleared from localStorage
    const saved = JSON.parse(localStorage.getItem("documentCenterTray:v1"))
    expect(saved).toHaveLength(0)
  })

  it("uses Sentence-case step headings and the standard-size Print button", () => {
    render(
      <DocumentCenterTab approvedRecords={[]} allLoadedRecords={[]} hrId="hr_1" onPrinted={vi.fn()} />
    )

    for (const name of ["Choose records", "Set the order", "Check and print"]) {
      expect(screen.getByRole("heading", { name: new RegExp(name) })).toBeInTheDocument()
    }
    const print = screen.getByRole("button", { name: /print/i })
    expect(print.className).not.toMatch(/\bh-11\b|\bw-full\b/)
  })
})
