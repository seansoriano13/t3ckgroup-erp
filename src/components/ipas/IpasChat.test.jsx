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

  it("shows a status change as a quiet line under who made it, and System when nobody did", async () => {
    db.seed("ipas_messages", {
      ipas_id: ipas.id,
      author_id: buyer.id,
      content: "Status set to In Transit (was Ordered).",
      metadata: { event: "status_changed", from: "ordered", to: "in_transit" },
      created_at: "2026-11-02T00:00:00Z",
    })
    db.seed("ipas_messages", {
      ipas_id: ipas.id,
      author_id: null,
      content: "Status set to Done (was Delivered).",
      metadata: { event: "status_changed", from: "delivered", to: "done" },
      created_at: "2026-11-03T00:00:00Z",
    })
    renderWithProviders(<IpasChat ipasId={ipas.id} />)

    const line = await screen.findByText("Status set to In Transit (was Ordered).")
    expect(line.closest("[data-testid=ipas-message]")).toHaveAttribute("data-event", "status_changed")
    expect(line.closest("[data-testid=ipas-message]")).toHaveTextContent("Ben Cruz")
    expect(screen.getByText("Status set to Done (was Delivered).").closest("[data-testid=ipas-message]")).toHaveTextContent("System")
  })

  it("shows a money edit as before → after: old struck and muted, new tinted, only the changed fields", async () => {
    db.seed("ipas_messages", {
      ipas_id: ipas.id,
      author_id: buyer.id,
      content: "Changed the payment (Down payment EUR 6,000.00): Amount 5,000.00 → 6,000.00; Method Cash → Check.",
      metadata: {
        event: "payment_changed",
        payment_id: "p1",
        amount: 6000,
        changes: { amount: { from: 5000, to: 6000 }, method: { from: "Cash", to: "Check" } },
      },
      created_at: "2026-11-02T00:00:00Z",
    })
    renderWithProviders(<IpasChat ipasId={ipas.id} />)

    const line = (await screen.findByText("Changed the payment (Down payment EUR 6,000.00)")).closest("[data-testid=ipas-message]")
    expect(line).toHaveAttribute("data-event", "payment_changed")
    const rows = line.querySelectorAll("[data-change]")
    expect(rows).toHaveLength(2)
    const amount = line.querySelector("[data-change=amount]")
    expect(amount.querySelector("[data-testid=change-from]")).toHaveTextContent("5,000.00")
    expect(amount.querySelector("[data-testid=change-from]").tagName).toBe("DEL")
    expect(amount.querySelector("[data-testid=change-from]")).toHaveClass("text-muted-foreground", "line-through")
    expect(amount.querySelector("[data-testid=change-to]")).toHaveTextContent("6,000.00")
    expect(amount.querySelector("[data-testid=change-to]")).toHaveClass("bg-mauve-4")
    expect(line.querySelector("[data-change=method] [data-testid=change-to]")).toHaveTextContent("Check")
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
