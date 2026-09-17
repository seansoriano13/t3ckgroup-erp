import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { setupUser } from "@/test/support"
import TemplateVariableChips from "./TemplateVariableChips"

describe("TemplateVariableChips", () => {
  it("calls onInsert with the {{key}} token for the clicked variable", async () => {
    const user = setupUser()
    const onInsert = vi.fn()
    render(<TemplateVariableChips value="" onInsert={onInsert} />)

    await user.click(screen.getByRole("button", { name: /SO Number/ }))

    expect(onInsert).toHaveBeenCalledWith("{{so_number}}")
  })

  it("shows no preview when the field is empty", () => {
    render(<TemplateVariableChips value="" onInsert={() => {}} />)
    expect(screen.queryByText("Preview")).toBeNull()
  })

  it("renders the preview against sample data, coloring substituted values", () => {
    render(<TemplateVariableChips value="Approve {{so_number}}" onInsert={() => {}} />)

    expect(screen.getByText("Preview")).toBeInTheDocument()
    expect(screen.getByText("S01234")).toBeInTheDocument()
  })
})
