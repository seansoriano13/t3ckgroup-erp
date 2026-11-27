/**
 * The Compliance Requirement group of Your move (#1251, spec #1247) on screen: the question, the
 * Yes / No answer, the kind picker, the open-kind lines and changing the answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import IpasComplianceBlock from "./IpasComplianceBlock"
import { complianceFor } from "@/utils/ipasCompliance"

const service = vi.hoisted(() => ({
  complianceKinds: vi.fn(),
  setCompliance: vi.fn(),
  tickCompliance: vi.fn(),
  untickCompliance: vi.fn(),
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
  return renderWithProviders(<IpasComplianceBlock ipas={row} compliance={compliance} />)
}

beforeEach(() => {
  service.complianceKinds.mockReset().mockResolvedValue(KINDS)
  service.setCompliance.mockReset().mockResolvedValue({})
  service.tickCompliance.mockReset().mockResolvedValue({})
  service.untickCompliance.mockReset().mockResolvedValue({})
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
    expect(lines).toEqual(["NTCopenMark doneAttach", "FDAopenMark doneAttach"])
  })

  it("Mark done opens a step with today's day and no note, and saves them", async () => {
    const user = setupUser()
    show({ compliance_needed: true, compliance_requirements: [requirement("NTC")] })
    await user.click(screen.getByRole("button", { name: "Mark NTC done" }))

    const step = screen.getByTestId("ipas-compliance-step-r-NTC")
    const today = within(step).getByLabelText("Done on")
    expect(today.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today.max).toBe(today.value)

    await user.type(within(step).getByLabelText("Note (optional)"), "Permit 123")
    await user.click(within(step).getByRole("button", { name: "Mark done" }))
    await waitFor(() => expect(service.tickCompliance).toHaveBeenCalledWith("r-NTC", today.value, "Permit 123"))
  })

  it("takes an earlier day", async () => {
    const user = setupUser()
    show({ compliance_needed: true, compliance_requirements: [requirement("NTC")] })
    await user.click(screen.getByRole("button", { name: "Mark NTC done" }))
    const step = screen.getByTestId("ipas-compliance-step-r-NTC")

    fireEvent.change(within(step).getByLabelText("Done on"), { target: { value: "2026-01-05" } })
    expect(within(step).getByRole("button", { name: "Mark done" })).toBeEnabled()
    await user.click(within(step).getByRole("button", { name: "Mark done" }))
    await waitFor(() => expect(service.tickCompliance).toHaveBeenCalledWith("r-NTC", "2026-01-05", ""))

  })

  it("refuses a future day before anything is sent", async () => {
    const user = setupUser()
    show({ compliance_needed: true, compliance_requirements: [requirement("NTC")] })
    await user.click(screen.getByRole("button", { name: "Mark NTC done" }))
    const step = screen.getByTestId("ipas-compliance-step-r-NTC")
    fireEvent.change(within(step).getByLabelText("Done on"), { target: { value: "2099-01-01" } })
    expect(within(step).getByText("The day cannot be after today.")).toBeInTheDocument()
    expect(within(step).getByRole("button", { name: "Mark done" })).toBeDisabled()
    expect(service.tickCompliance).not.toHaveBeenCalled()
  })

  it("refuses a note over 500 characters", async () => {
    const user = setupUser()
    show({ compliance_needed: true, compliance_requirements: [requirement("NTC")] })
    await user.click(screen.getByRole("button", { name: "Mark NTC done" }))
    const step = screen.getByTestId("ipas-compliance-step-r-NTC")
    fireEvent.change(within(step).getByLabelText("Note (optional)"), { target: { value: "x".repeat(501) } })
    expect(within(step).getByRole("button", { name: "Mark done" })).toBeDisabled()
    expect(within(step).getByText("501/500")).toBeInTheDocument()
  })

  it("says why a tick failed, with Retry", async () => {
    const user = setupUser()
    service.tickCompliance.mockRejectedValueOnce({ code: "22023", message: "ipas_tick_compliance: TGIPAS_1 is filed; a Super Admin reopens it first" })
    show({ compliance_needed: true, compliance_requirements: [requirement("NTC")] })
    await user.click(screen.getByRole("button", { name: "Mark NTC done" }))
    await user.click(screen.getByRole("button", { name: "Mark done" }))
    expect(await screen.findByText(/is filed/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(service.tickCompliance).toHaveBeenCalledTimes(2))
  })

  it("lists the done kinds in the change step, with their day and note, and can undo a tick", async () => {
    const user = setupUser()
    show({
      compliance_needed: true,
      compliance_requirements: [{ ...requirement("DENR", "2020-11-20"), note: "Permit 9" }, requirement("FDA")],
    })
    await user.click(screen.getByRole("button", { name: "Change answer or kinds" }))
    const done = await screen.findByTestId("ipas-compliance-done")
    expect(within(done).getByText("DENR")).toBeInTheDocument()
    expect(within(done).getByText("done Nov 20, 2020")).toBeInTheDocument()
    expect(within(done).getByText("Permit 9")).toBeInTheDocument()
    expect(within(done).queryByText("FDA")).toBeNull()

    await user.click(within(done).getByRole("button", { name: "Undo DENR tick" }))
    await waitFor(() => expect(service.untickCompliance).toHaveBeenCalledWith("r-DENR"))
  })

  it("changes the note of a done kind, keeping its day", async () => {
    const user = setupUser()
    show({ compliance_needed: true, compliance_requirements: [{ ...requirement("DENR", "2026-11-20"), note: "Permit 9" }] })
    await user.click(screen.getByRole("button", { name: "Change answer or kinds" }))
    await user.click(await screen.findByRole("button", { name: "Edit DENR day and note" }))
    const step = screen.getByTestId("ipas-compliance-step-r-DENR")
    expect(within(step).getByRole("button", { name: "Save" })).toBeDisabled()

    const note = within(step).getByLabelText("Note (optional)")
    await user.clear(note)
    await user.type(note, "Permit 10")
    await user.click(within(step).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(service.tickCompliance).toHaveBeenCalledWith("r-DENR", "2026-11-20", "Permit 10"))
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
