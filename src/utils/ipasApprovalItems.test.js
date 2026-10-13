import { describe, expect, it } from "vitest"
import { ipasChain, ipasToItem } from "./approvalItems.js"

const NOW = new Date("2026-10-20T09:00:00+08:00").getTime()
const person = (id, name) => ({ id, name, avatarPath: null })

const base = {
  ipasId: "i1",
  number: "TGIPAS_049",
  poNumber: "P02552",
  supplier: "Scorpe Technologies",
  priority: "high",
}

describe("IPAS sign-offs as Approval Center items", () => {
  it("reads a section 1 or 3 row as Prepared, then waiting on the approver", () => {
    const pending = {
      ...base,
      id: "i1:3",
      section: 3,
      role: "approved",
      preparedBy: person("buyer", "Buyer"),
      preparedAt: "2026-10-13T08:00:00Z",
    }
    const item = ipasToItem(pending, NOW)

    expect(item).toMatchObject({
      queue: "ipas",
      ref: "TGIPAS_049",
      typeLabel: "P02552 · Section 3",
      person: { id: "buyer", name: "Buyer", dept: "Purchasing" },
      clockAt: "2026-10-13T08:00:00Z",
      isStale: true,
    })
    expect(item.chain.map((s) => [s.label, s.state])).toEqual([
      ["Prepared", "done"],
      ["Approved", "current"],
    ])
  })

  it("reads a section 7 row with its step, who made it ready, and the chain of four", () => {
    const steps = [
      { role: "received", label: "Received", signoff: { signedBy: person("rec", "Rita"), signedAt: "2026-10-19T08:00:00Z" } },
      { role: "noted", label: "Noted", signoff: null },
      { role: "checked", label: "Checked", signoff: null },
      { role: "approved", label: "Approved", signoff: null },
    ]
    const pending = {
      ...base,
      id: "i1:7:noted",
      section: 7,
      role: "noted",
      preparedBy: person("rec", "Rita"),
      preparedAt: "2026-10-19T08:00:00Z",
      readyAt: "2026-10-19T08:00:00Z",
      steps,
    }
    const item = ipasToItem(pending, NOW)

    expect(item).toMatchObject({
      typeLabel: "P02552 · Section 7 · Noted",
      person: { id: "rec", name: "Rita", dept: "Filing" },
      clockAt: "2026-10-19T08:00:00Z",
      isStale: false,
    })
    expect(item.chain.map((s) => [s.label, s.state, s.who])).toEqual([
      ["Received", "done", "Rita"],
      ["Noted", "current", "You"],
      ["Checked", "next", "Section 7 list"],
      ["Approved", "next", "Section 7 list"],
    ])
    expect(ipasChain({ section: 7, role: "noted" })).toEqual([
      { label: "Prepared", who: "Purchasing", state: "done", at: null },
      { label: "Approved", who: "You", state: "current", at: null },
    ])
  })
})
