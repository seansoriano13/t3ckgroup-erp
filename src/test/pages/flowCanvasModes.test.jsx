import { screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../support"
import { makeSaleType, makeSalesFlow, makeSuperAdmin } from "../factories"
import { supabase } from "@/lib/supabase"

/**
 * The Sandbox mode was removed by #186: the Flow Canvas is now one editing
 * surface, opening straight onto the live Sales Flow. The Snapshot History
 * dialog was removed by #192 in favor of the canvas's own version rail. What
 * is worth proving here is that no mode toggle survives and that live
 * presence is wired up — the canvas itself, including the version rail, is
 * covered by FlowCanvas.test.jsx and FlowVersionRail.test.jsx.
 */
const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

const channelMock = {
  on: function () { return this },
  subscribe: function () { return this },
  unsubscribe: vi.fn(),
  track: vi.fn(),
  send: vi.fn(() => Promise.resolve()),
  presenceState: vi.fn(() => ({})),
  state: "joined",
}

beforeEach(() => {
  vi.spyOn(supabase, "channel").mockReturnValue(channelMock)
})

import FlowCanvasAdminPage from "../../pages/super-admin/flow-canvas/index.jsx"

describe("FlowCanvasAdminPage", () => {
  it("opens straight into the editable canvas, with no Live/Sandbox toggle", async () => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" })
    renderWithProviders(<FlowCanvasAdminPage />)

    expect(await screen.findByText("No Sale Types yet")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Live" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Sandbox" })).not.toBeInTheDocument()
  })

  it("has no Snapshot History button — the version rail replaces it (#192)", async () => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" })
    renderWithProviders(<FlowCanvasAdminPage />)
    await screen.findByText("No Sale Types yet")

    expect(screen.queryByRole("button", { name: /Snapshot History/ })).not.toBeInTheDocument()
  })

  it("connects to the live presence channel when a sale type is active", async () => {
    const saleType = makeSaleType({ name: "Live Sales Flow" })
    makeSalesFlow({ sale_type_id: saleType.id })

    mockUser.current = makeSuperAdmin({ name: "Super Admin" })
    renderWithProviders(<FlowCanvasAdminPage />)

    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith(
        `flow_presence_live_${saleType.id}`,
        expect.anything()
      )
    })
  })
})
