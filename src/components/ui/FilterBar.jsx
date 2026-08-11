import { useState } from "react";
import { Filter } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

/**
 * FilterBar provides a dual-row filtering layout:
 * - The primary row contains search, primary filters, the "Add Filter" button, and optional actions (like Tabs).
 * - The secondary row (toggled via "Add Filter") houses advanced dropdown filters.
 */
export default function FilterBar({
  children,
  advancedFilters,
  isAdvancedOpen,
  onAdvancedOpenChange,
  defaultAdvancedOpen = false,
  hasActiveFilters = false,
  onClearAll,
  className,
  actions,
}) {
  const [internalOpen, setInternalOpen] = useState(defaultAdvancedOpen);
  const open = isAdvancedOpen !== undefined ? isAdvancedOpen : internalOpen;

  const toggle = () => {
    const next = !open;
    setInternalOpen(next);
    onAdvancedOpenChange?.(next);
  };

  return (
    <div className={cn("grid gap-3 md:gap-4", className)}>
      <div className="bg-card border border-border p-3 md:p-4 rounded-xl flex flex-col xl:flex-row items-stretch xl:items-center gap-3 md:gap-4 relative z-20">
        
        <div className="flex flex-1 items-center gap-2.5 flex-wrap">
          {children}
          {advancedFilters && (
            <Button
              variant={open ? "secondary" : "outline"}
              onClick={toggle}
              className="flex items-center gap-2 h-10 px-4 text-[13px] shrink-0 font-semibold rounded-xl"
            >
              <Filter size={15} />
              Add Filter
            </Button>
          )}
        </div>

        {(actions || (hasActiveFilters && onClearAll)) && (
          <div className="flex items-center justify-between xl:justify-end gap-3 w-full xl:w-auto shrink-0">
            {actions}
            {hasActiveFilters && onClearAll && (
              <button
                onClick={onClearAll}
                className="text-sm text-muted-foreground hover:text-foreground font-semibold px-3 py-2 shrink-0 transition-colors"
              >
                Clear All
              </button>
            )}
          </div>
        )}
      </div>

      {open && advancedFilters && (
        <div className="bg-muted/40 border border-border p-4 rounded-xl flex flex-wrap gap-3 relative z-10 animate-in fade-in slide-in-from-top-2 duration-200">
          {advancedFilters}
        </div>
      )}
    </div>
  );
}
