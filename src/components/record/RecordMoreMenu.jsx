import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import Dropdown from "@/components/ui/Dropdown";

const MENU_ITEM = "h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-normal";

/**
 * The page header's "More" menu. `items` is
 * `[{ key, label, icon, onSelect, disabled?, destructive? }]`; the first
 * destructive item sits under a rule, in the destructive look. Renders nothing
 * when there are no items.
 */
export default function RecordMoreMenu({ items }) {
  if (items.length === 0) return null;
  return (
    <Dropdown
      usePortal
      placement="bottom-end"
      popoverClassName="popover-enter z-[10001] w-max min-w-52 rounded-xl bg-popover p-1.5 shadow-lg ring-1 ring-mauve-6"
      trigger={
        <Button size="sm" variant="outline">
          <MoreHorizontal size={14} />
          More
        </Button>
      }
    >
      {({ close }) => (
        <div className="flex flex-col gap-0.5">
          {items.map((item, index) => {
            const Icon = item.icon;
            const startsDestructive = item.destructive && index > 0 && !items[index - 1].destructive;
            return (
              <div key={item.key} className="contents">
                {startsDestructive && <div className="my-1 h-px bg-border" role="separator" />}
                <Button
                  variant={item.destructive ? "destructive" : "ghost"}
                  className={MENU_ITEM}
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  {Icon && <Icon size={14} />}
                  {item.label}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}
