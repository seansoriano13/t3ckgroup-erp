// Pure helpers for scripts/transfer-sales-flows.mjs (#331). No database here,
// so they can be unit-tested without a stack.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Every uuid-valued string anywhere in `value`. A snapshot doesn't label what
 * an id refers to (a selector's `id`, an action config's approver, a Stage),
 * so the caller asks the source database what each one is.
 */
export function collectUuids(value, found = new Set()) {
    if (typeof value === "string") {
        if (UUID_RE.test(value)) found.add(value.toLowerCase())
    } else if (Array.isArray(value)) {
        for (const item of value) collectUuids(item, found)
    } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) collectUuids(item, found)
    }
    return found
}

/**
 * Of the ids a snapshot references: which employees the target is missing
 * (the transfer must stop), and which Employee Groups it has to copy first.
 */
export function classifyReferences({ referenced, sourceEmployeeIds, sourceGroupIds, targetEmployeeIds, targetGroupIds }) {
    const ids = [...referenced].sort()
    return {
        missingEmployeeIds: ids.filter((id) => sourceEmployeeIds.has(id) && !targetEmployeeIds.has(id)),
        groupIdsToCopy: ids.filter((id) => sourceGroupIds.has(id) && !targetGroupIds.has(id)),
    }
}
