import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import Dropdown from "./Dropdown";
import { FilterTriggerButton } from "./FilterDropdown";
import SaveDefaultButton from "./SaveDefaultButton";

/**
 * The one filter surface (DESIGN.md "Filter bar"), on a single line:
 * search, up to three inline dropdown chips, a Filters popover carrying the
 * rest with a count of how many are set, Save as default.
 *
 * - `search`       `{ value, onChange, placeholder }`
 * - `chips`        the inline dropdowns (FilterSelect); keep to three.
 * - `filters`      the popover body: a node, or `({ close }) => node`. No
 *                  Filters button is drawn without it.
 * - `activeCount`  how many of the popover's filters are set.
 * - `saveDefault`  SaveDefaultButton props (drawn compact); omit where the
 *                  page keeps none.
 * - `actions`      trailing extras (a toggle that is not a filter).
 * - `hasActiveFilters` + `onClearAll` draw a Clear all when anything (search
 *   included) narrows the list.
 *
 * `children` render after the search, like `chips`, for callers that predate
 * the named slots.
 */
export default function FilterBar({
  search,
  chips,
  children,
  filters,
  activeCount = 0,
  saveDefault,
  actions,
  hasActiveFilters = false,
  onClearAll,
  className,
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2", className)}>
      {search && (
        <Input
          icon={Search}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder ?? "Search"}
          aria-label={search.placeholder ?? "Search"}
          containerClassName="w-full sm:w-auto sm:min-w-36 sm:max-w-64 sm:flex-1"
          className="h-9 rounded-lg text-[13px]"
        />
      )}

      {chips}
      {children}

      {filters && (
        <Dropdown
          usePortal
          placement="bottom-start"
          matchTriggerWidth={false}
          className="w-auto shrink-0"
          trigger={({ isOpen }) => (
            <FilterTriggerButton
              popup="dialog"
              wrapperClassName="w-auto"
              className="h-9 w-auto gap-2 px-2.5"
              icon={SlidersHorizontal}
              label="Filters"
              count={activeCount}
              isActive={activeCount > 0}
              isOpen={isOpen}
            />
          )}
        >
          {(api) => (
            <div className="flex w-[min(90vw,560px)] flex-col gap-2.5 p-2">
              {typeof filters === "function" ? filters(api) : filters}
            </div>
          )}
        </Dropdown>
      )}

      {hasActiveFilters && onClearAll && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="shrink-0 text-muted-foreground"
        >
          Clear all
        </Button>
      )}

      {actions}

      {saveDefault && <SaveDefaultButton compact {...saveDefault} className={cn("sm:ml-auto", saveDefault.className)} />}
    </div>
  );
}
