import { describe, it, expect } from "vitest"
import { collectUuids, classifyReferences } from "../../../scripts/lib/flowTransfer.mjs"

// #331: the release transfer copies a Flow Snapshot to production with every
// id kept. Anything the snapshot points at by id has to exist there too, and
// the snapshot doesn't say which ids are what, so the script collects every
// uuid in it and asks the source database what each one is.

const E1 = "11111111-1111-4111-8111-111111111111"
const E2 = "22222222-2222-4222-8222-222222222222"
const G1 = "33333333-3333-4333-8333-333333333333"
const S1 = "44444444-4444-4444-8444-444444444444"

describe("collectUuids", () => {
    it("finds uuids at any depth, in values not keys, once each", () => {
        const snapshot = {
            stages: [{ id: S1, name: "Bid" }],
            actions: [{ config: { assignees: [{ type: "employee", id: E1 }, { type: "group", id: G1 }] } }],
            conditions: [{ config: { approver_id: E2, note: `not ${E1} inside text` } }],
            followUps: [{ id: S1, recipients: [{ type: "employee", id: E1 }] }],
        }

        expect([...collectUuids(snapshot)].sort()).toEqual([E1, E2, G1, S1].sort())
    })

    it("ignores non-uuid strings and nulls", () => {
        expect(collectUuids({ a: "Government", b: null, c: 3, d: ["S01237"] }).size).toBe(0)
    })
})

describe("classifyReferences", () => {
    it("splits referenced ids into employees and groups, and names employees the target lacks", () => {
        const result = classifyReferences({
            referenced: new Set([E1, E2, G1, S1]),
            sourceEmployeeIds: new Set([E1, E2]),
            sourceGroupIds: new Set([G1]),
            targetEmployeeIds: new Set([E1]),
            targetGroupIds: new Set(),
        })

        expect(result.missingEmployeeIds).toEqual([E2])
        expect(result.groupIdsToCopy).toEqual([G1])
    })

    it("doesn't copy a group the target already has", () => {
        const result = classifyReferences({
            referenced: new Set([G1]),
            sourceEmployeeIds: new Set(),
            sourceGroupIds: new Set([G1]),
            targetEmployeeIds: new Set(),
            targetGroupIds: new Set([G1]),
        })

        expect(result.groupIdsToCopy).toEqual([])
    })
})
