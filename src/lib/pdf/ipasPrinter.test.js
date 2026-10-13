import { describe, expect, it, vi, beforeEach } from "vitest"
import { makePrintableIpas } from "@/test/ipasPrint"

const mocks = vi.hoisted(() => ({ getForPrint: vi.fn(), downloadSignature: vi.fn() }))

vi.mock("../../services/ipasService", () => ({ ipasService: { getForPrint: mocks.getForPrint } }))
vi.mock("../../services/signatureService", () => ({ signatureService: { downloadSignature: mocks.downloadSignature } }))

import { prepareIpasForPrint } from "./ipasPrinter"

/**
 * The print entry (#241 follow-up): a filing copy is honoured only for a filed
 * IPAS; an open or cancelled one prints the ordinary, masked copy whatever the
 * caller asked for.
 */

const FILED = { state: "filed", filed_at: "2026-09-16T02:00:00.000Z" }

describe("prepareIpasForPrint", () => {
  beforeEach(() => {
    mocks.getForPrint.mockReset()
    mocks.downloadSignature.mockReset().mockResolvedValue(null)
  })

  it("prints the filing copy of a filed IPAS in full", async () => {
    mocks.getForPrint.mockResolvedValue(makePrintableIpas({ row: FILED }))

    const vm = await prepareIpasForPrint("ipas-50", { filingCopy: true })

    expect(vm.filingCopy).toBe(true)
    expect(vm.section3.bank).toMatchObject({ accountNumber: "0012 3456 7890 4417", masked: false })
  })

  it.each(["open", "cancelled"])("ignores the filing copy request on a %s IPAS and prints it masked", async (state) => {
    mocks.getForPrint.mockResolvedValue(makePrintableIpas({ row: { state } }))

    const vm = await prepareIpasForPrint("ipas-50", { filingCopy: true })

    expect(vm.filingCopy).toBe(false)
    expect(vm.section3.bank).toMatchObject({ accountNumber: "•••• 4417", masked: true })
  })

  it("prints a filed IPAS masked when the filing copy wasn't asked for", async () => {
    mocks.getForPrint.mockResolvedValue(makePrintableIpas({ row: FILED }))

    const vm = await prepareIpasForPrint("ipas-50")

    expect(vm.filingCopy).toBe(false)
    expect(vm.section3.bank.masked).toBe(true)
  })
})
