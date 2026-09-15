import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import LogTaskAssignmentBar from "./LogTaskAssignmentBar"

const USER = { id: "emp-1", name: "Ana Reyes" }
const EMPLOYEES = [
  { id: "emp-1", name: "Ana Reyes" },
  { id: "emp-2", name: "Ben Cruz" },
]

function renderBar(props) {
  return render(
    <LogTaskAssignmentBar
      formData={{ loggedById: "emp-1" }}
      setFormData={vi.fn()}
      roles={{ isHr: false, isHead: false }}
      availableHeads={[]}
      hrDeptFilter=""
      setHrDeptFilter={vi.fn()}
      hrSubDeptFilter=""
      setHrSubDeptFilter={vi.fn()}
      uniqueDepts={[]}
      uniqueSubDepts={[]}
      filteredEmployees={EMPLOYEES}
      selectedHead={null}
      setSelectedHead={vi.fn()}
      assignmentRef={{ current: null }}
      user={USER}
      openPopover={null}
      onTogglePopover={vi.fn()}
      {...props}
    />,
  )
}

describe("LogTaskAssignmentBar", () => {
  // Issue: adding an Individual Task action from the Flow Canvas showed only
  // Report To — an editor who is neither HR nor a Head had no way to name who
  // the automation assigns the task to, and it silently defaulted to
  // whoever happened to be editing the flow (`loggedById: user.id`).
  it("offers Assign To in automation mode even for a non-HR, non-Head editor", () => {
    renderBar({ roles: { isHr: false, isHead: false }, mode: "automation" })

    expect(screen.getByText("Assign To")).toBeInTheDocument()
  })

  it("still hides Assign To for a normal, non-HR, non-Head user logging their own task", () => {
    renderBar({ roles: { isHr: false, isHead: false }, mode: "normal" })

    expect(screen.queryByText("Assign To")).not.toBeInTheDocument()
  })
})
