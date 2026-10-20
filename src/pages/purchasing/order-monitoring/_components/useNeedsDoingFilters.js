import { useState } from "react";

export const ALL = "ALL";
const NO_FILTERS = { group: ALL, entity: ALL, source: ALL, supplier: ALL, late: ALL };

/**
 * What needs doing's search and filters, kept by the page so they survive a
 * tab switch. They narrow the rows the tab already loaded; no new query.
 */
export function useNeedsDoingFilters() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const set = (key) => (value) => setFilters((current) => ({ ...current, [key]: value }));
  const clearAll = () => {
    setSearch("");
    setFilters(NO_FILTERS);
  };
  const hasActiveFilters = Boolean(search.trim()) || Object.values(filters).some((value) => value !== ALL);
  return { search, setSearch, filters, set, clearAll, hasActiveFilters };
}

/** The same match the register's search uses: IPAS number, PO number or an S number. */
const matchesSearch = (row, needle) =>
  [row.number, row.poNumber, ...row.sors.map((sor) => sor.salesReference)].some((value) =>
    String(value ?? "").toLowerCase().includes(needle),
  );

export function applyNeedsDoingFilters(rows, { search, filters }) {
  const needle = search.trim().toLowerCase();
  return rows
    .filter((row) => filters.group === ALL || row.group === filters.group)
    .filter((row) => filters.entity === ALL || row.entity === filters.entity)
    .filter((row) => filters.source === ALL || row.source === filters.source)
    .filter((row) => filters.supplier === ALL || row.supplier === filters.supplier)
    .filter((row) => filters.late === ALL || row.late)
    .filter((row) => !needle || matchesSearch(row, needle));
}
