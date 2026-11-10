/**
 * #475: the Stage Visits on an SOR the viewer cannot read, so the timeline can
 * say "Notes from <Stage> · not shared with you" where they would have been,
 * instead of a silent gap.
 *
 * `visits` are the SOR's Stage Visits (with `flow_stages.name`); `visibleIds`
 * is `sor_visible_visit_ids`. A full-access viewer only ever loses a visit to a
 * Restricted Stage; anyone else loses visits outside their window.
 */
export function hiddenVisits(visits, visibleIds, accessLevel) {
  const visible = new Set(visibleIds || [])
  const reason = accessLevel === "full" ? "restricted" : "not_shared"
  return (visits || [])
    .filter((v) => !visible.has(v.id))
    .sort((a, b) => a.sequence - b.sequence)
    .map((v) => ({ id: v.id, stageName: v.flow_stages?.name ?? null, enteredAt: v.entered_at, reason }))
}

/**
 * Notes and hidden-visit placeholders as one chronological list. A placeholder
 * sits where its visit began.
 */
export function withHiddenVisits(notes, hidden) {
  const items = [
    ...(notes || []).map((note) => ({ kind: "note", at: note.created_at, note })),
    ...(hidden || []).map((visit) => ({ kind: "hidden", at: visit.enteredAt, visit })),
  ]
  if (!hidden?.length) return items.map(({ kind, note }) => ({ kind, note }))
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => new Date(a.item.at) - new Date(b.item.at) || a.index - b.index)
    .map(({ item }) => (item.kind === "note" ? { kind: "note", note: item.note } : { kind: "hidden", visit: item.visit }))
}
