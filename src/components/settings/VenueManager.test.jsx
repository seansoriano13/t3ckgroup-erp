/**
 * #1088 (spec #1083, tracker C1 and C3): Settings > Venues.
 *
 *   the trash button asks "Delete <Venue>?" and deletes nothing until Delete is pressed
 *   Keep it leaves the Venue where it is
 *   clearing a name and clicking away puts the saved name back in the box
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db, insertRow } from "@/test/db/store"
import { makeHrEmployee } from "@/test/factories"
import VenueManager from "./VenueManager"

const mockUser = vi.hoisted(() => ({ current: null }))
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }))

describe("VenueManager", () => {
  beforeEach(() => {
    const hr = makeHrEmployee({ name: "Hera HR" })
    mockUser.current = { id: hr.id, name: hr.name }
    insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
    insertRow("calendar_venues", { name: "Admin Office", active: true, sort_order: 2 })
  })

  const names = () => db.rows("calendar_venues").map((v) => v.name)

  it("asks before deleting and deletes nothing until Delete is pressed", async () => {
    const user = setupUser()
    renderWithProviders(<VenueManager />)

    await user.click(await screen.findByRole("button", { name: "Delete Conference Room" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Delete Conference Room?")).toBeInTheDocument()
    expect(names()).toContain("Conference Room")

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(names()).not.toContain("Conference Room"))
    expect(names()).toContain("Admin Office")
  })

  it("keeps the Venue when the answer is Keep it", async () => {
    const user = setupUser()
    renderWithProviders(<VenueManager />)

    await user.click(await screen.findByRole("button", { name: "Delete Admin Office" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep it" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(names()).toEqual(expect.arrayContaining(["Conference Room", "Admin Office"]))
  })

  it("puts the saved name back when a name is cleared and the box loses focus", async () => {
    const user = setupUser()
    renderWithProviders(<VenueManager />)

    const box = await screen.findByLabelText("Name of Conference Room")
    await user.clear(box)
    expect(box).toHaveValue("")
    await user.tab()

    await waitFor(() => expect(box).toHaveValue("Conference Room"))
    expect(names()).toContain("Conference Room")
  })
})
