import { useMemo, useState } from "react";

import { NEXT_FILTER } from "../../../../utils/purchasingTracker";

export const ALL = "ALL";
/** The Canvass filter's one narrowing choice: items ordered with no canvass. */
export const NO_CANVASS = "no-canvass";
export const FILED_INCLUDED = "included";

const NONE = {
  stage: ALL,
  next: NEXT_FILTER.ALL,
  buyerId: ALL,
  canvasserId: ALL,
  age: ALL,
  canvass: ALL,
  entity: ALL,
  source: ALL,
  supplier: ALL,
  filed: ALL,
};

/** The Popover's filters: the ones the Filters button counts. */
const POPOVER = ["canvasserId", "age", "canvass", "entity", "source", "supplier", "filed"];

/**
 * The tracker's search and filters, kept by the page. `query` is what
 * `buildTracker` takes as `filters`; `bar` is what the filter bar needs.
 */
export function useTrackerFilters() {
  const [search, setSearch] = useState("");
  const [values, setValues] = useState(NONE);
  const set = (key) => (value) => setValues((current) => ({ ...current, [key]: value }));
  const clearAll = () => {
    setSearch("");
    setValues(NONE);
  };
  const none = (value) => (value === ALL ? null : value);

  const query = useMemo(
    () => ({
      search,
      stage: none(values.stage),
      next: values.next,
      buyerId: none(values.buyerId),
      canvasserId: none(values.canvasserId),
      minAgeDays: values.age === ALL ? null : Number(values.age),
      noCanvass: values.canvass === NO_CANVASS,
      entity: none(values.entity),
      source: none(values.source),
      supplier: none(values.supplier),
      showFiled: values.filed === FILED_INCLUDED,
    }),
    [search, values],
  );
  const hasActiveFilters = Boolean(search.trim()) || Object.keys(NONE).some((key) => values[key] !== NONE[key]);
  const activeCount = POPOVER.filter((key) => values[key] !== NONE[key]).length;
  return { search, setSearch, values, set, clearAll, query, hasActiveFilters, activeCount };
}
