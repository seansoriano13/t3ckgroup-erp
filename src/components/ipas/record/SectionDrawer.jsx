import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DRAWER_SECTIONS } from "./digest";
import MoveButton from "./MoveButton";
import { canEditSection, footerMovesFor } from "./moves";
import { CHROME, IpasSectionChrome } from "./sectionChrome";
import { useMoveConfirm } from "./useMoveConfirm";

/** Marks the drawer's own dialog, so J and K can tell it from a dialog opened on top of it. */
const DRAWER_ATTR = "data-section-drawer";

/** Typing keeps its keys: J and K in a field are letters. */
function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Another dialog (a confirmation, a reason) is open on top of the drawer. */
function otherDialogOpen() {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
    (dialog) => !dialog.hasAttribute(DRAWER_ATTR),
  );
}

/**
 * One section, slid in from the right. Previous and next step through the
 * sections (J and K too), replacing the URL entry, so Back still leaves the
 * drawer. Opening it pushed the entry (see useOpenSection). Escape and Close
 * hand focus back to the row that opened it, or to where it was when the link
 * was opened directly.
 *
 * A pinned footer carries the viewer's moves for this section (the same moves
 * as the card, each asking first) and, where the viewer may edit the section,
 * an Edit section button that opens the edit view. The money in the body is
 * read-only here.
 */
export default function SectionDrawer({ ctx, blocks, digest, index, current, step, close, getRow, onEdit }) {
  const { ipas, busy, failure } = ctx;
  // The row to return focus to. Kept while the drawer animates shut, when `current` is already gone.
  const lastKey = useRef(null);
  useEffect(() => {
    if (current) lastKey.current = current.key;
  }, [current]);

  // J and K step to the neighbour section, unless the focus is typing or another dialog is open.
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || otherDialogOpen()) return;
      const key = event.key.toLowerCase();
      if (key === "j" && index < DRAWER_SECTIONS.length - 1) {
        event.preventDefault();
        step(DRAWER_SECTIONS[index + 1].key);
      } else if (key === "k" && index > 0) {
        event.preventDefault();
        step(DRAWER_SECTIONS[index - 1].key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, index, step]);

  const returnFocus = () => getRow(lastKey.current) ?? true;
  const moves = current ? footerMovesFor(ctx, digest, current.key) : [];
  const editable = Boolean(current) && canEditSection(current.key, ctx);
  const busyNow = busy.signoff || busy.give;
  // A move that signs asks first, restating what it signs, the same as the card does.
  const { run: runFromFooter, dialog: confirmDialog } = useMoveConfirm({ digest, viewer: ctx.viewer, origin: CHROME.DRAWER });

  return (
    <Drawer open={Boolean(current)} onOpenChange={(next) => !next && close()}>
      <DrawerContent className="w-[920px]" finalFocus={returnFocus} data-section-drawer="">
        {current && (
          <>
            <div className="flex items-center gap-3 border-b border-border px-7 py-5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-medium tabular-nums text-muted-foreground">{ipas.number}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2.5">
                  <DrawerTitle className="min-w-0 text-lg font-bold">{current.title}</DrawerTitle>
                </div>
                <DrawerDescription className="mt-0.5 text-sm">{digest.lines[current.key]}</DrawerDescription>
              </div>
              <Button
                variant="outline"
                size="icon"
                disabled={index <= 0}
                onClick={() => step(DRAWER_SECTIONS[index - 1].key)}
                aria-label="Previous section"
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={index >= DRAWER_SECTIONS.length - 1}
                onClick={() => step(DRAWER_SECTIONS[index + 1].key)}
                aria-label="Next section"
              >
                <ChevronRight size={16} />
              </Button>
              <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            {/* Keyed by section, so stepping with previous and next eases the body in. */}
            <div
              key={current.key}
              className="min-h-0 flex-1 animate-in overflow-y-auto px-7 py-6 duration-300 ease-out-expo fade-in-0 slide-in-from-right-2"
            >
              <IpasSectionChrome.Provider value={CHROME.DRAWER}>{blocks[current.key]}</IpasSectionChrome.Provider>
            </div>
            {/* The pinned footer holds the section's edit and the viewer's moves for it. */}
            {(moves.length > 0 || editable) && (
              <div className="border-t border-border bg-muted/30 px-7 py-4">
                {editable && (
                  <Button size="sm" variant="outline" className="mb-4 gap-1.5" onClick={() => onEdit(current.key)}>
                    <Pencil size={14} aria-hidden="true" />
                    Edit section
                  </Button>
                )}
                {moves.length > 0 && (
                  <ul className="grid gap-4 sm:grid-cols-2">
                    {moves.map((item) => (
                      <MoveButton
                        key={item.key}
                        move={item}
                        origin={CHROME.DRAWER}
                        disabled={busyNow}
                        busy={busyNow}
                        failure={failure}
                        onRun={runFromFooter}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
            {confirmDialog}
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
