import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChevronDown, Link2, ListChecks, Pencil, Replace } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dropdown from "@/components/ui/Dropdown";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "../StatusBadge";
import ReplaceItemDialog from "./ReplaceItemDialog";
import { AttachP0Dialog, CorrectPoDialog, PickPoLinesDialog } from "./PoDialogs";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import {
  ITEM_STATUS,
  ITEM_STATUS_LABELS,
  ITEM_STATUS_THEME,
  MEMBER_SIDE,
  NOT_FROM_THE_MENU,
  allowedTransitions,
  stockWarning,
} from "../../constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";
import { useRefreshRequest } from "./requestHooks";
import { useItemStatusUndo } from "./useItemStatusUndo";
import { OVER_REQUEST_MODAL } from "./stacking";

/** The database's refusal, without the function name it leads with. */
const refusal = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/** Ways out end the item for good, so they ask first. */
const CONFIRM = {
  [ITEM_STATUS.CANCELLED]: {
    title: "Cancel this item?",
    description: "Purchasing stops working on it. A cancelled item can't be reopened; request it again if it's needed.",
    confirmLabel: "Cancel item",
  },
  [ITEM_STATUS.CANNOT_SOURCE]: {
    title: "Mark as Cannot source?",
    description: "Sales will know to re-price or drop it. This closes the item.",
    confirmLabel: "Cannot source",
  },
};

const WAYS_OUT = [ITEM_STATUS.CANNOT_SOURCE, ITEM_STATUS.CANCELLED];

const THEME_STYLES = {
  green: "bg-card text-green-600 dark:text-green-400 border-green-400 hover:bg-green-3 hover:border-green-6",
  amber: "bg-card text-amber-600 dark:text-amber-400 border-amber-400 hover:bg-amber-3 hover:border-amber-6",
  blue: "bg-card text-blue-600 dark:text-blue-400 border-blue-400 hover:bg-blue-3 hover:border-blue-6",
  red: "bg-card text-red-600 dark:text-red-400 border-red-400 hover:bg-red-3 hover:border-red-6",
  violet: "bg-card text-violet-600 dark:text-violet-400 border-violet-400 hover:bg-violet-3 hover:border-violet-6",
  orange: "bg-card text-orange-600 dark:text-orange-400 border-orange-400 hover:bg-orange-3 hover:border-orange-6",
  mauve: "bg-card text-muted-foreground border-mauve-5 hover:bg-mauve-3 hover:border-mauve-7",
};

function MenuItem({ children, onClick, tone, disabled, title }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors cursor-pointer",
        tone === "destructive"
          ? "text-destructive hover:bg-destructive/15 hover:text-destructive active:bg-destructive/20"
          : "text-foreground hover:bg-mauve-4 hover:text-foreground active:bg-mauve-5",
      )}
    >
      {children}
    </Button>
  );
}

/**
 * The menu takes clicks only once its opening animation is over. Keep this a little longer than
 * the `.popover-enter` animation in src/index.css (0.15s = 150ms): change one, change the other.
 */
const MENU_OPEN_MS = 200;

/**
 * The status menu's body. A click that lands while the menu is still opening picks nothing, so a
 * quick click cannot choose whatever slid under the pointer.
 */
function StatusMenu({ close, children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), MENU_OPEN_MS);
    return () => clearTimeout(timer);
  }, []);
  // Escape closes the menu and goes no further: the request panel (a dialog) must stay open.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [close]);
  return (
    <div
      role="menu"
      aria-busy={!ready}
      className={cn("flex min-w-[180px] flex-col p-1", !ready && "pointer-events-none")}
      onClickCapture={(e) => {
        if (!ready) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * Issue #306 — what the signed-in member may do to one Requested Item, for
 * RequestedItems' row action slot.
 *
 * `actor` is `purchaseRequestService.itemActor`'s answer (`{ side,
 * canSubstitute }`). Purchasing gets a menu of the next steps on the path and
 * the ways out (and "Replace…", #687); the sales side gets
 * only Cancel; anyone else gets a static StatusBadge.
 *
 * Purchasing's "Attach P0…" (#684) opens a dialog that lists the P0s made in Odoo for the line;
 * nobody moves a line to Purchased by hand. Once an item is
 * Purchased on a PO, "Pick PO line…" appears only when that PO's IPAS copy has
 * lines to pick (none do until IPAS exists).
 */
export default function RequestedItemActions({ item, request, actor }) {
  const refresh = useRefreshRequest(request?.id);
  const announce = useItemStatusUndo(request?.id);
  const [confirming, setConfirming] = useState(null);
  const [replacing, setReplacing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pickingLines, setPickingLines] = useState(false);
  const [correctingPo, setCorrectingPo] = useState(false);
  const requestId = request?.id;
  const side = actor?.side ?? null;
  const onPo =
    side === MEMBER_SIDE.PURCHASING &&
    !!item.po_number &&
    (item.status === ITEM_STATUS.PURCHASED || item.status === ITEM_STATUS.RECEIVED);

  const { data: poLineIds = [] } = useQuery({
    queryKey: purchaseRequestKeys.poLines(requestId, item.id),
    queryFn: () => purchaseRequestService.poLines(item.id),
    enabled: onPo,
  });

  const moveMutation = useMutation({
    mutationFn: (status) => purchaseRequestService.setItemStatus(item.id, status),
    // The item as it was, for Undo to say what it goes back to.
    onMutate: () => ({ before: item }),
    onSuccess: (updated, status, { before }) =>
      announce(before, updated, `${item.name}: ${ITEM_STATUS_LABELS[status]}.`),
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });

  // #681: Still canvassing follows a Canvass and is never chosen here; choosing Available again is
  // offered only to clear a "Now x free of y" warning.
  const warned = !!stockWarning(item);
  const next = allowedTransitions(item.status, side).filter(
    (status) => !NOT_FROM_THE_MENU.includes(status) && (status !== item.status || warned),
  );
  // #687: only Purchasing replaces; a Cancelled or Received line is shut.
  const canReplace =
    side === MEMBER_SIDE.PURCHASING &&
    item.status !== ITEM_STATUS.CANCELLED &&
    item.status !== ITEM_STATUS.RECEIVED;
  const canPickLines = onPo && poLineIds.length > 0;
  // #549: Purchasing can correct the PO while the item is Ordered; Received is fixed.
  const canCorrectPo = side === MEMBER_SIDE.PURCHASING && item.status === ITEM_STATUS.PURCHASED;
  // #684: Purchasing attaches the P0 they made in Odoo; nobody picks Purchased by hand. Off on a
  // Cancelled or Received line.
  const isPurchasing = side === MEMBER_SIDE.PURCHASING;
  const nothingToAttach = item.status === ITEM_STATUS.CANCELLED || item.status === ITEM_STATUS.RECEIVED;
  const canInteract = next.length > 0 || canReplace || canPickLines || canCorrectPo || (isPurchasing && !nothingToAttach);

  if (!canInteract) {
    return (
      <StatusBadge
        label={ITEM_STATUS_LABELS[item.status] || item.status}
        theme={ITEM_STATUS_THEME[item.status]}
      />
    );
  }

  const choose = (status) => {
    if (CONFIRM[status]) setConfirming(status);
    else moveMutation.mutate(status);
  };
  const busy = moveMutation.isPending;

  const confirm = confirming && CONFIRM[confirming];
  const dialogs = (
    <>
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        cancelLabel="Keep it"
        tone="destructive"
        className={OVER_REQUEST_MODAL}
        onConfirm={() => moveMutation.mutate(confirming)}
      />
      {canReplace && replacing && (
        <ReplaceItemDialog open onOpenChange={setReplacing} item={item} requestId={requestId} />
      )}
      {attaching && <AttachP0Dialog open onOpenChange={setAttaching} item={item} request={request} />}
      {canCorrectPo && correctingPo && (
        <CorrectPoDialog open onOpenChange={setCorrectingPo} item={item} requestId={requestId} />
      )}
      {canPickLines && pickingLines && (
        <PickPoLinesDialog open onOpenChange={setPickingLines} item={item} requestId={requestId} lineIds={poLineIds} />
      )}
    </>
  );

  const theme = ITEM_STATUS_THEME[item.status] || "mauve";
  const appliedTheme = THEME_STYLES[theme] || THEME_STYLES.mauve;
  const onPath = next.filter((s) => !WAYS_OUT.includes(s));
  const waysOut = next.filter((s) => WAYS_OUT.includes(s));

  return (
    <>
      <Dropdown
        usePortal
        placement="bottom-end"
        matchTriggerWidth={false}
        disabled={busy}
        popoverClassName="bg-muted border border-border rounded-xl shadow-lg z-[10001] min-w-[180px] p-1 popover-enter"
        trigger={
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            aria-label={`Change status of ${item.name}`}
            className={cn(
              "inline-flex items-center justify-center h-6 px-2 py-0 text-label font-bold uppercase tracking-wider border rounded-full whitespace-nowrap gap-1 cursor-pointer transition-colors active:scale-95 shadow-none leading-none shrink-0",
              appliedTheme,
            )}
          >
            {busy && <Spinner size="sm" />}
            <span>{ITEM_STATUS_LABELS[item.status] || item.status}</span>
            <ChevronDown size={10} className="shrink-0 -mr-0.5 opacity-70" />
          </Button>
        }
      >
        {({ close }) => (
          <StatusMenu close={close}>
            {onPath.map((status) => (
              <MenuItem
                key={status}
                onClick={() => {
                  close();
                  choose(status);
                }}
              >
                {ITEM_STATUS_LABELS[status]}
              </MenuItem>
            ))}
            {isPurchasing && (
              <MenuItem
                disabled={nothingToAttach}
                title={nothingToAttach ? "Nothing to attach to this line." : undefined}
                onClick={() => {
                  close();
                  setAttaching(true);
                }}
              >
                <Link2 size={14} />
                Attach P0…
              </MenuItem>
            )}
            {canPickLines && (
              <MenuItem
                onClick={() => {
                  close();
                  setPickingLines(true);
                }}
              >
                <ListChecks size={14} />
                Pick PO line…
              </MenuItem>
            )}
            {canCorrectPo && (
              <MenuItem
                onClick={() => {
                  close();
                  setCorrectingPo(true);
                }}
              >
                <Pencil size={14} />
                Correct PO…
              </MenuItem>
            )}
            {(onPath.length > 0 || isPurchasing || canPickLines || canCorrectPo) && (waysOut.length > 0 || canReplace) && (
              <div className="my-1 h-px bg-border" />
            )}
            {canReplace && (
              <MenuItem
                onClick={() => {
                  close();
                  setReplacing(true);
                }}
              >
                <Replace size={14} />
                Replace…
              </MenuItem>
            )}
            {waysOut.map((status) => (
              <MenuItem
                key={status}
                tone={status === ITEM_STATUS.CANCELLED ? "destructive" : undefined}
                onClick={() => {
                  close();
                  choose(status);
                }}
              >
                {status === ITEM_STATUS.CANCELLED ? "Cancel item" : ITEM_STATUS_LABELS[status]}
              </MenuItem>
            ))}
          </StatusMenu>
        )}
      </Dropdown>
      {dialogs}
    </>
  );
}
