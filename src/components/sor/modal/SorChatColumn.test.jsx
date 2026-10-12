/**
 * #475 — a Stage Visit the viewer cannot read shows in the timeline as a
 * placeholder naming the Stage and why, not as a silent gap.
 */
import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../test/support"
import SorChatColumn from "./SorChatColumn"

const baseProps = {
  loadingNotes: false,
  handleMentionClick: () => {},
  note: "",
  setNote: () => {},
  noteMentions: [],
  setNoteMentions: () => {},
  employees: [],
  attachments: { files: [], isUploading: false, addFiles: () => {}, removeFile: () => {}, max: 5 },
  fileInputRef: { current: null },
  isPosting: false,
  handlePostNote: () => {},
}

const notes = [
  { id: "n1", type: "COMMENT", content: "Before costing", created_at: "2026-10-01T05:00:00Z", author: { name: "Ana" } },
  { id: "n2", type: "COMMENT", content: "After costing", created_at: "2026-10-03T05:00:00Z", author: { name: "Ana" } },
]

describe("SorChatColumn — hidden visits", () => {
  it("marks a hidden visit between the notes around it", () => {
    renderWithProviders(
      <SorChatColumn
        {...baseProps}
        notes={notes}
        hiddenVisits={[{ id: "v2", stageName: "Costing", enteredAt: "2026-10-02T00:00:00Z", reason: "not_shared" }]}
      />,
    )
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(rows[0]).toContain("Before costing")
    expect(rows[1]).toContain("Notes from Costing · not shared with you")
    expect(rows[2]).toContain("After costing")
  })

  it("says restricted for a Restricted Stage", () => {
    renderWithProviders(
      <SorChatColumn
        {...baseProps}
        notes={[]}
        hiddenVisits={[{ id: "v2", stageName: "Costing", enteredAt: "2026-10-02T00:00:00Z", reason: "restricted" }]}
      />,
    )
    expect(screen.getByText(/· restricted/)).toBeInTheDocument()
    expect(screen.queryByText("No notes yet.")).not.toBeInTheDocument()
  })

  it("shows no placeholder when nothing is hidden", () => {
    renderWithProviders(<SorChatColumn {...baseProps} notes={notes} />)
    expect(screen.queryByText(/Notes from/)).not.toBeInTheDocument()
  })
})
