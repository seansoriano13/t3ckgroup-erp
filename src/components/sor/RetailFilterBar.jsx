import { useMemo } from "react";
import { ShoppingBag, Store, CircleDot, UserRound } from "lucide-react";
import FilterBar from "../ui/FilterBar";
import { FilterSelect } from "../ui/FilterDropdown";
import {
  DEFAULT_RETAIL_FILTERS,
  INCOME_STATUS,
  RETAIL_FILTER_ALL,
  filterOptions,
  hasActiveFilters,
} from "../../utils/retailReport";

const STATUS_OPTIONS = [
  { value: RETAIL_FILTER_ALL, label: "All Statuses" },
  { value: INCOME_STATUS.OK, label: "OK" },
  { value: INCOME_STATUS.MISSING, label: "Missing" },
  { value: INCOME_STATUS.SUSPECT, label: "Suspect" },
];

const withAll = (label, values) => [
  { value: RETAIL_FILTER_ALL, label },
  ...values.map((value) => ({ value, label: value })),
];

const chipProps = { className: "h-9 w-auto gap-2 px-2.5", wrapperClassName: "w-auto shrink-0" };

/** A Retail filter's select: the "All" choice and its value are the same everywhere. */
function RetailFilterSelect({ chip = false, ...props }) {
  return <FilterSelect allValue={RETAIL_FILTER_ALL} {...(chip ? chipProps : {})} {...props} />;
}

/**
 * The Retail screen's filter line (FilterBar): a Marketplace Order ID search,
 * Marketplace, salesperson and income status inline, Storefront behind
 * Filters. `filters` is the page's whole filter set (`DEFAULT_RETAIL_FILTERS`
 * shape) and `onChange(key, value)` sets one of them; the pure report module
 * applies them (`applyFilters`), so every figure follows.
 *
 * `orders` are the Retail orders the report reads (the page fetches them once
 * and hands them to both), so a filter only offers what exists.
 */
export default function RetailFilterBar({ orders, filters, onChange, onClearAll }) {
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
          <RetailFilterSelect
            chip
            icon={ShoppingBag}
            label="Marketplace"
            options={withAll("All Marketplaces", options.marketplace)}
            value={filters.marketplace}
            onChange={(value) => {
              onChange("marketplace", value);
              // Another Marketplace has other Storefronts: the old pick no longer applies.
              onChange("storefront", DEFAULT_RETAIL_FILTERS.storefront);
            }}
          />
          <RetailFilterSelect
            chip
            icon={UserRound}
            label="Salesperson"
            options={withAll("All Salespeople", options.salesperson)}
            value={filters.salesperson}
            onChange={(value) => onChange("salesperson", value)}
          />
          <RetailFilterSelect
            chip
            icon={CircleDot}
            label="Income status"
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={(value) => onChange("status", value)}
          />
        </>
      }
      filters={
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <RetailFilterSelect
            icon={Store}
            label="Storefront"
            options={withAll("All Storefronts", options.storefront)}
            value={filters.storefront}
            onChange={(value) => onChange("storefront", value)}
          />
        </div>
      }
      activeCount={activeCount}
      hasActiveFilters={hasActiveFilters(filters)}
      onClearAll={onClearAll}
    />
  );
}
