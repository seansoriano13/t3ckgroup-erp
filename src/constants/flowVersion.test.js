import { describe, it, expect } from "vitest"
import { describeFlowVersion, formatSnapshotVersion } from "./flowVersion"

/**
 * What an SOR should say about the Sales Flow it runs.
 *
 * A deal's rules are pinned at registration to a Flow Snapshot and stay there
 * for its life, while the flow itself carries on being edited. So "which
 * version am I on" is a real question with three distinct answers, and the
 * difference between them matters to whoever is looking.
 */
describe("describeFlowVersion", () => {
    const snapshot = {
        id: "snap-1",
        version: 3,
        version_minor: 0,
        created_at: "2026-09-01T02:00:00Z",
        snapshot_data: { stages: [{ id: "s1", name: "Enquiry" }], edges: [] },
    }

    it("reports the pinned version for a deal running a Sales Flow", () => {
        const result = describeFlowVersion({
            opportunity: { sale_type_id: "st-1", flow_snapshot_id: "snap-1" },
            snapshot,
            saleTypeName: "Government",
        })

        expect(result).toMatchObject({
            kind: "pinned",
            version: 3,
            snapshotId: "snap-1",
            saleTypeName: "Government",
        })
        expect(result.label).toBe("Government · v3.0")
    })

    it("renders the minor part, so a routine refinement reads as vX.Y", () => {
        const result = describeFlowVersion({
            opportunity: { sale_type_id: "st-1", flow_snapshot_id: "snap-1" },
            snapshot: { ...snapshot, version: 3, version_minor: 2 },
            saleTypeName: "Government",
        })
        expect(result.label).toBe("Government · v3.2")
        expect(result.versionLabel).toBe("v3.2")
    })

    it("reads a snapshot locked before minor versions existed as N.0", () => {
        // Rows written before #188 carry no `version_minor`; the badge on a
        // deal pinned to one still has to line up with its history notes.
        expect(formatSnapshotVersion({ version: 2 })).toBe("v2.0")
        expect(formatSnapshotVersion(null)).toBeNull()
    })

    it("names the version even when the Sale Type is not to hand", () => {
        // The snapshot is the authority; the Sale Type name is decoration that
        // may not have loaded yet.
        const result = describeFlowVersion({
            opportunity: { sale_type_id: "st-1", flow_snapshot_id: "snap-1" },
            snapshot,
        })
        expect(result.label).toBe("v3.0")
    })

    it("says a deal is on the legacy pipeline when it runs no flow at all", () => {
        // Every SOR registered before Sales Flows existed. At the time of
        // writing that is every deal in production, so this is the common case
        // rather than an edge one.
        const result = describeFlowVersion({
            opportunity: { sale_type_id: null, flow_snapshot_id: null },
        })

        expect(result.kind).toBe("legacy")
        expect(result.label).toBe("Pipeline stages")
        expect(result.snapshotId).toBeNull()
    })

    it("flags a deal that runs a flow but was never pinned to a version", () => {
        // Not a valid state — moving such a deal already refuses. Saying so is
        // more useful than rendering a blank where a version should be.
        const result = describeFlowVersion({
            opportunity: { sale_type_id: "st-1", flow_snapshot_id: null },
            saleTypeName: "Government",
        })

        expect(result.kind).toBe("unpinned")
        expect(result.label).toBe("Government · no version on record")
        expect(result.snapshotId).toBeNull()
    })

    it("treats a pinned deal whose snapshot has not loaded as still loading, not as broken", () => {
        // The id is on the record, so the version exists; the fetch simply has
        // not returned. Reporting "no version on record" here would accuse a
        // healthy deal of being malformed every time the modal opens.
        const result = describeFlowVersion({
            opportunity: { sale_type_id: "st-1", flow_snapshot_id: "snap-1" },
            snapshot: null,
        })

        expect(result.kind).toBe("loading")
        expect(result.snapshotId).toBe("snap-1")
    })

    it("carries the date the version was published, so two versions can be told apart", () => {
        const result = describeFlowVersion({
            opportunity: { sale_type_id: "st-1", flow_snapshot_id: "snap-1" },
            snapshot,
        })
        expect(result.publishedAt).toBe("2026-09-01T02:00:00Z")
    })

    it("is safe to call before the deal itself has loaded", () => {
        expect(describeFlowVersion({}).kind).toBe("legacy")
        expect(describeFlowVersion({ opportunity: null }).kind).toBe("legacy")
    })

    it("only offers a version to open when there is one to open", () => {
        const openable = (args) => describeFlowVersion(args).canOpen
        expect(openable({ opportunity: { sale_type_id: "st-1", flow_snapshot_id: "snap-1" }, snapshot })).toBe(true)
        expect(openable({ opportunity: { sale_type_id: null } })).toBe(false)
        expect(openable({ opportunity: { sale_type_id: "st-1", flow_snapshot_id: null } })).toBe(false)
        expect(openable({ opportunity: { sale_type_id: "st-1", flow_snapshot_id: "snap-1" }, snapshot: null })).toBe(false)
    })
})
