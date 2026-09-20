import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import { ExternalLink } from "./ExternalLink"

describe("ExternalLink", () => {
  it("is a link to the given address with its text", () => {
    render(<ExternalLink href="https://example.com/doc">Read the doc</ExternalLink>)
    const link = screen.getByRole("link", { name: "Read the doc" })
    expect(link).toHaveAttribute("href", "https://example.com/doc")
  })

  it("opens in a new tab without leaking the opener or referrer", () => {
    render(<ExternalLink href="https://example.com">Go</ExternalLink>)
    const link = screen.getByRole("link", { name: "Go" })
    expect(link).toHaveAttribute("target", "_blank")
    const rel = link.getAttribute("rel").split(/\s+/)
    expect(rel).toEqual(expect.arrayContaining(["noopener", "noreferrer"]))
  })

  it("cannot be turned into a same-tab or opener-leaking link by props", () => {
    render(<ExternalLink href="https://example.com" aria-label="Attachment"><img alt="" /></ExternalLink>)
    expect(screen.getByRole("link", { name: "Attachment" })).toHaveAttribute("target", "_blank")
  })
})
