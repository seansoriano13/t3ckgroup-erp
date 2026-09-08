/**
 * What an SOR should say about the Sales Flow it runs.
 *
 * A deal's rules are pinned at registration to a Flow Snapshot — its
 * `flow_snapshot_id` — and stay on that version for the deal's whole life,
 * while the flow itself carries on being edited and locked into later
 * versions. That is deliberate (ADR 0006, issue #83): a change to a flow moves
 * future deals, never deals already in flight.
 *
 * The consequence is that "which version is this deal on?" is a real question,
 * and the answer is not always a number. There are four states worth telling
 * apart, and rendering a blank for three of them tells the reader nothing:
 *
 *   legacy    the deal runs no flow at all — registered before Sales Flows,
 *             or against a Sale Type that has none. Every SOR in production
 *             is currently this.
 *   pinned    the ordinary case: a version, on record, openable.
 *   unpinned  runs a flow but carries no snapshot. Not a valid state —
 *             `snapshotContextFor` already refuses to move such a deal — so
 *             this says so rather than pretending.
 *   loading   pinned, but the snapshot has not come back yet. Distinct from
 *             `unpinned`, because accusing a healthy deal of being malformed
 *             for the first few hundred milliseconds of every modal is worse
 *             than saying nothing.
 */

/** Human-readable summary of the flow version an SOR is pinned to. */
export function describeFlowVersion({ opportunity, snapshot = null, saleTypeName = null } = {}) {
    const base = { saleTypeName, snapshotId: null, version: null, publishedAt: null, canOpen: false }

    if (!opportunity?.sale_type_id) {
        return {
            ...base,
            kind: "legacy",
            label: "Pipeline stages",
        }
    }

    if (!opportunity.flow_snapshot_id) {
        return {
            ...base,
            kind: "unpinned",
            label: withSaleType(saleTypeName, "no version on record"),
        }
    }

    if (!snapshot) {
        return {
            ...base,
            kind: "loading",
            snapshotId: opportunity.flow_snapshot_id,
            label: withSaleType(saleTypeName, "loading version"),
        }
    }

    return {
        ...base,
        kind: "pinned",
        snapshotId: snapshot.id,
        version: snapshot.version,
        publishedAt: snapshot.created_at ?? null,
        label: withSaleType(saleTypeName, `v${snapshot.version}`),
        canOpen: true,
    }
}

/** "Government · v3" where the Sale Type is known, "v3" where it is not. */
function withSaleType(saleTypeName, suffix) {
    return saleTypeName ? `${saleTypeName} · ${suffix}` : suffix
}
