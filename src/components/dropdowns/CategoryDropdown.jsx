import React, { useState, useMemo } from "react";
import Dropdown from "../ui/Dropdown";
import { Tag, ChevronDown, Search, Check } from "lucide-react";
import { FilterTrigger } from "../ui/FilterDropdown";export default function CategoryDropdown({
  value,
  onChange,
  categories = [],
  isLoading = false,
  disabled = false,
  className = "",
  triggerClassName,
  onResetOthers, // Optional callback to reset things like committeeRole when category changes
  usePortal = false,
  onClose,
}) {
  const [search, setSearch] = useState("");

  const searchedCategories = useMemo(() => {
    if (!search) return categories;
    return categories.filter(
      (cat) =>
        cat.category_id.toLowerCase().includes(search.toLowerCase()) ||
        cat.description?.toLowerCase().includes(search.toLowerCase()),
    );
  }, [categories, search]);

  return (
    <Dropdown
      disabled={disabled}
      usePortal={usePortal}
      onClose={onClose}
      className={`z-100 ${className}`}
      /* popoverClassName="absolute top-full left-0 mt-1.5 bg-muted border border-border rounded-xl shadow-2xl z-[110] w-[280px] popover-enter" */
      trigger={({ isOpen, disabled }) => 
        triggerClassName ? (
          <button
            type="button"
            className={triggerClassName}
          >
            <Tag size={13} />
            <span className={value ? "text-foreground" : "text-mauve-7"}>
              {value || "Category"}
              {!value && <span className="text-destructive ml-0.5">*</span>}
            </span>
            {!disabled && (
              <ChevronDown
                size={12}
                className={value ? "text-violet-8" : "text-mauve-7"}
              />
            )}
          </button>
        ) : (
          <FilterTrigger
            label={value || "Category"}
            isActive={!!value}
            isOpen={isOpen}
            icon={Tag}
            disabled={disabled}
          />
        )
      }
    >
      {({ close }) => (
        <>
          <div className="px-2 pt-2 pb-1 border-b border-border">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 rounded-md border border-border focus-within:border-mauve-4 focus-within:ring-1 focus-within:ring-mauve-4 transition-all">
              <Search
                size={14}
                className="text-muted-foreground shrink-0"
              />
              <input
                type="text"
                placeholder="Search categories..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent outline-none text-[13px] font-medium text-foreground placeholder:text-muted-foreground"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="max-h-[260px] overflow-y-auto p-1">
            {isLoading ? (
              <p className="text-[13px] text-mauve-7 text-center py-4 font-medium">
                Loading…
              </p>
            ) : searchedCategories.length === 0 ? (
              <p className="text-[13px] text-mauve-7 text-center py-4 font-medium">
                No categories found
              </p>
            ) : (
              searchedCategories.map((cat) => (
                <button
                  key={cat.category_id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onChange) onChange(cat.category_id);
                    if (onResetOthers) onResetOthers();
                    close();
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold transition-all active:scale-95 cursor-pointer flex items-center gap-2 ${
                    value === cat.category_id
                      ? "bg-muted/80 text-foreground font-bold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="truncate flex-1">
                    <span className="font-semibold">{cat.category_id}</span>
                    <span className="text-muted-foreground ml-1.5">
                      — {cat.description}
                    </span>
                  </span>
                  {value === cat.category_id && (
                    <Check
                      size={14}
                      className="text-muted-foreground/80 shrink-0"
                    />
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </Dropdown>
  );
}
