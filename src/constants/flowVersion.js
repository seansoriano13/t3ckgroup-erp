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
 * and the answer is not always a number. There are three states worth telling
 * apart:
 *
 *   legacy    the deal runs on pipeline stage codes — no Sale Type, or a flow
 *             with no version on record (Legacy Pipeline after the cutover
 *             backfill, #414). It moves the way SORs always did.
 *   pinned    the ordinary case: a version, on record, openable.
 *   loading   pinned, but the snapshot has not come back yet.
 */

/**
 * A Flow Snapshot's number as `vX.Y`.
 *
 * `version` is the major part; `version_minor` is the minor, added by #188 and
 * absent on rows locked before it — those read as `N.0`, which is why the
 * fallback is `0` rather than throwing. The rule that decides which part moves
 * on a publish lives in the `flow_snapshot_next_version` SQL function (ADR
 * 0020), never here.
 */
export function formatSnapshotVersion(snapshot) {
    if (!snapshot || snapshot.version == null) return null
    return `v${snapshot.version}.${snapshot.version_minor ?? 0}`
}

/** `v3.2` from a bare pair of numbers — the Publish button's preview. */
export function formatVersionNumber(major, minor) {
    return `v${major}.${minor ?? 0}`
}

/** Human-readable summary of the flow version an SOR is pinned to. */
export function describeFlowVersion({ opportunity, snapshot = null, saleTypeName = null } = {}) {
    const base = {
        saleTypeName,
        snapshotId: null,
        version: null,
        versionMinor: null,
        versionLabel: null,
        publishedAt: null,
        canOpen: false,
    }

    if (!opportunity?.sale_type_id || !opportunity.flow_snapshot_id) {
        return {
            ...base,
            kind: "legacy",
            label: "Pipeline stages",
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
        versionMinor: snapshot.version_minor ?? 0,
        versionLabel: formatSnapshotVersion(snapshot),
        publishedAt: snapshot.created_at ?? null,
        label: withSaleType(saleTypeName, formatSnapshotVersion(snapshot)),
        canOpen: true,
    }
}

/** "Government · v3.2" where the Sale Type is known, "v3.2" where it is not. */
function withSaleType(saleTypeName, suffix) {
    return saleTypeName ? `${saleTypeName} · ${suffix}` : suffix
}
