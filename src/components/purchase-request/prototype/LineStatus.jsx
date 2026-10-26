/**
 * REMOVE-BEFORE-PROD (ADR 0028): the status cell and the line menu of the
 * Product status prototype. Same idiom as RequestedItemActions (a badge that
 * opens a small menu), without any service behind it.
 */
import { useState } from "react";
import { Ban, CheckCheck, ChevronDown, Warehouse } from "lucide-react";

import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dropdown from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";
import { AUTOMATIC_REASON, ROLE, STATUS, STATUS_BADGE_THEME } from "./lineState";

const ICON = {
  [STATUS.AVAILABLE]: Warehouse,
  [STATUS.RECEIVED]: CheckCheck,
  [STATUS.CANCELLED]: Ban,
};

const MENU_POPOVER = "bg-muted border border-border rounded-xl shadow-lg z-[10001] min-w-[180px] p-1 popover-enter";

function MenuItem({ children, onClick, tone }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold",
        tone === "destructive"
          ? "text-destructive hover:bg-destructive/15 hover:text-destructive"
          : "text-foreground hover:bg-mauve-4 hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

/** One status, one badge. Icons keep Available, Received and Cancelled apart from a plain hue. */
export function StatusPill({ status, menu = false, title }) {
  const Icon = ICON[status];
  return (
    <StatusBadge theme={STATUS_BADGE_THEME[status]} title={title} className="gap-1">
      {Icon && <Icon size={11} aria-hidden="true" />}
      <span className={cn(status === STATUS.CANCELLED && "line-through")}>{status}</span>
      {menu && <ChevronDown size={10} aria-hidden="true" className="-mr-0.5 shrink-0 opacity-70" />}
    </StatusBadge>
  );
}

const CONFIRM = {
  [STATUS.CANNOT_SOURCE]: {
    title: "Mark as Cannot source?",
    description: "Sales will know to re-price the line or drop it. You can change it again later.",
    confirmLabel: "Cannot source",
  },
  [STATUS.CANCELLED]: {
    title: "Cancel this line?",
    description: "Purchasing stops working on it. To say what replaces it, use Replace instead.",
    confirmLabel: "Cancel line",
  },
};

/** What a person may choose by hand for this line. Statuses that Odoo or a Canvass sets are never offered. */
function handChoices(line, role) {
  const locked = [STATUS.CANVASSING, STATUS.PURCHASED, STATUS.RECEIVED, STATUS.CANCELLED].includes(line.status);
  if (locked) return { steps: [], ways: [] };
  return {
    steps: [STATUS.AVAILABLE, STATUS.TO_PURCHASE].filter((s) => s !== line.status),
    ways: [
      ...(role === ROLE.PURCHASING && line.status !== STATUS.CANNOT_SOURCE ? [STATUS.CANNOT_SOURCE] : []),
      STATUS.CANCELLED,
    ],
  };
}

export function StatusCell({ line, role, onChoose }) {
  const [confirming, setConfirming] = useState(null);
  const { steps, ways } = handChoices(line, role);

  if (steps.length === 0 && ways.length === 0) {
    return <StatusPill status={line.status} title={AUTOMATIC_REASON[line.status]} />;
  }

  const choose = (status) => (CONFIRM[status] ? setConfirming(status) : onChoose(line.id, status));
  const confirm = confirming && CONFIRM[confirming];

  return (
    <>
      <Dropdown
        usePortal
        placement="bottom-start"
        matchTriggerWidth={false}
        popoverClassName={MENU_POPOVER}
        trigger={
          <Button
            type="button"
            variant="ghost"
            aria-label={`Change status of ${line.name}`}
            className="h-auto rounded-full p-0 hover:bg-transparent"
          >
            <StatusPill status={line.status} menu />
          </Button>
        }
      >
        {({ close }) => (
          <div role="menu" className="flex min-w-[180px] flex-col p-1">
            <p className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground">Set by hand</p>
            {steps.map((status) => (
              <MenuItem
                key={status}
                onClick={() => {
                  close();
                  choose(status);
                }}
              >
                {status}
              </MenuItem>
            ))}
            {steps.length > 0 && <div className="my-1 h-px bg-border" />}
            {ways.map((status) => (
              <MenuItem
                key={status}
                tone={status === STATUS.CANCELLED ? "destructive" : undefined}
                onClick={() => {
                  close();
                  choose(status);
                }}
              >
                {status === STATUS.CANCELLED ? "Cancel line" : status}
              </MenuItem>
            ))}
          </div>
        )}
      </Dropdown>
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        cancelLabel="Keep it"
        tone="destructive"
        onConfirm={() => onChoose(line.id, confirming)}
      />
    </>
  );
}
