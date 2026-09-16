import React from "react";
import { ChevronDown } from "lucide-react";

/**
 * FilterTrigger - A standardized trigger button for filter dropdowns.
 */
export function FilterTrigger({
  label,
  isActive,
  isOpen,
  icon: Icon,
  disabled,
  className,
}) {
  return (
    <div
      className={`h-[46px] w-full flex items-center justify-between px-3 rounded-lg border transition-all cursor-pointer ${disabled ? "opacity-50 pointer-events-none" : ""
        } ${isOpen || isActive
          ? "ring-1 ring-mauve-4 bg-muted font-medium"
          : "bg-card border-border hover:border-border/80"
        } ${className || ""}`}
    >
      <div className="flex items-center gap-2 overflow-hidden flex-1">
        {Icon && (
          <Icon
            size={14}
            className={`shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground"}`}
          />
        )}
        <span className="text-[13px] text-foreground font-semibold truncate block w-full text-left">
          {label}
        </span>
      </div>
      <ChevronDown
        size={14}
        className={`ml-1 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""
          }`}
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
