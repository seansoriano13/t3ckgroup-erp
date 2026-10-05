import { hasActiveFilters, isSearching } from "../../utils/retailReport";

/** What the headline's figures cover, under the filters on screen. */
export function scopeNote(filters) {
  if (isSearching(filters)) return "Matching the search, any date";
  if (hasActiveFilters(filters)) return "In the selected range, filtered";
  return "In the selected range";
}

/** The empty state's words: the range alone is blamed only when no filter is set. */
export function emptyCopy(filters) {
  if (!hasActiveFilters(filters)) return { title: "No retail orders in this range" };
  return {
    title: "No retail orders match",
    description: isSearching(filters)
      ? "Try a different Marketplace Order ID, or clear a filter."
      : "Try a wider range or clear a filter.",
  };
}
