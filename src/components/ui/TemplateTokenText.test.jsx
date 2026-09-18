import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import TemplateTokenText from "./TemplateTokenText"

describe("TemplateTokenText", () => {
  it("masks a recognized token as its label, not the raw {{key}}", () => {
    render(<TemplateTokenText text="{{so_number}} Evaluation" />)
    expect(screen.getByText("SO Number")).toBeInTheDocument()
    expect(screen.queryByText(/\{\{so_number\}\}/)).toBeNull()
  })

  it("renders plain text with no tokens unchanged", () => {
    render(<TemplateTokenText text="PMS - Evaluation" />)
    expect(screen.getByText("PMS - Evaluation")).toBeInTheDocument()
  })

  it("falls back to the raw key for an unrecognized token, not the full {{unknown_key}} syntax", () => {
    const { container } = render(<TemplateTokenText text="{{unknown_key}} title" />)
    expect(container.textContent).toBe("unknown_key title")
  })
})
