import { createRef } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { setupUser } from "@/test/support"

import { FileInput } from "./FileInput"

const pdf = (name = "quote.pdf") => new File(["x"], name, { type: "application/pdf" })
const fileField = (container) => container.querySelector('input[type="file"]')

describe("FileInput", () => {
  it("hands the chosen files to onFiles as an array", async () => {
    const user = setupUser()
    const onFiles = vi.fn()
    const { container } = render(<FileInput multiple onFiles={onFiles}>Attach</FileInput>)
    await user.upload(fileField(container), [pdf("a.pdf"), pdf("b.pdf")])
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0].map((f) => f.name)).toEqual(["a.pdf", "b.pdf"])
  })

  it("opens the picker from its trigger button", async () => {
    const user = setupUser()
    const { container } = render(<FileInput onFiles={() => {}}>Attach file</FileInput>)
    const clicked = vi.fn()
    fileField(container).addEventListener("click", clicked)
    await user.click(screen.getByRole("button", { name: "Attach file" }))
    expect(clicked).toHaveBeenCalled()
  })

  it("passes accept and multiple to the input", () => {
    const { container } = render(<FileInput accept="image/*" multiple onFiles={() => {}}>Pick</FileInput>)
    expect(fileField(container)).toHaveAttribute("accept", "image/*")
    expect(fileField(container)).toHaveAttribute("multiple")
  })

  it("can be opened from outside through its ref, with no visible trigger", async () => {
    const ref = createRef()
    const { container } = render(<FileInput ref={ref} onFiles={() => {}} />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    const clicked = vi.fn()
    fileField(container).addEventListener("click", clicked)
    ref.current.click()
    expect(clicked).toHaveBeenCalled()
  })

  it("does not open or report files when disabled", async () => {
    const user = setupUser()
    const onFiles = vi.fn()
    render(<FileInput disabled onFiles={onFiles}>Attach</FileInput>)
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Attach" }))
    expect(onFiles).not.toHaveBeenCalled()
  })

  it("fires again when the same file is picked twice", async () => {
    const user = setupUser()
    const onFiles = vi.fn()
    const { container } = render(<FileInput onFiles={onFiles}>Attach</FileInput>)
    const file = pdf()
    await user.upload(fileField(container), file)
    await user.upload(fileField(container), file)
    expect(onFiles).toHaveBeenCalledTimes(2)
  })
})
