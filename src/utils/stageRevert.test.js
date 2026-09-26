import { describe, it, expect } from "vitest"
import { canRevertStage } from "./stageRevert"

const opportunity = { deal_owner_id: "owner" }
const moved = [
    { sequence: 1, left_at: "t", undone_at: null, entered_by: "reg" },
    { sequence: 2, left_at: null, undone_at: null, entered_by: "mover" },
]

describe("canRevertStage", () => {
    it("is offered to whoever made the latest move, the Deal Owner and a Super Admin", () => {
        expect(canRevertStage({ visits: moved, opportunity, user: { id: "mover" } })).toBe(true)
        expect(canRevertStage({ visits: moved, opportunity, user: { id: "owner" } })).toBe(true)
        expect(canRevertStage({ visits: moved, opportunity, user: { id: "x", is_super_admin: true } })).toBe(true)
    })

    it("is hidden from anyone else", () => {
        expect(canRevertStage({ visits: moved, opportunity, user: { id: "someone" } })).toBe(false)
    })

    it("is hidden on an SOR that has never moved", () => {
        expect(canRevertStage({ visits: [moved[1]], opportunity, user: { id: "owner" } })).toBe(false)
    })

    it("is hidden straight after a Revert", () => {
        const reverted = [
            { sequence: 1, left_at: null, undone_at: null, entered_by: "reg" },
            { sequence: 2, left_at: "t", undone_at: "t", entered_by: "mover" },
        ]
        expect(canRevertStage({ visits: reverted, opportunity, user: { id: "owner" } })).toBe(false)
    })
})
