import { useState } from "react"
import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { renderWithProviders } from "@/test/support"
import FlowVersionStagePanel from "./FlowVersionStagePanel"

const STAGE = { id: "stage-1", name: "Bidding", is_terminal: false, bracket_label: "Pre-Award" }

// The panel's tab is controlled by its host (the version viewer). This stands
// in for that host so a test can click between tabs.
function Harness({ initialTab = "conditions", ...props }) {
    const [tab, setTab] = useState(initialTab)
    return (
        <FlowVersionStagePanel
            stage={STAGE}
            conditions={[]}
            actions={[]}
            onClose={vi.fn()}
            activeTab={tab}
            onTabChange={setTab}
            {...props}
        />
    )
}

function renderPanel(props) {
    return renderWithProviders(<Harness {...props} />)
}

describe("FlowVersionStagePanel", () => {
    it("names the Stage and its bracket, with no editing controls", () => {
        renderPanel()

        expect(screen.getByRole("heading", { name: "Bidding" })).toBeInTheDocument()
        expect(screen.getByText("Pre-Award")).toBeInTheDocument()
        // The editor panel offers a rename field, colour swatches and role
        // buttons — none of that belongs on a frozen version.
        expect(screen.queryByLabelText("Stage name")).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Delete Stage/ })).not.toBeInTheDocument()
    })

    it("shows this version's Stage Conditions, read from the snapshot", async () => {
        renderPanel({
            conditions: [
                {
                    id: "c1",
                    stage_id: "stage-1",
                    kind: "field",
                    label: "PO date filled in",
                    is_required: true,
                    config: { column: "po_date" },
                },
                {
                    id: "c2",
                    stage_id: "stage-1",
                    kind: "attachment",
                    label: "Notice of Award",
                    is_required: false,
                    config: {},
                },
            ],
        })

        await userEvent.click(screen.getByRole("button", { name: /Conditions/ }))

        // Issue #203: field is a removed kind — its label still shows (an
        // archived-history row on an old version), but conditionDetail no
        // longer surfaces the column it used to watch.
        expect(screen.getByText("PO date filled in")).toBeInTheDocument()
        expect(screen.getByText("Notice of Award")).toBeInTheDocument()
        expect(screen.getByText("Optional")).toBeInTheDocument()
    })

    it("shows this version's Stage Actions", async () => {
        renderPanel({
            actions: [
                {
                    id: "a1",
                    stage_id: "stage-1",
                    kind: "create_individual_task",
                    config: { projectTitle: "Prepare bid docs", priority: "High" },
                },
            ],
        })

        await userEvent.click(screen.getByRole("button", { name: /Actions/ }))

        expect(screen.getByText("Prepare bid docs")).toBeInTheDocument()
    })

    it("expands a Group Task action's assignees and checklist, matching the editor's own detail view", async () => {
        renderPanel({
            actions: [
                {
                    id: "a1",
                    stage_id: "stage-1",
                    kind: "create_group_task",
                    config: {
                        title: "Evaluation of Specification",
                        members: [{ employeeId: "emp-1", role: "Reviewer", taskDescription: "Check the spec." }],
                    },
                },
            ],
        })

        await userEvent.click(screen.getByRole("button", { name: /Actions/ }))
        expect(screen.queryByText("Check the spec.")).not.toBeInTheDocument()

        await userEvent.click(screen.getByRole("button", { name: /Evaluation of Specification/ }))

        expect(screen.getByText("Check the spec.")).toBeInTheDocument()
        expect(screen.getByText("Reviewer")).toBeInTheDocument()
    })

    it("says plainly when this Stage has no conditions saved", async () => {
        renderPanel({ conditions: [] })

        await userEvent.click(screen.getByRole("button", { name: /Conditions/ }))

        expect(
            screen.getByText("This version saved no Stage Conditions on this Stage."),
        ).toBeInTheDocument()
    })

    it("states it when the whole version saved no rules at all", async () => {
        // Government v1 on staging: four SORs run it, and it was locked before
        // a single Condition or Action was drawn.
        renderPanel({ conditions: [], actions: [], versionHasNoRules: true })

        await userEvent.click(screen.getByRole("button", { name: /Actions/ }))

        expect(
            screen.getByText("This version saved no Stage Conditions or Stage Actions"),
        ).toBeInTheDocument()
    })

    it("marks the entry and won roles without offering to change them", () => {
        renderPanel({ initialTab: "settings", isEntry: true, isWon: true })

        expect(screen.getByText("Deals enter here")).toBeInTheDocument()
        expect(screen.getByText("Deals are won here")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Make it the entry/ })).not.toBeInTheDocument()
    })
})
