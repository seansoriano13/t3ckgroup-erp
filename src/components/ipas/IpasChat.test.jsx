/**
 * The IPAS Chat on screen, against the fake database: reading the thread, who can
 * be mentioned, and posting. Who is notified is the database trigger's
 * (20261217100000_ipas_chat).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee } from "@/test/factories"
import IpasChat from "./IpasChat"

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

let buyer, finance, sales, ipas

beforeEach(() => {
  buyer = makeEmployee({ name: "Ben Cruz", has_purchasing_flow: true })
  finance = makeEmployee({ name: "Fe Lim", has_finance_flow: true })
  sales = makeEmployee({ name: "Sam Ong", department: "SALES" })
  ipas = db.seed("ipas", {
    number: "TGIPAS_101",
    po_number: "P01234",
    priority: "high",
    source: "local",
    purpose: "inventory",
    odoo_copy: {},
    created_by: finance.id,
  })
  db.seed("ipas_messages", {
    ipas_id: ipas.id,
    author_id: finance.id,
    content: "Is the bill in yet?",
    created_at: "2026-11-01T00:00:00Z",
  })
  authUser = { id: buyer.id, name: "Ben Cruz" }
})

describe("the IPAS chat", () => {
  it("shows the thread", async () => {
    renderWithProviders(<IpasChat ipasId={ipas.id} />)
    expect(await screen.findByText("Is the bill in yet?")).toBeInTheDocument()
    expect(screen.getByText("Fe Lim")).toBeInTheDocument()
  })

  it("posts a message that mentions someone who can open IPAS", async () => {
    const user = setupUser()
    renderWithProviders(<IpasChat ipasId={ipas.id} />)
    await screen.findByText("Is the bill in yet?")

    const box = screen.getByPlaceholderText(/Message about this IPAS/)
    await user.type(box, "@Fe")
    // "Fe Lim" is on screen twice now: her message's byline, then the mention list.
    await waitFor(() => expect(screen.getAllByText("Fe Lim")).toHaveLength(2))
    await user.click(screen.getAllByText("Fe Lim").at(-1))
    await user.type(box, "yes, attached")
    await user.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(db.rows("ipas_messages").at(-1)).toMatchObject({
        ipas_id: ipas.id,
        author_id: buyer.id,
        content: "@Fe Lim yes, attached",
        metadata: { mentions: [{ id: finance.id, name: "Fe Lim" }] },
      }),
    )
    expect(box).toHaveValue("")
  })

  it("never offers someone who can't open IPAS as a mention", async () => {
    const user = setupUser()
    renderWithProviders(<IpasChat ipasId={ipas.id} />)
    await screen.findByText("Is the bill in yet?")
    await user.type(screen.getByPlaceholderText(/Message about this IPAS/), "@Sa")
    expect(screen.queryByText("Sam Ong")).not.toBeInTheDocument()
    expect(sales.id).toBeTruthy()
  })
})
