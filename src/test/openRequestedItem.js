import { expect } from "vitest"
import userEvent from "@testing-library/user-event"
import { screen, waitFor, within } from "@testing-library/react"

/** Opens a Requested Item row (if it is shut) and returns it. */
export async function openRow(row) {
  const toggle = within(row).getAllByRole("button").find((b) => b.hasAttribute("aria-expanded"))
  if (toggle.getAttribute("aria-expanded") === "false") {
    await userEvent.setup().click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"))
  }
  return row
}

/** The row of the Requested Item with this name, opened. */
export async function openRowNamed(name) {
  // A row that moved to another group may still be fading out of the old one; wait for a single row.
  const row = await waitFor(() => screen.getByText(name).closest("[data-testid='requested-item']"))
  return openRow(row)
}

/** The row now showing this name (a row is a new element after it moves to another group). */
export const currentRow = (name) => screen.getByText(name).closest("[data-testid='requested-item']")

/** Unfolds every "N done · show" row, so finished lines (Available, Received, Cancelled) are on screen. */
export async function showDoneLines() {
  const user = userEvent.setup()
  const buttons = (await screen.findAllByTestId("done-row")).map((r) => within(r).getByRole("button", { name: "show" }))
  for (const b of buttons) await user.click(b)
}
