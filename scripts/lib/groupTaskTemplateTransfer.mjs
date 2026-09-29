// Pure planning for scripts/transfer-group-task-templates.mjs (#419). No
// database here, so it can be unit-tested without a stack.

const norm = (s) => String(s ?? "").trim().toLowerCase()

/**
 * Remap every employee reference by name and check for clashes. Returns
 * `errors` (non-empty means stop, write nothing) and the remapped rows.
 * A null member employee_id stays null (the source row already had none).
 */
export function planTemplateTransfer({ templates, members, sourceEmployees, targetEmployees, targetTemplateNames }) {
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

    const errors = []
    const taken = new Set(targetTemplateNames.map(norm))
    for (const t of templates) {
        if (taken.has(norm(t.name))) errors.push(`Target already has a template named "${t.name}".`)
    }

    const outTemplates = templates.map((t) => ({ ...t, created_by: remap(t.created_by) }))
    const outMembers = members.map((m) => ({ ...m, employee_id: remap(m.employee_id) }))

    if (missing.size) errors.push(`Employees missing on the target (by name): ${[...missing].join(", ")}`)
    if (ambiguous.size) errors.push(`Employees ambiguous on the target (by name): ${[...ambiguous].join(", ")}`)
    return { errors, templates: outTemplates, members: outMembers }
}
