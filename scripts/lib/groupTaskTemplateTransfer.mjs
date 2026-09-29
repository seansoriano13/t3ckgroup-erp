// Pure planning for scripts/transfer-group-task-templates.mjs (#419). No
// database here, so it can be unit-tested without a stack.

const norm = (s) => String(s ?? "").trim().toLowerCase()

/**
 * Remap every employee reference by name and check for clashes. Returns
 * `errors` (non-empty means stop, write nothing) and the remapped rows.
 * With `skipExisting`, a template whose name the target already has is left out
 * (with its members, and without checking its employees) and listed in `skipped`
 * instead of being an error. A null member employee_id stays null (the source row already had none).
 */
export function planTemplateTransfer({ templates, members, sourceEmployees, targetEmployees, targetTemplateNames, skipExisting = false, renameClashes = null, tagAll = null, unarchive = false }) {
    const sourceName = new Map(sourceEmployees.map((e) => [e.id, e.name]))
    const targetByName = new Map()
    for (const e of targetEmployees) {
        const key = norm(e.name)
        targetByName.set(key, [...(targetByName.get(key) ?? []), e.id])
    }

    const missing = new Set()
    const ambiguous = new Set()
    const remap = (sourceId) => {
        if (sourceId == null) return null
        const name = sourceName.get(sourceId)
        const hits = name == null ? [] : (targetByName.get(norm(name)) ?? [])
        if (hits.length === 1) return hits[0]
        const bucket = hits.length === 0 ? missing : ambiguous
        bucket.add(name ?? `unknown source id ${sourceId}`)
        return null
    }

    const suffix = tagAll ?? renameClashes
    const errors = []
    const taken = new Set(targetTemplateNames.map(norm))
    const clashes = templates.filter((t) => taken.has(norm(t.name)))
    if (!skipExisting && suffix == null) {
        for (const t of clashes) errors.push(`Target already has a template named "${t.name}".`)
    }
    const skippedIds = new Set(skipExisting ? clashes.map((t) => t.id) : [])

    const used = new Set(taken)
    const rename = (t) => {
        if (suffix == null) return t.name
        const tag = (n) => (n <= 1 ? suffix : suffix.replace(")", ` ${n})`))
        let n = tagAll != null ? 1 : 0
        let name = n ? `${t.name}${tag(n)}` : t.name
        while (used.has(norm(name))) name = `${t.name}${tag(++n)}`
        used.add(norm(name))
        return name
    }
    const outTemplates = templates.filter((t) => !skippedIds.has(t.id)).map((t) => ({ ...t, name: rename(t), created_by: remap(t.created_by), ...(unarchive ? { archived_at: null } : {}) }))
    const outMembers = members.filter((m) => !skippedIds.has(m.template_id)).map((m) => ({ ...m, employee_id: remap(m.employee_id) }))

    if (missing.size) errors.push(`Employees missing on the target (by name): ${[...missing].join(", ")}`)
    if (ambiguous.size) errors.push(`Employees ambiguous on the target (by name): ${[...ambiguous].join(", ")}`)
    return { errors, templates: outTemplates, members: outMembers, skipped: clashes.filter((t) => skippedIds.has(t.id)).map((t) => t.name) }
}
