const SHARED_WORDS = ["COMMITTEE", "OTHERS", "CHECKLIST"];

/** Shared categories everyone gets: CHECKLIST, COMMITTEE TASK, OTHERS, and ALL. */
export function isSharedCategory(cat) {
  const text = `${cat?.category_id || ""} ${cat?.description || ""}`.toUpperCase();
  return (
    SHARED_WORDS.some((w) => text.includes(w)) ||
    cat?.sub_department === "ALL" ||
    cat?.department === "ALL"
  );
}

const norm = (v) => (v && v !== "N/A" ? v : "");

/**
 * True when the category belongs to the given department and sub-department
 * (a blank sub-department only matches blank), or is shared.
 */
export function categoryMatchesUnit(cat, department, subDepartment) {
  if (isSharedCategory(cat)) return true;
  return (
    norm(cat.department) === norm(department) &&
    norm(cat.sub_department) === norm(subDepartment)
  );
}
