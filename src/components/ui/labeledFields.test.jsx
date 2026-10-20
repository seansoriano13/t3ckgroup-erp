import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Input } from "./input"
import { Textarea } from "./textarea"
import { SelectField } from "./SelectField"

describe("labelled field card", () => {
  it("names an input, a text area and a select by their label", () => {
    render(
      <>
        <Input label="Product" defaultValue="" />
        <Textarea label="Details" defaultValue="" />
        <SelectField label="Unit" options={[{ value: "pc", label: "pc" }]} value="pc" onChange={() => {}} />
      </>,
    )
    expect(screen.getByLabelText("Product")).toBeInTheDocument()
    expect(screen.getByLabelText("Details")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Unit" })).toBeInTheDocument()
    expect(screen.getByText("Details")).toHaveClass("font-bold")
  })
})
