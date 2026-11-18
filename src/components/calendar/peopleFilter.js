/**
 * The Calendar's people filter. A selection is `{ onlyMe, people, departments }`
 * (people are ids, departments are names). Nothing chosen means no filter.
 */

export const NO_PEOPLE = { onlyMe: false, people: [], departments: [] };

export const hasPeopleFilter = (sel) => Boolean(sel.onlyMe) || sel.people.length > 0 || sel.departments.length > 0;

/** Everyone the loaded entries mention (filer, Lead, Participants), sorted by name: [{ id, name, department }]. */
export function peopleOptions(entries) {
  const byId = new Map();
  const add = (p) => {
    if (!p?.id) return;
    const known = byId.get(p.id);
    if (!known) byId.set(p.id, { id: p.id, name: p.name ?? '', department: p.department ?? null });
    else if (!known.department && p.department) known.department = p.department;
  };
  for (const e of entries ?? []) {
    add(e.employee);
    add(e.details?.facilitator);
    for (const p of e.details?.participants ?? []) add(p);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Department names among the options, sorted. */
export function departmentsOf(options) {
  return [...new Set(options.map((p) => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The set of person ids a selection stands for, or null when no filter is on. */
export function selectedIds(sel, options, viewerId) {
  if (!hasPeopleFilter(sel)) return null;
  const ids = new Set(sel.people);
  if (sel.onlyMe && viewerId) ids.add(viewerId);
  const depts = new Set(sel.departments);
  for (const p of options) if (p.department && depts.has(p.department)) ids.add(p.id);
  return ids;
}

/**
 * Entries that belong to a chosen person. Time Off and overtime belong to the
 * person they are for; an Activity to whoever filed it, leads it or is a Participant.
 */
export function filterByPeople(entries, ids) {
  if (!ids) return entries;
  return entries.filter((e) => {
    if (ids.has(e.employee?.id)) return true;
    if (e.kind !== 'MEETING') return false;
    return ids.has(e.details?.facilitator?.id) || (e.details?.participants ?? []).some((p) => ids.has(p.id));
  });
}
