import { useState } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { setupUser } from "@/test/support"

import { Select } from "./select"
import Dropdown from "./Dropdown"

const OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]

function Controlled({ initial = null, ...props }) {
  const [value, setValue] = useState(initial)
  return <Select aria-label="Priority" options={OPTIONS} value={value} onChange={setValue} {...props} />
}

describe("Select", () => {
  it("shows the placeholder until something is chosen", () => {
    render(<Controlled placeholder="Pick a priority" />)
    expect(screen.getByRole("combobox", { name: "Priority" })).toHaveTextContent("Pick a priority")
  })

  it("chooses an option and shows its label", async () => {
    const user = setupUser()
    render(<Controlled placeholder="Pick a priority" />)
    await user.click(screen.getByRole("combobox", { name: "Priority" }))
    await user.click(await screen.findByRole("option", { name: "High" }))
    expect(screen.getByRole("combobox", { name: "Priority" })).toHaveTextContent("High")
  })

  it("calls onChange with the option's value, not its label", async () => {
    const user = setupUser()
    const onChange = vi.fn()
    render(<Select aria-label="Priority" options={OPTIONS} value="low" onChange={onChange} />)
    await user.click(screen.getByRole("combobox", { name: "Priority" }))
    await user.click(await screen.findByRole("option", { name: "Medium" }))
    expect(onChange).toHaveBeenCalledWith("medium")
  })

  it("shows the controlled value's label", () => {
    render(<Select aria-label="Priority" options={OPTIONS} value="medium" onChange={() => {}} />)
    expect(screen.getByRole("combobox", { name: "Priority" })).toHaveTextContent("Medium")
  })

  it("picks with the keyboard: open, arrow down, Enter", async () => {
    const user = setupUser()
    render(<Controlled initial="low" />)
    const box = screen.getByRole("combobox", { name: "Priority" })
    box.focus()
    await user.keyboard("{Enter}")
    await screen.findByRole("option", { name: "Medium" })
    await user.keyboard("{ArrowDown}{Enter}")
    expect(box).toHaveTextContent("Medium")
  })

  it("does not open when disabled", async () => {
    const user = setupUser()
    render(<Controlled disabled initial="low" />)
    const box = screen.getByRole("combobox", { name: "Priority" })
    await user.click(box)
    expect(screen.queryByRole("option", { name: "High" })).not.toBeInTheDocument()
  })

  it("skips options marked disabled", async () => {
    const user = setupUser()
    const onChange = vi.fn()
    render(
      <Select
        aria-label="Priority"
        options={[...OPTIONS, { value: "urgent", label: "Urgent", disabled: true }]}
        value="low"
        onChange={onChange}
      />
    )
    await user.click(screen.getByRole("combobox", { name: "Priority" }))
    await user.click(await screen.findByRole("option", { name: "Urgent" }))
    expect(onChange).not.toHaveBeenCalled()
  })

  describe("inside a Dropdown popover", () => {
    // A Select's list is portaled to <body>, a DOM sibling of the Dropdown's
    // popover. A naive outside-click check treats a pick as a click outside and
    // closes the Dropdown before the pick registers.
    it("picks an option without closing the outer popover", async () => {
      const user = setupUser()
      const onChange = vi.fn()
      render(
        <Dropdown trigger={<button>Filters</button>}>
          <p>Filter panel</p>
          <Select aria-label="Priority" options={OPTIONS} value="low" onChange={onChange} />
        </Dropdown>
      )
      await user.click(screen.getByRole("button", { name: "Filters" }))
      expect(screen.getByText("Filter panel")).toBeInTheDocument()

      await user.click(screen.getByRole("combobox", { name: "Priority" }))
      await user.click(await screen.findByRole("option", { name: "High" }))

      expect(onChange).toHaveBeenCalledWith("high")
      expect(screen.getByText("Filter panel")).toBeInTheDocument()
    })
  })
})

describe("Select with an empty-string value", () => {
  it("treats '' as nothing chosen and shows the placeholder", () => {
    render(<Select aria-label="Priority" options={OPTIONS} value="" onChange={() => {}} placeholder="Pick one" />)
    expect(screen.getByRole("combobox", { name: "Priority" })).toHaveTextContent("Pick one")
  })

  it("still shows an option that really has the '' value", () => {
    render(
      <Select
        aria-label="Move"
        options={[{ value: "", label: "Add a move to…" }, { value: "a", label: "Alpha" }]}
        value=""
        onChange={() => {}}
      />
    )
    expect(screen.getByRole("combobox", { name: "Move" })).toHaveTextContent("Add a move to…")
  })
})
