import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { SECTIONS, sectionBadge, sectionDot } from "./digest";
import { Caption, Pill, StateDot } from "./parts";
import { IpasSectionChrome } from "./sectionChrome";

/**
 * One section, slid in from the right. Previous and next step through the
 * sections (replacing the URL entry, so Back still leaves the drawer). Escape
 * and Close hand focus back to the row that opened it, or to where it was
 * when the link was opened directly.
 */
export default function SectionDrawer({ ctx, blocks, digest, index, current, step, close, getRow }) {
  const { ipas } = ctx;
  // The row to return focus to. Kept while the drawer animates shut, when `current` is already gone.
  const lastKey = useRef(null);
  useEffect(() => {
    if (current) lastKey.current = current.key;
  }, [current]);

  const returnFocus = () => getRow(lastKey.current) ?? true;

  return (
    <Drawer open={Boolean(current)} onOpenChange={(next) => !next && close()}>
      <DrawerContent className="w-[920px]" finalFocus={returnFocus}>
        {current && (
          <>
            <div className="flex items-center gap-3 border-b border-border px-7 py-5">
              <div className="min-w-0 flex-1">
                <Caption>{ipas.number}</Caption>
                <div className="mt-1 flex flex-wrap items-center gap-2.5">
                  <StateDot tone={sectionDot(current.key, digest)} />
                  <DrawerTitle className="min-w-0 text-lg font-bold">{current.title}</DrawerTitle>
                  <Pill badge={sectionBadge(current.key, digest, ipas)} />
                </div>
                <DrawerDescription className="mt-0.5 text-sm">{digest.lines[current.key]}</DrawerDescription>
              </div>
              <Button
                variant="outline"
                size="icon"
                disabled={index <= 0}
                onClick={() => step(SECTIONS[index - 1].key)}
                aria-label="Previous section"
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={index >= SECTIONS.length - 1}
                onClick={() => step(SECTIONS[index + 1].key)}
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
              className="min-h-0 flex-1 animate-in overflow-y-auto px-7 py-6 duration-300 ease-out fade-in-0 slide-in-from-right-2"
            >
              <IpasSectionChrome.Provider value="bare">{blocks[current.key]}</IpasSectionChrome.Provider>
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
