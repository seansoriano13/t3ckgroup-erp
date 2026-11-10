import { beforeEach, describe, expect, it } from "vitest"
import { ipasService } from "./ipasService"
import { db } from "@/test/db/store"
import { stubEdgeFunction } from "@/test/msw/server"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee } from "@/test/factories"
import { stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { IPAS_NOTIFICATION } from "@/constants/ipas"

/**
 * IPAS bank details and the changed-account flag (#245) through the service,
 * against the fake database with the RPCs re-implemented on its store. The
 * database's own rules (who reads, who writes, the real comparison) are the
 * policy tier's (59-ipas-bank-details); what is proven here is the wiring: what
 * `get` reads back, the flag and its event, the approvals cleared and the
 * preparer notified, and that no account number leaks into history or a
 * notification.
 */

const odooPo = ({ name, supplierId = 553 }) => ({
  success: true,
  found: true,
  po: { id: 2552, name, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: supplierId, name: "Scorpe Technologies", contact: null },
  lines: [
    { line_id: 11400, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: null },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
})

describe("ipasService: bank details and the changed-account flag", () => {
  let buyer

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    stubIpasRpcs({ actorId: buyer.id })
  })

  async function raise(poNumber, { supplierId = 553 } = {}) {
    stubEdgeFunction("odoo-po-ipas", odooPo({ name: poNumber, supplierId }))
    return ipasService.create({ poNumber, priority: "high", source: "local", purpose: "inventory" })
  }

  const read = (id) => ipasService.get(id, { refresh: false })
  const events = (...kinds) => db.rows("ipas_events").filter((e) => !kinds.length || kinds.includes(e.kind))
  const details = (over = {}) => ({ bankName: "BDO", accountName: "Scorpe Technologies Inc.", accountNumber: "0012 3456 7890", ...over })

  describe("typing them", () => {
    it("stores bank details and reads them back, with no flag on a supplier's first IPAS", async () => {
      const ipas = await raise("P02001")

      const result = await ipasService.setBankDetails(ipas.id, details())

      expect(result).toMatchObject({ flagged: false, accountChanged: true, approvalsCleared: [] })
      expect(result.bankDetails).toMatchObject({ bankName: "BDO", accountName: "Scorpe Technologies Inc.", accountNumber: "0012 3456 7890", flagged: false })

      const opened = await read(ipas.id)
      expect(opened.canReadBankDetails).toBe(true)
      expect(opened.bankDetails).toMatchObject({ bankName: "BDO", accountNumber: "0012 3456 7890", flagged: false })
      expect(db.rows("ipas_bank_details")).toHaveLength(1)
    })

    it("trims, and treats blanks as nothing typed", async () => {
      const ipas = await raise("P02002")

      const result = await ipasService.setBankDetails(ipas.id, { bankName: "  BPI  ", accountName: "", accountNumber: "   " })

      expect(result.bankDetails).toMatchObject({ bankName: "BPI", accountName: null, accountNumber: null, flagged: false })
    })

    it("changes the details, and records which fields changed", async () => {
      const ipas = await raise("P02003")
      await ipasService.setBankDetails(ipas.id, details())

      await ipasService.setBankDetails(ipas.id, details({ bankName: "BPI" }))

      expect(events("bank_details_set", "bank_details_changed").map((e) => [e.kind, e.detail.fields])).toEqual([
        ["bank_details_set", ["bank_name", "account_name", "account_number"]],
        ["bank_details_changed", ["bank_name"]],
      ])
      expect((await read(ipas.id)).bankDetails.bankName).toBe("BPI")
    })

    it("records nothing when nothing changed", async () => {
      const ipas = await raise("P02004")
      await ipasService.setBankDetails(ipas.id, details())
      const before = events().length

      await ipasService.setBankDetails(ipas.id, details())

      expect(events()).toHaveLength(before)
    })

    it("is refused to anyone without Purchasing access, and writes nothing", async () => {
      const ipas = await raise("P02005")
      stubIpasRpcs({ actorId: buyer.id, purchasing: false })

      await expect(ipasService.setBankDetails(ipas.id, details())).rejects.toMatchObject({ code: "42501" })

      expect(db.rows("ipas_bank_details")).toEqual([])
    })

    it("is refused on a cancelled IPAS", async () => {
      const ipas = await raise("P02006")
      await ipasService.cancel(ipas.id, "Wrong PO")

      await expect(ipasService.setBankDetails(ipas.id, details())).rejects.toMatchObject({ code: "55000" })
    })
  })

  describe("the changed-account flag", () => {
    it("flags an Account # that differs from the same supplier's previous IPAS, and records an event", async () => {
      const first = await raise("P02101")
      await ipasService.setBankDetails(first.id, details())
      const second = await raise("P02102")

      const result = await ipasService.setBankDetails(second.id, details({ accountNumber: "9999 8888 7777" }))

      expect(result).toMatchObject({ flagged: true, accountChanged: true })
      expect(result.bankDetails.flagged).toBe(true)
      expect((await read(second.id)).bankDetails.flagged).toBe(true)
      expect((await read(first.id)).bankDetails.flagged).toBe(false)

      const flagged = events("account_flagged")
      expect(flagged).toHaveLength(1)
      expect(flagged[0]).toMatchObject({ ipas_id: second.id, actor_id: buyer.id })
      expect(flagged[0].detail).toMatchObject({ previous_ipas_id: first.id, previous_number: first.number })
    })

    it.each([
      ["spaces", "0012345 67890"],
      ["dashes", "0012-3456-7890"],
      ["spaces and dashes together", " 0012 - 3456-7890 "],
    ])("does not flag the same number with different %s", async (_, typed) => {
      const first = await raise("P02111")
      await ipasService.setBankDetails(first.id, details())
      const second = await raise("P02112")

      const result = await ipasService.setBankDetails(second.id, details({ accountNumber: typed }))

      expect(result.flagged).toBe(false)
      expect(events("account_flagged")).toEqual([])
    })

    it("never flags a supplier's first IPAS", async () => {
      const ipas = await raise("P02121")

      const result = await ipasService.setBankDetails(ipas.id, details())

      expect(result.flagged).toBe(false)
      expect(events("account_flagged")).toEqual([])
    })

    it("compares only the same supplier", async () => {
      const other = await raise("P02131", { supplierId: 700 })
      await ipasService.setBankDetails(other.id, details({ accountNumber: "1111" }))
      const mine = await raise("P02132", { supplierId: 553 })

      const result = await ipasService.setBankDetails(mine.id, details({ accountNumber: "2222" }))

      expect(result.flagged).toBe(false)
    })

    it("compares with the most recent other IPAS, not an older one", async () => {
      const oldest = await raise("P02141")
      await ipasService.setBankDetails(oldest.id, details({ accountNumber: "1111" }))
      const newer = await raise("P02142")
      await ipasService.setBankDetails(newer.id, details({ accountNumber: "2222" }))
      expect((await read(newer.id)).bankDetails.flagged).toBe(true)

      const newest = await raise("P02143")
      const result = await ipasService.setBankDetails(newest.id, details({ accountNumber: "2222" }))

      expect(result.flagged).toBe(false)
    })

    it("skips a cancelled IPAS, so a cancelled account can't become the last known good one", async () => {
      const trusted = await raise("P02151")
      await ipasService.setBankDetails(trusted.id, details({ accountNumber: "1111" }))
      const rejected = await raise("P02152")
      await ipasService.setBankDetails(rejected.id, details({ accountNumber: "6666" }))
      await ipasService.cancel(rejected.id, "Wrong account")
      const next = await raise("P02153")

      const result = await ipasService.setBankDetails(next.id, details({ accountNumber: "6666" }))

      expect(result.flagged).toBe(true)
    })

    it("skips an IPAS with no Account # typed", async () => {
      const trusted = await raise("P02161")
      await ipasService.setBankDetails(trusted.id, details({ accountNumber: "1111" }))
      const blank = await raise("P02162")
      await ipasService.setBankDetails(blank.id, { bankName: "BDO" })
      const next = await raise("P02163")

      const result = await ipasService.setBankDetails(next.id, details({ accountNumber: "2222" }))

      expect(result.flagged).toBe(true)
    })

    it("lowers the flag when the number is corrected back", async () => {
      const first = await raise("P02171")
      await ipasService.setBankDetails(first.id, details())
      const second = await raise("P02172")
      await ipasService.setBankDetails(second.id, details({ accountNumber: "9999" }))

      const result = await ipasService.setBankDetails(second.id, details())

      expect(result.flagged).toBe(false)
      expect((await read(second.id)).bankDetails.flagged).toBe(false)
      expect(events("bank_details_changed").at(-1).detail).toMatchObject({ flagged: false, was_flagged: true })
    })

    it("flags nothing when the supplier has no Odoo partner id to match on", async () => {
      const first = await raise("P02181")
      await ipasService.setBankDetails(first.id, details())
      const second = await raise("P02182")
      db.internal.rowsOf("ipas").find((r) => r.id === second.id).odoo_copy.supplier = { name: "No id" }

      const result = await ipasService.setBankDetails(second.id, details({ accountNumber: "9999" }))

      expect(result.flagged).toBe(false)
    })
  })

  describe("when the account is flagged", () => {
    it("clears the live section 2 (stored 3) approval only and notifies its preparer", async () => {
      const preparer = makeEmployee({ name: "Prepared It" })
      const approver = makeEmployee({ name: "Approved It" })
      const first = await raise("P02201")
      await ipasService.setBankDetails(first.id, details())
      const second = await raise("P02202")
      db.seed("ipas_signoffs", [
        { ipas_id: second.id, section: 1, role: "prepared", signed_by: preparer.id },
        { ipas_id: second.id, section: 1, role: "approved", signed_by: approver.id },
        { ipas_id: second.id, section: 3, role: "prepared", signed_by: preparer.id },
        { ipas_id: second.id, section: 3, role: "approved", signed_by: approver.id },
        { ipas_id: second.id, section: 7, role: "received", signed_by: approver.id },
      ])
      const signoffs = () => db.rows("ipas_signoffs")
      stubIpasRpcs({ actorId: buyer.id })

      const result = await ipasService.setBankDetails(second.id, details({ accountNumber: "9999 0000" }))
      await waitForNetworkIdle()

      expect(result).toMatchObject({ flagged: true, approvalsCleared: [3] })
      expect(signoffs().filter((s) => s.cleared_at).map((s) => [s.section, s.role])).toEqual([[3, "approved"]])
      expect(signoffs().filter((s) => s.cleared_reason).every((s) => s.cleared_reason === "Account # flagged")).toBe(true)
      expect(signoffs().find((s) => s.section === 7).cleared_at).toBeNull()
      expect(signoffs().find((s) => s.section === 1 && s.role === "approved").cleared_at).toBeFalsy()
      expect(events("approvals_cleared")[0].detail).toMatchObject({ reason: "Account # flagged", sections: [3] })

      const sent = db.rows("notifications").filter((n) => n.type === IPAS_NOTIFICATION.ACCOUNT_FLAGGED)
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ recipient_id: preparer.id, reference_id: second.id })
      expect(sent[0].message).toContain(second.number)
    })

    it("clears nothing and notifies nobody when nothing had been approved", async () => {
      const first = await raise("P02211")
      await ipasService.setBankDetails(first.id, details())
      const second = await raise("P02212")

      const result = await ipasService.setBankDetails(second.id, details({ accountNumber: "9999" }))
      await waitForNetworkIdle()

      expect(result).toMatchObject({ flagged: true, approvalsCleared: [] })
      expect(events("approvals_cleared")).toEqual([])
      expect(db.rows("notifications").filter((n) => n.type === IPAS_NOTIFICATION.ACCOUNT_FLAGGED)).toEqual([])
    })

    it("clears approvals only when the Account # changes, not when the bank name does", async () => {
      const preparer = makeEmployee({ name: "Prepared It" })
      const first = await raise("P02221")
      await ipasService.setBankDetails(first.id, details())
      const second = await raise("P02222")
      await ipasService.setBankDetails(second.id, details({ accountNumber: "9999" }))
      db.seed("ipas_signoffs", [
        { ipas_id: second.id, section: 1, role: "prepared", signed_by: preparer.id },
        { ipas_id: second.id, section: 1, role: "approved", signed_by: preparer.id },
      ])
      stubIpasRpcs({ actorId: buyer.id })

      await ipasService.setBankDetails(second.id, details({ accountNumber: "9999", bankName: "BPI" }))

      expect(db.rows("ipas_signoffs").every((s) => !s.cleared_at)).toBe(true)
    })
  })

  describe("keeping the account number out of the open", () => {
    it("never writes an account number to history or a notification", async () => {
      const preparer = makeEmployee({ name: "Prepared It" })
      const first = await raise("P02301")
      await ipasService.setBankDetails(first.id, details({ accountNumber: "5550001111" }))
      const second = await raise("P02302")
      db.seed("ipas_signoffs", [
        { ipas_id: second.id, section: 1, role: "prepared", signed_by: preparer.id },
        { ipas_id: second.id, section: 1, role: "approved", signed_by: preparer.id },
      ])
      stubIpasRpcs({ actorId: buyer.id })

      await ipasService.setBankDetails(second.id, details({ accountNumber: "7770002222", accountName: "Secret Holder" }))
      await waitForNetworkIdle()

      const everything = JSON.stringify([db.rows("ipas_events"), db.rows("notifications")])
      for (const secret of ["5550001111", "7770002222", "Secret Holder", "BDO"]) {
        expect(everything, `${secret} leaked`).not.toContain(secret)
      }
    })
  })

  describe("who gets them back", () => {
    it("returns the details and says the caller may read them", async () => {
      const ipas = await raise("P02401")
      await ipasService.setBankDetails(ipas.id, details())

      const opened = await read(ipas.id)

      expect(opened).toMatchObject({ canReadBankDetails: true, bankDetails: { accountNumber: "0012 3456 7890" } })
    })

    it("returns no bank details, and says so, to a caller the database refuses (a section 7 signer without flags)", async () => {
      const ipas = await raise("P02402")
      await ipasService.setBankDetails(ipas.id, details())
      stubIpasRpcs({ actorId: buyer.id, bankReader: false })

      const opened = await read(ipas.id)

      expect(opened.canReadBankDetails).toBe(false)
      expect(opened.bankDetails).toBeNull()
      expect(JSON.stringify(opened)).not.toContain("0012 3456 7890")
    })

    it("says the caller may read them even when none are typed yet", async () => {
      const ipas = await raise("P02403")

      const opened = await read(ipas.id)

      expect(opened).toMatchObject({ canReadBankDetails: true, bankDetails: null })
    })
  })
})
