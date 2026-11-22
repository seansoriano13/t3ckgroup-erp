import PropertyPill from "@/components/ui/PropertyPill";
import Dropdown from "@/components/ui/Dropdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PILL = "inline-flex max-w-full items-baseline gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[13px]";

function ReadOnlyPill({ label, value }) {
  return (
    <span className={PILL}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-semibold text-foreground">{value}</span>
    </span>
  );
}

function PickerPill({ label, value, options, onChange, footer }) {
  return (
    <Dropdown
      usePortal
      matchTriggerWidth={false}
      popoverClassName="popover-enter z-[10001] w-max min-w-40 rounded-xl bg-popover p-1.5 shadow-lg ring-1 ring-mauve-6"
      trigger={
        <PropertyPill isActive>
          <span className="text-muted-foreground">{label}</span> <span className="font-semibold">{value}</span>
        </PropertyPill>
      }
    >
      {({ close }) => (
        <div role="listbox" aria-label={label} className="flex flex-col gap-0.5">
          {options.map((option) => (
            <Button
              key={option.value}
              role="option"
              aria-selected={option.label === value}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              variant="ghost"
              className="h-auto flex-col items-start gap-0 rounded-lg px-2.5 py-2 text-left text-sm font-normal"
              onClick={() => {
                close();
                onChange(option.value);
              }}
            >
              <span>{option.label}</span>
              {option.hint && <span className="text-xs text-muted-foreground">{option.hint}</span>}
            </Button>
          ))}
          {footer && <div className="mt-1 border-t border-border pt-1">{footer({ close })}</div>}
        </div>
      )}
    </Dropdown>
  );
}

/**
 * A record's headline facts as a row of pills under its title. `items` is
 * `[{ key, label, value, options?, onChange? }]`. A pill with both `options`
 * (`[{ value, label }]`) and `onChange` is one the viewer may change: it opens
 * a picker; its options may be `disabled` and carry a `hint`, and `footer({ close })` adds a
 * last row. `after` is a node shown beside the pill. The rest are read-only. An item with no value is left out.
 */
export default function PropertyPills({ items, className }) {
  const shown = items.filter((item) => item.value);
  if (shown.length === 0) return null;
  return (
    <div className={cn("flex flex-nowrap gap-2 overflow-x-auto [&>*]:shrink-0", className)}>
      {shown.map((item) => {
        const pill =
          item.options && item.onChange ? (
            <PickerPill key={item.key ?? item.label} {...item} />
          ) : (
            <ReadOnlyPill key={item.key ?? item.label} label={item.label} value={item.value} />
          );
        if (!item.after) return pill;
        return (
          <span key={item.key ?? item.label} className="inline-flex items-center gap-1">
            {pill}
            {item.after}
          </span>
        );
      })}
    </div>
  );
}
