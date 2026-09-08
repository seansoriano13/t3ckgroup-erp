/**
 * Shared department-head matching rule.
 *
 * A sub-department head wins over a department-level one, and a
 * department head only owns employees with no sub-department of their
 * own. This module is pure — callers supply the candidate `heads` list
 * (already scoped to `is_head = true`, not deleted) and get back every
 * match, ranked best-first, so they can decide single-vs-many for
 * themselves (pre-fill a field only on an exact single match, notify
 * every match, etc).
 */

const norm = (s) => (s || "").trim().toLowerCase();
const sameText = (a, b) => !!a && !!b && norm(a) === norm(b);

/**
 * Finds every head who could own `target`, best match first.
 *
 * `target` is `{ department, sub_department }` — either an employee or a
 * plain department/sub-department pair (e.g. from a form string).
 * `heads` is the candidate pool: rows with `department`/`sub_department`
 * (and whatever else the caller wants, e.g. `id`, `name`).
 *
 * Returns [] when there's nothing to match against or no heads qualify.
 */
function resolveHeads(target, heads) {
  const department = target?.department;
  const subDepartment = target?.sub_department;
  if (!department && !subDepartment) return [];
  if (!heads?.length) return [];

  const bySubDept = heads.filter((h) => sameText(h.sub_department, subDepartment));
  const byDept = heads.filter(
    (h) => sameText(h.department, department) && !h.sub_department
  );

  // De-dupe while preserving priority (sub-dept match ranks above dept match).
  const seen = new Set();
  const ranked = [];
  for (const h of [...bySubDept, ...byDept]) {
    const key = h.id ?? h;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(h);
  }
  return ranked;
}

/** Convenience wrapper returning only the best match, or null. */
function resolveHead(target, heads) {
  return resolveHeads(target, heads)[0] || null;
}

export const headResolver = { resolveHeads, resolveHead };
