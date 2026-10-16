import { useState } from "react";

export const ALL = "ALL";
const NO_FILTERS = { entity: ALL, source: ALL, sorId: ALL, supplier: ALL, state: ALL };

/**
 * The register's search and filters, kept by the page so the filter bar can sit
 * in PageShell's toolbar slot while the table sits in the body. `query` is what
 * the service takes.
 */
export function useOrderRegisterFilters() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const set = (key) => (value) => setFilters((current) => ({ ...current, [key]: value }));
  const clearAll = () => {
    setSearch("");
    setFilters(NO_FILTERS);
  };
  const query = {
    search,
    entity: filters.entity === ALL ? null : filters.entity,
    source: filters.source === ALL ? null : filters.source,
    sorId: filters.sorId === ALL ? null : filters.sorId,
    supplier: filters.supplier === ALL ? null : filters.supplier,
    state: filters.state === ALL ? null : filters.state,
  };
  const hasActiveFilters = Boolean(search.trim()) || Object.values(filters).some((value) => value !== ALL);
  return { search, setSearch, filters, set, clearAll, query, hasActiveFilters };
}
