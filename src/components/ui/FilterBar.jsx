import { Children, Fragment, isValidElement, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import Dropdown from "./Dropdown";
import { FilterTriggerButton } from "./FilterDropdown";
import SaveDefaultButton from "./SaveDefaultButton";
import { Drawer, DrawerContent, DrawerTitle } from "./drawer";
import { useIsPhone, useLaptopBand } from "@/hooks/useScreenBand";

// Phones are below Tailwind's md; the laptop band is ADR 0051's `laptop:` query.

/** Chips arrive as nodes, often inside a fragment; list the real elements. */
function chipList(...nodes) {
  const out = [];
  const walk = (node) => {
    Children.toArray(node).forEach((child) => {
      if (isValidElement(child) && child.type === Fragment) walk(child.props.children);
      else if (isValidElement(child)) out.push(child);
    });
  };
  nodes.forEach(walk);
  return out;
}

/** Is a chip narrowing the list? `isActive` wins; a period chip is active with a date; otherwise a value other than `allValue` (default "ALL"). */
export function chipIsActive(chip) {
  const p = chip.props ?? {};
  if (p.isActive != null) return Boolean(p.isActive);
  if ("timeframe" in p) return Boolean(p.value);
  if ("value" in p) return p.value != null && p.value !== "" && p.value !== (p.allValue ?? "ALL");
  return false;
}

/**
 * The one filter surface (DESIGN.md "Filter bar"), on a single line:
 * search, up to three inline dropdown chips, a Filters popover carrying the
 * rest with a count of how many are set, Save as default.
 *
 * - `search`       `{ value, onChange, placeholder }`
 * - `chips`        the inline dropdowns (FilterSelect); keep to three.
 * - `inlineChips`  how many chips stay on the line; the rest move into the
 *                  Filters popover. Defaults to 3, 2 in the laptop band, 0 on
 *                  phones (below 768px), where the line is the search box and
 *                  one "Filters (n)" button opening a bottom sheet with every
 *                  chip, filter, Clear all and Save as default.
 * - `filters`      the popover body: a node, or `({ close }) => node`. No
 *                  Filters button is drawn without it.
 * - `activeCount`  how many of the popover's filters are set. Chips that moved
 *                  into the popover or sheet that are set are added to the
 *                  count by FilterBar.
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
  inlineChips,
  children,
  filters,
  activeCount = 0,
  saveDefault,
  actions,
  hasActiveFilters = false,
  onClearAll,
  className,
}) {
  const phone = useIsPhone();
  const band = useLaptopBand();
  const limit = phone ? 0 : (inlineChips ?? (band ? 2 : 3));
  const all = chipList(chips, children);
  const inline = all.slice(0, limit);
  const folded = all.slice(limit);
  const count = activeCount + folded.filter(chipIsActive).length;
  const hasFolded = folded.length > 0;
  const showFilters = Boolean(filters) || hasFolded;
  const [sheetOpen, setSheetOpen] = useState(false);

  const body = (api) => (
    <>
      {hasFolded && (
        <div className="flex flex-wrap items-center gap-2" data-testid="filterbar-folded-chips">
          {folded}
        </div>
      )}
      {typeof filters === "function" ? filters(api) : filters}
    </>
  );

  const clearAll = hasActiveFilters && onClearAll && (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClearAll}
      className="shrink-0 text-muted-foreground"
    >
      Clear all
    </Button>
  );

  const trigger = ({ isOpen } = {}) => (
    <FilterTriggerButton
      popup="dialog"
      wrapperClassName="w-auto"
      className="h-9 w-auto gap-2 px-2.5"
      icon={SlidersHorizontal}
      label="Filters"
      count={count}
      isActive={count > 0}
      isOpen={isOpen}
      onClick={phone ? () => setSheetOpen(true) : undefined}
    />
  );

  return (
    <div className={cn("flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1", phone ? "flex-nowrap" : "flex-wrap", className)}>
      {search && (
        <Input
          icon={Search}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder ?? "Search"}
          aria-label={search.placeholder ?? "Search"}
          containerClassName={cn("sm:w-auto sm:min-w-36 sm:max-w-64 sm:flex-1", phone ? "min-w-0 flex-1" : "w-full")}
          className="h-9 rounded-lg text-[13px]"
        />
      )}

      {inline}

      {phone && showFilters && (
        <>
          {trigger()}
          <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
            <DrawerContent side="bottom">
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                <DrawerTitle>Filters{count > 0 ? ` (${count})` : ""}</DrawerTitle>
                {clearAll}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                {body({ close: () => setSheetOpen(false) })}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-3">
                {saveDefault ? <SaveDefaultButton {...saveDefault} /> : <span />}
                <Button type="button" size="sm" onClick={() => setSheetOpen(false)}>
                  Done
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
        </>
      )}

      {!phone && showFilters && (
        <Dropdown
          usePortal
          placement="bottom-start"
          matchTriggerWidth={false}
          className="w-auto shrink-0"
          trigger={trigger}
        >
          {(api) => (
            <div className="flex w-[min(90vw,560px)] flex-col gap-2.5 p-2">{body(api)}</div>
          )}
        </Dropdown>
      )}

      {!phone && clearAll}

      {actions}

      {!phone && saveDefault && <SaveDefaultButton compact {...saveDefault} className={cn("sm:ml-auto", saveDefault.className)} />}
    </div>
  );
}
