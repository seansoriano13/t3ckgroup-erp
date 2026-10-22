import { useEffect } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import MoveButton from "@/components/record/MoveButton";
import RecordSections from "@/components/record/RecordSections";
import { CHROME, MOVE_ORIGIN, RecordSectionChrome } from "@/components/record/sectionChrome";
import { useMoveConfirm } from "@/components/record/useMoveConfirm";
import { SECTIONS, sectionState } from "./digest";
import { actionSectionFor, canEditSection, footerMovesFor } from "./moves";
import { scrollToSection } from "./useSectionsOpen";

/** These edit right there, in place. Every other section reads here and edits in the edit view. */
const LIVE = new Set(["logistics", "status", "history"]);

const SECONDARY = new Set(SECTIONS.filter((section) => section.secondary).map((section) => section.key));

const GROUPS = [
  { title: "Money and sign-offs", sections: SECTIONS.filter((section) => !section.secondary) },
  { title: "Everything else", sections: SECTIONS.filter((section) => section.secondary) },
];

/**
 * The IPAS's sections, every one a collapsible block that opens in place
 * (RecordSections). Logistics, Status and History keep their controls live;
 * the money and sign-off sections, Header and Sales read here, as the old
 * side drawer showed them, and end with the viewer's moves for the section
 * (never Submit, which is in Your move) and an Edit section button that opens
 * the edit view.
 *
 * `open` is the page's useSectionsOpen. On arrival the section the link names
 * (`?open=`) opens and is scrolled to; with no link, the section that needs
 * the viewer opens.
 */
export default function SectionsPanel({ ctx, blocks, digest, open, headRef, onEdit }) {
  const { busy, failure, viewer } = ctx;
  const { param, openKeys, toggle, reveal, openAll, closeAll, autoOpen } = open;
  const actionKey = actionSectionFor(ctx, digest);

  // A link to a section (also what leaving the edit view lands on): open it and bring it into view.
  useEffect(() => {
    if (!param) return;
    reveal(param);
    scrollToSection(param);
  }, [param, reveal]);

  // No link: the section that needs the viewer opens, once. It can appear late, when the sign-off lists load.
  useEffect(() => {
    if (!param) autoOpen(actionKey);
  }, [param, actionKey, autoOpen]);

  // A move that signs asks first, restating what it signs, the same as the card does.
  const { run, dialog } = useMoveConfirm({
    restate: (section) => digest.lines[section],
    viewer,
    origin: MOVE_ORIGIN.SECTION,
  });

  const bodyOf = (key) => (
    <RecordSectionChrome.Provider value={LIVE.has(key) ? CHROME.INLINE : CHROME.DRAWER}>
      {blocks[key]}
    </RecordSectionChrome.Provider>
  );

  // The foot is for the money and sign-off sections. Header and Sales edit through the page's Edit button.
  const footerOf = (key) => {
    if (SECONDARY.has(key)) return null;
    // Submit lives only in Your move; a section's foot keeps the rest and its Edit section button.
    const moves = footerMovesFor(ctx, digest, key).filter((item) => item.kind !== "prepare");
    const editable = canEditSection(key, ctx);
    if (moves.length === 0 && !editable) return null;
    return (
      <div className="mt-5 space-y-4 border-t border-border pt-4">
        {editable && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onEdit(key)}>
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
                origin={MOVE_ORIGIN.SECTION}
                disabled={busy.signoff || busy.give}
                busy={busy.signoff || busy.give}
                failure={failure}
                onRun={run}
              />
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <>
      <RecordSections
        groups={GROUPS}
        openKeys={openKeys}
        onToggle={toggle}
        onOpenAll={openAll}
        onCloseAll={closeAll}
        stateOf={(key) => sectionState(key, digest)}
        summaryOf={(key) => digest.lines[key]}
        bodyOf={bodyOf}
        footerOf={footerOf}
        headRef={headRef}
      />
      {dialog}
    </>
  );
}
