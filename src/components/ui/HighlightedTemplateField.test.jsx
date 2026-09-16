import { describe, it, expect, vi } from "vitest"
import { act, render } from "@testing-library/react"
import { createRef } from "react"
import HighlightedTemplateField, { buildDom, serializeDom } from "./HighlightedTemplateField"

describe("buildDom / serializeDom", () => {
  it("round-trips a string with a recognized token, masking it with its label", () => {
    const el = document.createElement("div")
    buildDom(el, "Hello {{so_number}} World")

    const chip = el.querySelector('[data-token-key="so_number"]')
    expect(chip).not.toBeNull()
    expect(chip.textContent).toBe("SO Number")
    expect(chip.getAttribute("contenteditable")).toBe("false")

    expect(serializeDom(el)).toBe("Hello {{so_number}} World")
  })

  it("round-trips an unrecognized token by its raw key, not silently dropping it", () => {
    const el = document.createElement("div")
    buildDom(el, "Foo {{unknown_key}} Bar")

    const chip = el.querySelector('[data-token-key="unknown_key"]')
    expect(chip.textContent).toBe("unknown_key")
    expect(serializeDom(el)).toBe("Foo {{unknown_key}} Bar")
  })

  it("round-trips newlines as <br> elements", () => {
    const el = document.createElement("div")
    buildDom(el, "Line one\nLine two")

    expect(el.querySelectorAll("br")).toHaveLength(1)
    expect(serializeDom(el)).toBe("Line one\nLine two")
  })

  it("round-trips multiple tokens back to back with no text between them", () => {
    const el = document.createElement("div")
    buildDom(el, "{{so_number}}{{project_title}}")

    expect(serializeDom(el)).toBe("{{so_number}}{{project_title}}")
  })

  it("renders a plain string with no tokens as plain text", () => {
    const el = document.createElement("div")
    buildDom(el, "Nothing special here")

    expect(el.querySelectorAll("[data-token-key]")).toHaveLength(0)
    expect(serializeDom(el)).toBe("Nothing special here")
  })
})

describe("HighlightedTemplateField", () => {
  it("masks a token from the initial value as its label, not the raw {{key}}", () => {
    const { container } = render(<HighlightedTemplateField value="{{so_number}} Eval" onChange={() => {}} />)
    const chip = container.querySelector('[data-token-key="so_number"]')
    expect(chip.textContent).toBe("SO Number")
    expect(container.textContent).not.toContain("{{so_number}}")
  })

  it("inserts a token via the ref with no leading space at the start of an empty field", () => {
    const onChange = vi.fn()
    const ref = createRef()
    render(<HighlightedTemplateField ref={ref} value="" onChange={onChange} />)

    act(() => ref.current.insertToken("{{so_number}}"))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: "{{so_number}}" }) }))
  })

  it("adds a real space between two tokens inserted back to back, rather than jamming them together", () => {
    const onChange = vi.fn()
    const ref = createRef()
    render(<HighlightedTemplateField ref={ref} value="" onChange={onChange} />)

    act(() => ref.current.insertToken("{{so_number}}"))
    act(() => ref.current.insertToken("{{project_title}}"))

    const lastCall = onChange.mock.calls.at(-1)[0]
    expect(lastCall.target.value).toBe("{{so_number}} {{project_title}}")
  })
})
