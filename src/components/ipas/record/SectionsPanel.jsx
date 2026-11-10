import { useEffect, useRef } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import MoveButton from "@/components/record/MoveButton";
import InlineError from "@/components/record/InlineError";
import RecordSections from "@/components/record/RecordSections";
import { CHROME, MOVE_ORIGIN, RecordSectionChrome } from "@/components/record/sectionChrome";
import { useMoveConfirm } from "@/components/record/useMoveConfirm";
import { SECTIONS, sectionState } from "./digest";
import EditSectionBody, { EDITABLE_SECTIONS } from "./EditSectionBody";
import { canEditSection, footerMovesFor } from "./moves";
import { actionSectionFor } from "./journey";
import { scrollToSection } from "./useSectionsOpen";

/** These edit right there, in place. Every other section reads here and edits in the edit view. */
const LIVE = new Set(["delivery", "documents", "history"]);

/** No foot (Edit section, Return) on these: History only reads. */
const SECONDARY = new Set(["history"]);

// One list, numbered 1 to 6 in the order the work happens, then History.
const GROUPS = [{ sections: SECTIONS }];

/**
 * The IPAS's sections, every one a collapsible block that opens in place
 * (RecordSections). Logistics, Status and History keep their controls live;
 * the money and sign-off sections, Header and Sales read here, as the old
 * side drawer showed them, and end with the viewer's moves for the section
 * (never Submit, which is in Your move) and an Edit section button that opens
 * the edit view.
 *
 * While the page is being edited (`edit`: the form from useIpasEditForm, plus what the
 * typed bodies need), the sections that take typing show their fields in place of their
 * read lines, and a section that still has required fields says how many are left.
 *
 * `open` is the page's useSectionsOpen. On arrival the section the link names
 * (`?open=`) opens and is scrolled to; with no link, the section that needs
 * the viewer opens.
 */
export default function SectionsPanel({ ctx, blocks, digest, open, headRef, onEdit, edit = null }) {
  const { busy, failure, viewer } = ctx;
  const { param, openKeys, toggle, reveal, openAll, closeAll, autoOpen } = open;
  const actionKey = actionSectionFor(ctx.journey);

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

  // Entering edit mode opens what still needs typing, and the section it was entered from.
  const editing = Boolean(edit);
  const entry = edit?.focusKey ?? null;
  const pending = useRef(null);
  useEffect(() => {
    pending.current = edit?.progress ?? null;
  });
  useEffect(() => {
    if (!editing) return;
    for (const p of pending.current ?? []) if (p.left > 0) reveal(p.key);
    if (entry) {
      reveal(entry);
      scrollToSection(entry);
    }
  }, [editing, entry, reveal]);

  const bodyOf = (key) => {
    if (edit && EDITABLE_SECTIONS.has(key)) {
      return (
        <EditSectionBody
          sectionKey={key}
          ipas={edit.ipas}
          form={edit.form}
          set={edit.set}
          blocks={blocks}
          disabled={!edit.can.change}
          onEditPurpose={edit.onEditPurpose}
          money={{ rows: edit.rows, fresh: edit.fresh, can: edit.can, ...edit.money }}
        />
      );
    }
    return (
      <RecordSectionChrome.Provider value={LIVE.has(key) ? CHROME.INLINE : CHROME.DRAWER}>
        {blocks[key]}
      </RecordSectionChrome.Provider>
    );
  };

  const summaryOf = (key) => {
    const left = edit?.progress.find((p) => p.key === key)?.left ?? 0;
    return left > 0 ? `${left} required ${left === 1 ? "field" : "fields"} to fill` : digest.lines[key];
  };

  // The foot is for the money and sign-off sections. Header and Sales edit through the page's Edit button.
  const footerOf = (key) => {
    if (SECONDARY.has(key) || editing) return null;
    // Submit lives only in Your move; a section's foot keeps the rest and its Edit section button.
    const moves = footerMovesFor(ctx, digest, key).filter((item) => item.kind !== "prepare");
    const editable = canEditSection(key, ctx);
    // #788: a refusal of a move made in Your move (Submit) is also written on the section it is about.
    const echoed =
      failure && failure.origin !== MOVE_ORIGIN.SECTION && footerMovesFor(ctx, digest, key).some((item) => item.key === failure.key)
        ? failure
        : null;
    if (moves.length === 0 && !editable && !echoed) return null;
    return (
      <div className="mt-5 space-y-4 border-t border-border pt-4">
        {echoed && (
          <InlineError message={echoed.message} busy={busy.signoff || busy.give} onRetry={echoed.retry} onDismiss={echoed.dismiss} />
        )}
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
        summaryOf={summaryOf}
        bodyOf={bodyOf}
        footerOf={footerOf}
        headRef={headRef}
      />
      {dialog}
    </>
  );
}
