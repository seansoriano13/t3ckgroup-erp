import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import StatusBadge from "./StatusBadge"

// SOR-list badges (staging, 2026-10-22): a Stage's own color is any Radix
// color name the flow canvas offers, but the badge only knew seven of them,
// so every other Stage read as gray (mauve).
describe("StatusBadge theme", () => {
  const CANVAS_COLORS = ["sky", "violet", "plum", "pink", "crimson", "indigo", "teal", "cyan", "jade", "lime", "gold", "yellow", "brown", "tomato"]

  it.each(CANVAS_COLORS)("colors a %s Stage with its own color, not gray", (color) => {
    render(<StatusBadge label="Stage" theme={color} />)

    const badge = screen.getByText("Stage")
    expect(badge.className).toContain(`text-${color}-`)
    expect(badge.className).not.toContain("text-muted-foreground")
  })
})
