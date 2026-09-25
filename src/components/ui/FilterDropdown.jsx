import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * FilterTrigger - A standardized trigger button for filter dropdowns.
 *
 * Classes go through cn() so a caller's `className` actually wins: the SORs
 * register's toolbar trigger sits in a row of h-9 controls, while the triggers
 * stacked inside a filter popover keep the taller default.
 *
 * `count` renders how many filters are currently set — the badge the trigger
 * needs once the filters themselves are folded away behind it.
 */
export function FilterTrigger({
  label,
  isActive,
  isOpen,
  icon: Icon,
  count,
  disabled,
  className,
  labelClassName,
}) {
  return (
    <div
      // Survives labelClassName hiding the text on a narrow screen.
      title={typeof label === "string" ? label : undefined}
      className={cn(
        "flex h-[46px] w-full cursor-pointer items-center justify-between rounded-lg border px-3 transition-all",
        disabled && "pointer-events-none opacity-50",
        isOpen || isActive
          ? "bg-muted font-medium ring-1 ring-mauve-4"
          : "border-border bg-card hover:border-border/80",
        className,
      )}
    >
      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        {Icon && (
          <Icon
            size={14}
            className={cn("shrink-0", isActive ? "text-foreground" : "text-muted-foreground")}
          />
        )}
        <span
          className={cn(
            "block w-full truncate text-left text-[13px] font-semibold text-foreground",
            labelClassName,
          )}
        >
          {label}
        </span>
        {count > 0 && (
          <span className="shrink-0 rounded-md bg-mauve-5 px-1.5 py-0.5 text-[11px] font-bold leading-none tabular-nums text-foreground">
            {count}
          </span>
        )}
      </div>
      <ChevronDown
        size={14}
        className={cn(
          "ml-1 shrink-0 text-muted-foreground transition-transform",
          isOpen && "rotate-180",
        )}
      />
    </div>
  );
}

/**
 * FilterOptionList - A standardized list of options for filter popovers.
 * Shows a search bar when options exceed 5 items.
 */
export function FilterOptionList({ options, value, onChange, close }) {
  const [query, setQuery] = React.useState("");

  const filtered = query.trim()
    ? options.filter((opt) =>
      opt.label.toLowerCase().includes(query.trim().toLowerCase()),
    )
    : options;

  return (
    <div className="flex flex-col">
      {options.length > 5 && (
        <div className="px-2 pt-2 pb-1 border-b border-border">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-muted/50 border border-border rounded-md px-2.5 py-1.5 text-[13px] font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-mauve-4 focus:ring-1 focus:ring-mauve-4 transition-all"
          />
        </div>
      )}
      <div className="p-1 max-h-56 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-center text-[13px] text-muted-foreground py-3 font-medium">
            No results found
          </p>
        ) : (
          filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(opt.value);
                if (close) close();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all active:scale-95 cursor-pointer ${value === opt.value
                ? "bg-muted/80 text-foreground font-bold"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
            >
              {opt.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * MultiFilterOptionList - Same popover as FilterOptionList, but each option is
 * a checkbox and the popover stays open across picks (a tag filter is "match
 * any of these", not a single value to swap out).
 */
export function MultiFilterOptionList({ options, values = [], onChange }) {
  const [query, setQuery] = React.useState("");

  const filtered = query.trim()
    ? options.filter((opt) => opt.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const toggle = (value) => {
    if (values.includes(value)) onChange(values.filter((v) => v !== value));
    else onChange([...values, value]);
  };

  return (
    <div className="flex flex-col">
      {options.length > 5 && (
        <div className="px-2 pt-2 pb-1 border-b border-border">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-muted/50 border border-border rounded-md px-2.5 py-1.5 text-[13px] font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-mauve-4 focus:ring-1 focus:ring-mauve-4 transition-all"
          />
        </div>
      )}
      <div className="p-1 max-h-56 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-center text-[13px] text-muted-foreground py-3 font-medium">
            No results found
          </p>
        ) : (
          filtered.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(opt.value);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all active:scale-95 cursor-pointer ${checked
                  ? "bg-muted/80 text-foreground font-bold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
              >
                <span
                  className={`h-3.5 w-3.5 shrink-0 rounded border ${checked ? "bg-primary border-primary" : "border-border"}`}
                />
                {opt.label}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// Default export for convenience
export default {
  Trigger: FilterTrigger,
  OptionList: FilterOptionList,
  MultiOptionList: MultiFilterOptionList,
};
