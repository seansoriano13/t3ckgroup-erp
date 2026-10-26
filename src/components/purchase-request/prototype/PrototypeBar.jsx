/**
 * REMOVE-BEFORE-PROD (ADR 0028): the switcher bar of the Product status
 * prototype, in the style of the SOR modal layout switcher: a dark strip with
 * the views, plus "View as" to hide the Purchasing-only controls.
 */
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VIEWS } from "./data";
import { ROLE } from "./lineState";

const ROLES = [
  { key: ROLE.PURCHASING, label: "Purchasing" },
  { key: ROLE.SALES, label: "Sales" },
];

const ACTIVE = "bg-mauve-1 text-mauve-12 hover:bg-mauve-1 hover:text-mauve-12";
const IDLE = "text-mauve-1 hover:bg-mauve-11 hover:text-mauve-1";

export default function PrototypeBar({ view, onView, role, onRole }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-mauve-12 px-3 py-2 text-mauve-1" data-testid="prototype-bar">
      <span className="text-[9px] font-black tracking-[0.2em] text-mauve-8 uppercase">Product status prototype</span>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <Button
            key={v.key}
            type="button"
            size="xs"
            variant="ghost"
            aria-pressed={view === v.key}
            onClick={() => onView(v.key)}
            className={cn("font-bold", view === v.key ? ACTIVE : IDLE)}
          >
            {v.label}
          </Button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1" role="group" aria-label="View as">
        <span className="mr-1 text-xs text-mauve-8">View as:</span>
        {ROLES.map((r) => (
          <Button
            key={r.key}
            type="button"
            size="xs"
            variant="ghost"
            aria-pressed={role === r.key}
            onClick={() => onRole(r.key)}
            className={cn("font-bold", role === r.key ? ACTIVE : IDLE)}
          >
            {r.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
