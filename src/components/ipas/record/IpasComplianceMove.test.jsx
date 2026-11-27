/**
 * The Compliance Requirement group of Your move (#1251, spec #1247) on screen: the question, the
 * Yes / No answer, the kind picker, the open-kind lines and changing the answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import IpasComplianceMove from "./IpasComplianceMove"
import { complianceFor } from "./moves"

const service = vi.hoisted(() => ({
  complianceKinds: vi.fn(),
  setCompliance: vi.fn(),
}))
vi.mock("@/services/ipasService", () => ({ ipasService: service }))

const KINDS = ["DENR", "MARINA", "OMB", "NTC", "FDA"].map((label, index) => ({ id: `k-${label}`, label, sort: (index + 1) * 10, active: true }))

const requirement = (label, doneOn = null) => ({
  id: `r-${label}`,
  kind_id: `k-${label}`,
  done_on: doneOn,
  note: null,
  kind: KINDS.find((kind) => kind.label === label),
})

function show(ipas) {
  const row = { id: "ipas-1", state: "open", compliance_asked: true, compliance_needed: null, compliance_requirements: [], ...ipas }
  const compliance = complianceFor({ can: { compliance: true }, ipas: row })
  return renderWithProviders(<IpasComplianceMove ipas={row} compliance={compliance} />)
}

beforeEach(() => {
  service.complianceKinds.mockReset().mockResolvedValue(KINDS)
  service.setCompliance.mockReset().mockResolvedValue({})
})

describe("an unanswered IPAS", () => {
  it("asks the question with Yes and No", () => {
    show({})
    expect(screen.getByText("Does this order need a Compliance Requirement?")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument()
  })

  it("No answers at once", async () => {
    const user = setupUser()
    show({})
    await user.click(screen.getByRole("button", { name: "No" }))
    await waitFor(() => expect(service.setCompliance).toHaveBeenCalledWith("ipas-1", false, []))
  })

  it("Yes opens the picker of the active kinds, and saving needs at least one", async () => {
    const user = setupUser()
    show({})
    await user.click(screen.getByRole("button", { name: "Yes" }))

    for (const label of ["DENR", "MARINA", "OMB", "NTC", "FDA"]) expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save kinds" })).toBeDisabled()

    const picker = screen.getByTestId("ipas-compliance-picker-ipas-1")
    const boxes = within(picker).getAllByRole("checkbox")
    await user.click(boxes[3])
    await user.click(boxes[4])
    await user.click(screen.getByRole("button", { name: "Save kinds" }))

    await waitFor(() => expect(service.setCompliance).toHaveBeenCalledWith("ipas-1", true, expect.arrayContaining(["k-NTC", "k-FDA"])))
    expect(service.setCompliance.mock.calls[0][2]).toHaveLength(2)
  })

  it("Cancel closes the picker without writing", async () => {
    const user = setupUser()
    show({})
    await user.click(screen.getByRole("button", { name: "Yes" }))
    await user.click(await screen.findByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument()
    expect(service.setCompliance).not.toHaveBeenCalled()
  })
})

describe("after Yes", () => {
  it("lists one line per open kind and none for a done kind", () => {
    show({ compliance_needed: true, compliance_requirements: [requirement("FDA"), requirement("NTC"), requirement("DENR", "2026-11-20")] })
    const lines = screen.getAllByTestId("ipas-compliance-open-kind").map((line) => line.textContent)
    expect(lines).toEqual(["NTCopen", "FDAopen"])
  })

  it("changes the kinds from the picker, starting with the current ones picked", async () => {
    const user = setupUser()
    show({ compliance_needed: true, compliance_requirements: [requirement("FDA"), requirement("NTC")] })
    await user.click(screen.getByRole("button", { name: "Change answer or kinds" }))

    const picker = await screen.findByTestId("ipas-compliance-picker-ipas-1")
    await waitFor(() => expect(within(picker).getAllByRole("checkbox").length).toBeGreaterThanOrEqual(5))
    const boxes = within(picker).getAllByRole("checkbox")
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true", "true"])
    await user.click(boxes[4])
    await user.click(boxes[2])
    await user.click(screen.getByRole("button", { name: "Save kinds" }))

    await waitFor(() => expect(service.setCompliance).toHaveBeenCalled())
    const [id, needed, kinds] = service.setCompliance.mock.calls[0]
    expect([id, needed, [...kinds].sort()]).toEqual(["ipas-1", true, ["k-NTC", "k-OMB"]])
  })

  it("changes the answer to No", async () => {
    const user = setupUser()
    show({ compliance_needed: true, compliance_requirements: [requirement("FDA")] })
    await user.click(screen.getByRole("button", { name: "Change answer or kinds" }))
    await user.click(await screen.findByRole("button", { name: "No, none needed" }))
    await waitFor(() => expect(service.setCompliance).toHaveBeenCalledWith("ipas-1", false, []))
  })

  it("says why it failed, with Retry", async () => {
    const user = setupUser()
    service.setCompliance.mockRejectedValueOnce({ code: "22023", message: "ipas_set_compliance: TGIPAS_1 is filed; a Super Admin reopens it first" })
    show({})
    await user.click(screen.getByRole("button", { name: "No" }))
    expect(await screen.findByText(/is filed/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(service.setCompliance).toHaveBeenCalledTimes(2))
  })
})

describe("after No, or when every kind is done", () => {
  it("shows no to-do, only a quiet line with Change", () => {
    show({ compliance_needed: false })
    expect(screen.queryByTestId("ipas-compliance-open-kind")).toBeNull()
    expect(screen.getByText(/none needed/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change answer or kinds" })).toBeInTheDocument()
  })
})
