import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../support"
import { db } from "../db/store"
import { makeEmployee, makeSaleType, makeSalesFlow, makeSuperAdmin } from "../factories"
import { supabase } from "@/lib/supabase"

/**
 * Flow Plans folded into a Sandbox mode on this one screen (this reshape).
 * Live and Sandbox render the same `FlowCanvas`, switching only the data
 * provider underneath — the interesting behaviour to prove here is the
 * toggle and the Sandbox's singleton provisioning, not the canvas itself
 * (already covered by FlowCanvas.test.jsx).
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

describe("FlowCanvasAdminPage modes", () => {
  it("opens in Live mode by default", async () => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" })
    renderWithProviders(<FlowCanvasAdminPage />)

    expect(await screen.findByText("No Sale Types yet")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true")
  })

  it("shows Snapshot History only to a Super Admin, in Live mode", async () => {
    mockUser.current = makeEmployee({ is_super_admin: false })
    renderWithProviders(<FlowCanvasAdminPage />)
    await screen.findByText("No Sale Types yet")

    expect(screen.queryByRole("button", { name: /Snapshot History/ })).not.toBeInTheDocument()
  })

  it("provisions the one shared Sandbox on switching to Sandbox mode and connects to sandbox presence", async () => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" })
    const user = userEvent.setup()
    renderWithProviders(<FlowCanvasAdminPage />)
    await screen.findByText("No Sale Types yet")

    await user.click(screen.getByRole("button", { name: "Sandbox" }))

    await waitFor(() => expect(db.internal.rowsOf("flow_plans")).toHaveLength(1))
    const sandbox = db.internal.rowsOf("flow_plans")[0]
    expect(screen.getByRole("button", { name: "Sandbox" })).toHaveAttribute("aria-pressed", "true")
    // Sandbox mode has no Snapshot history — that only ever describes Live.
    expect(screen.queryByRole("button", { name: /Snapshot History/ })).not.toBeInTheDocument()
    // Verifies Sandbox presence is subscribed
    await waitFor(() => {
      expect(supabase.channel).toHaveBeenCalledWith(
        `flow_presence_${sandbox.id}`,
        expect.anything()
      )
    })
  })

  it("connects to live presence channel in Live mode when a sale type is active", async () => {
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
