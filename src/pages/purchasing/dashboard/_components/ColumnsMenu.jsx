import { Columns3 } from "lucide-react";

import Dropdown from "@/components/ui/Dropdown";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { FilterTriggerButton } from "@/components/ui/FilterDropdown";

/**
 * The Columns picker, as the IPAS list draws it: an icon button with the count
 * of hidden columns, and a checkbox per column. A `locked` column stays on.
 * `hidden` is a list of column keys; `onToggle(key)` flips one.
 */
export default function ColumnsMenu({ columns, hidden, onToggle }) {
  return (
    <Dropdown
      usePortal
      placement="bottom-end"
      matchTriggerWidth={false}
      className="w-auto shrink-0"
      trigger={({ isOpen }) => (
        <FilterTriggerButton
          popup="dialog"
          wrapperClassName="w-auto"
          className="h-9 w-auto gap-2 px-2.5"
          icon={Columns3}
          label="Columns"
          labelClassName="hidden"
          count={hidden.length}
          isActive={hidden.length > 0}
          isOpen={isOpen}
        />
      )}
    >
      {() => (
        <div className="flex max-h-[min(60vh,24rem)] w-56 flex-col gap-1 overflow-y-auto overscroll-contain p-2" role="group" aria-label="Columns shown">
          {columns.map((column) => (
            <FieldBox inline key={column.key} className="rounded-md px-1.5 py-1 text-[13px] hover:bg-muted">
              <Checkbox
                checked={column.locked || !hidden.includes(column.key)}
                disabled={column.locked}
                onCheckedChange={() => onToggle(column.key)}
                aria-label={column.label}
              />
              {column.label}
            </FieldBox>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
