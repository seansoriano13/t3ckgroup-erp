import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag, Store, CircleDot, UserRound } from "lucide-react";
import FilterBar from "../ui/FilterBar";
import { FilterSelect } from "../ui/FilterDropdown";
import { retailOrdersQuery } from "../../services/retailOrderService";
import {
  DEFAULT_RETAIL_FILTERS,
  RETAIL_FILTER_ALL,
  filterOptions,
  hasActiveFilters,
} from "../../utils/retailReport";

const STATUS_OPTIONS = [
  { value: RETAIL_FILTER_ALL, label: "All Statuses" },
  { value: "ok", label: "OK" },
  { value: "missing", label: "Missing" },
  { value: "suspect", label: "Suspect" },
];

const withAll = (label, values) => [
  { value: RETAIL_FILTER_ALL, label },
  ...values.map((value) => ({ value, label: value })),
];

const chip = "h-9 w-auto gap-2 px-2.5";

/**
 * The Retail screen's filter line (FilterBar): a Marketplace Order ID search,
 * Marketplace, salesperson and income status inline, Storefront behind
 * Filters. `filters` is the page's whole filter set (`DEFAULT_RETAIL_FILTERS`
 * shape) and `onChange(key, value)` sets one of them; the pure report module
 * applies them (`applyFilters`), so every figure follows.
 *
 * Choices come from the same Retail orders the report reads (one cache entry),
 * so a filter only offers what exists.
 */
export default function RetailFilterBar({ filters, onChange, onClearAll }) {
  const { data: orders = [] } = useQuery(retailOrdersQuery);
  const { marketplace } = filters;
  const options = useMemo(() => filterOptions(orders, { marketplace }), [orders, marketplace]);

  const activeCount = filters.storefront !== RETAIL_FILTER_ALL ? 1 : 0;

  return (
    <FilterBar
      search={{
        value: filters.search,
        onChange: (value) => onChange("search", value),
        placeholder: "Search Marketplace Order ID",
      }}
      chips={
        <>
          <FilterSelect
            icon={ShoppingBag}
            label="Marketplace"
            options={withAll("All Marketplaces", options.marketplace)}
            value={filters.marketplace}
            onChange={(value) => {
              onChange("marketplace", value);
              // Another Marketplace has other Storefronts: the old pick no longer applies.
              onChange("storefront", DEFAULT_RETAIL_FILTERS.storefront);
            }}
            allValue={RETAIL_FILTER_ALL}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
          <FilterSelect
            icon={UserRound}
            label="Salesperson"
            options={withAll("All Salespeople", options.salesperson)}
            value={filters.salesperson}
            onChange={(value) => onChange("salesperson", value)}
            allValue={RETAIL_FILTER_ALL}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
          <FilterSelect
            icon={CircleDot}
            label="Income status"
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={(value) => onChange("status", value)}
            allValue={RETAIL_FILTER_ALL}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
        </>
      }
      filters={
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <FilterSelect
            icon={Store}
            label="Storefront"
            options={withAll("All Storefronts", options.storefront)}
            value={filters.storefront}
            onChange={(value) => onChange("storefront", value)}
            allValue={RETAIL_FILTER_ALL}
          />
        </div>
      }
      activeCount={activeCount}
      hasActiveFilters={hasActiveFilters(filters)}
      onClearAll={onClearAll}
    />
  );
}
