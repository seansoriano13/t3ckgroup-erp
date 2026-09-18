import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import TaskRow from "./TaskRow"

afterEach(cleanup)

function individualRow(overrides = {}) {
  return {
    id: "task-1",
    kind: "individual",
    entityType: "TASK",
    title: "Confirm delivery address",
    dueDate: "2026-03-05T00:00:00Z",
    members: [{ id: "task-1", name: "Ana", avatarPath: null, role: "Assignee", part: "Call the client", done: false }],
    doneCount: 0,
    totalCount: 1,
    ...overrides,
  }
}

function groupRow(overrides = {}) {
  return {
    id: "gtask-1",
    kind: "group",
    entityType: "GROUP_TASK",
    title: "Prepare BOQ",
    dueDate: "2026-03-10T00:00:00Z",
    members: [
      { id: "m1", name: "Ben", avatarPath: null, role: "Engineer", part: "Draft the BOQ", done: true },
      { id: "m2", name: "Cara", avatarPath: null, role: "Reviewer", part: "Review pricing", done: false },
    ],
    doneCount: 1,
    totalCount: 2,
    ...overrides,
  }
}

describe("TaskRow", () => {
  it("renders its title", () => {
    render(<TaskRow row={individualRow()} />)
    expect(screen.getByText("Confirm delivery address")).toBeInTheDocument()
  })

  it("shows parts-done count and due date", () => {
    render(<TaskRow row={groupRow()} />)
    expect(screen.getByText("1/2")).toBeInTheDocument()
    expect(screen.getByText("Mar 10")).toBeInTheDocument()
  })

  it("dispatches OPEN_ENTITY_DETAILS with the row's id and entity type when the title is clicked", () => {
    const handler = vi.fn()
    window.addEventListener("OPEN_ENTITY_DETAILS", handler)
    render(<TaskRow row={groupRow()} />)

    fireEvent.click(screen.getByTitle("Prepare BOQ"))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].detail).toEqual({ id: "gtask-1", type: "GROUP_TASK" })
    window.removeEventListener("OPEN_ENTITY_DETAILS", handler)
  })

  it("does not offer to expand an individual task", () => {
    render(<TaskRow row={individualRow()} />)
    expect(screen.queryByLabelText(/Expand/)).not.toBeInTheDocument()
  })

  it("expands a group task to show each member's role, part, and status", () => {
    render(<TaskRow row={groupRow()} />)

    expect(screen.queryByText("Ben")).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Expand Prepare BOQ"))

    expect(screen.getByText("Ben")).toBeInTheDocument()
    expect(screen.getByText("(Engineer)")).toBeInTheDocument()
    expect(screen.getByText("Draft the BOQ")).toBeInTheDocument()
    expect(screen.getByText("Done")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Collapse Prepare BOQ"))
    expect(screen.queryByText("Ben")).not.toBeInTheDocument()
  })

  it("collapses the avatar list into a +N chip past the max", () => {
    const row = groupRow({
      members: Array.from({ length: 6 }, (_, i) => ({
        id: `m${i}`,
        name: `Member ${i}`,
        avatarPath: null,
        role: "Assignee",
        part: "",
        done: false,
      })),
      doneCount: 0,
      totalCount: 6,
    })
    render(<TaskRow row={row} />)
    expect(screen.getByText("+2")).toBeInTheDocument()
  })
})
