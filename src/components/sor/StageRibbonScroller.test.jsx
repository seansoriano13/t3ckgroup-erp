/**
 * The stage ribbon hides its scrollbar and pages with arrows instead: an arrow
 * exists only on a side with more to reveal. jsdom does no layout, so the
 * strip's metrics are faked on the element.
 */
import { describe, it, expect, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"

import StageRibbonScroller from "./StageRibbonScroller"

function renderStrip({ scrollWidth, clientWidth }) {
  const { container } = render(
    <StageRibbonScroller>
      <div>tiles</div>
    </StageRibbonScroller>,
  )
  const strip = container.querySelector(".scrollbar-hide")
  Object.defineProperty(strip, "scrollWidth", { configurable: true, value: scrollWidth })
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: clientWidth })
  strip.scrollBy = vi.fn()
  const scrollTo = (left) => {
    strip.scrollLeft = left
    act(() => {
      fireEvent.scroll(strip)
    })
  }
  return { strip, scrollTo }
}

describe("StageRibbonScroller", () => {
  it("shows no arrow when every stage already fits", () => {
    const { scrollTo } = renderStrip({ scrollWidth: 400, clientWidth: 400 })
    scrollTo(0)

    expect(screen.queryByRole("button", { name: /Scroll stages/ })).not.toBeInTheDocument()
  })

  it("offers only 'right' at the start, pages by most of the width, and offers 'left' once scrolled", () => {
    const { strip, scrollTo } = renderStrip({ scrollWidth: 1000, clientWidth: 400 })
    scrollTo(0)

    expect(screen.queryByRole("button", { name: "Scroll stages left" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Scroll stages right" }))
    expect(strip.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 280 }))

    scrollTo(300)
    expect(screen.getByRole("button", { name: "Scroll stages left" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Scroll stages right" })).toBeInTheDocument()
  })

  it("offers only 'left' at the end", () => {
    const { scrollTo } = renderStrip({ scrollWidth: 1000, clientWidth: 400 })
    scrollTo(600)

    expect(screen.getByRole("button", { name: "Scroll stages left" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Scroll stages right" })).not.toBeInTheDocument()
  })
})
