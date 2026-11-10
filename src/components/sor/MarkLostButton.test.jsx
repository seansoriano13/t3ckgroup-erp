import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import MarkLostButton from "./MarkLostButton"
import { opportunityService } from "../../services/opportunityService"

vi.mock("../../services/opportunityService", () => ({
    opportunityService: { markLost: vi.fn() },
}))
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const OPP = { id: "opp-1" }
const LOST_A = { id: "lost-a", name: "Closed Lost" }
const LOST_B = { id: "lost-b", name: "Dropped" }

function renderButton(lostStages = [LOST_A]) {
    const client = new QueryClient()
    render(
        <QueryClientProvider client={client}>
            <MarkLostButton opportunity={OPP} lostStages={lostStages} />
        </QueryClientProvider>,
    )
}

async function openPicker() {
    await userEvent.click(screen.getByRole("button", { name: /^mark as lost$/i }))
}

const confirm = () => screen.getAllByRole("button", { name: /^mark as lost$/i }).at(-1)

describe("Mark as Lost picker", () => {
    beforeEach(() => vi.clearAllMocks())

    it("lists the reasons in order and keeps Confirm off until one is picked", async () => {
        renderButton()
        await openPicker()
        const reasons = screen.getAllByRole("radio").map((r) => r.textContent)
        expect(reasons).toEqual([
            "No response from client",
            "Price too high",
            "Lost to competitor",
            "Client cancelled the project",
            "No budget / not approved",
            "Did not meet the requirements",
            "Other",
        ])
        expect(confirm()).toBeDisabled()
    })

    it("sends the reason code and an optional note", async () => {
        opportunityService.markLost.mockResolvedValue({ id: "opp-1" })
        renderButton()
        await openPicker()
        await userEvent.click(screen.getByRole("radio", { name: /price too high/i }))
        await userEvent.type(screen.getByPlaceholderText(/what happened/i), "  Quoted 20% over  ")
        await userEvent.click(confirm())
        await waitFor(() =>
            expect(opportunityService.markLost).toHaveBeenCalledWith("opp-1", "PRICE_TOO_HIGH", "Quoted 20% over", null),
        )
    })

    it("needs a note for Other", async () => {
        opportunityService.markLost.mockResolvedValue({ id: "opp-1" })
        renderButton()
        await openPicker()
        await userEvent.click(screen.getByRole("radio", { name: /^other$/i }))
        expect(confirm()).toBeDisabled()
        await userEvent.type(screen.getByPlaceholderText(/what happened/i), "Client merged")
        expect(confirm()).toBeEnabled()
        await userEvent.click(confirm())
        await waitFor(() =>
            expect(opportunityService.markLost).toHaveBeenCalledWith("opp-1", "OTHER", "Client merged", null),
        )
    })

    it("asks which Lost Stage when the flow has two", async () => {
        opportunityService.markLost.mockResolvedValue({ id: "opp-1" })
        renderButton([LOST_A, LOST_B])
        await openPicker()
        await userEvent.click(screen.getByRole("radio", { name: /no response from client/i }))
        expect(confirm()).toBeDisabled()
        await userEvent.click(screen.getByRole("radio", { name: "Dropped" }))
        await userEvent.click(confirm())
        await waitFor(() =>
            expect(opportunityService.markLost).toHaveBeenCalledWith("opp-1", "NO_RESPONSE", null, "lost-b"),
        )
    })

    it("does not ask for a Lost Stage when the flow has one", async () => {
        renderButton([LOST_A])
        await openPicker()
        expect(screen.queryByText(/which lost stage/i)).not.toBeInTheDocument()
    })
})
