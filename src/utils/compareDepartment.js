/**
 * The one place that decides whether two department (or sub-department)
 * strings refer to the same thing.
 *
 * Trims and case-folds — intentionally more permissive than a raw `===`,
 * since the same department typed with different casing or stray
 * whitespace should still match.
 */
export function sameDepartment(a, b) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
