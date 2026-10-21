import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Button } from "./ui/button";
import { canvassService } from "../services/canvassService";

export const canvassFieldClass =
  "h-auto rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-mauve-8";

/**
 * The Offer's supplier (#277): free text that suggests matching Odoo suppliers as it is typed.
 * Picking one records its Odoo id beside the name; typing again afterwards drops the id, since the
 * name no longer says which Odoo supplier it was. A supplier Odoo doesn't know is simply typed.
 */
export default function CanvassSupplierField({ value, onTyped, onPicked, label = "Supplier", autoFocus = true }) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(value.trim());

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["canvass-supplier-search", debounced],
    queryFn: () => canvassService.searchSuppliers(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 60_000,
  });

  return (
    <div className="relative min-w-0">
      <Input
        autoFocus={autoFocus}
        aria-label={label}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onTyped(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        placeholder="Supplier"
        containerClassName="min-w-0"
        className={`${canvassFieldClass} font-semibold`}
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Odoo suppliers"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-card py-1 shadow-md"
        >
          {suggestions.map((supplier) => (
            <li key={supplier.id} role="option" aria-selected={false}>
              <Button
                type="button"
                variant="ghost"
                // mousedown, not click: the input's blur would close the list before a click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPicked(supplier);
                  setOpen(false);
                }}
                className="h-auto w-full justify-start rounded-none px-2.5 py-1.5 text-left text-[13px] font-normal text-foreground"
              >
                {supplier.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
