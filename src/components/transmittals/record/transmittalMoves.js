// Everything the signed-in person may do on a Transmittal right now, as moves
// for the shared "Your move" card and the drawer's bottom bar. Only what the
// rights allow is offered, so nothing is shown that the database would
// refuse. Each move carries its consequence in one line; a sign that is not
// ready yet (an unrated line, a missing picture or name) opens its section
// instead and says what is missing.

import { Check, CircleX, Send, Undo2 } from "lucide-react";

import { TRANSMITTAL_STAGE as STAGE } from "@/constants/transmittals";
import { evidenceOf, stageRowOf, stagesOf } from "@/utils/transmittals";
import { SECTION, STAGE_TITLE, hasPoLine } from "./transmittalRecord";

/** The sign form of one stage, as the drawer body holds it. */
export const EMPTY_STAGE_FORM = {
  remarks: "",
  noPicturesReason: "",
  otherId: "",
  otherName: "",
  signAsSecond: false,
};

/** A stage whose other signatory is picked from a list; only a typed Warehouse releasing types a name. */
export function picksOtherSigner(t, stage) {
  return stage !== STAGE.WAREHOUSE_RELEASING || t.checkTechnical;
}

/** A stage where the caller may sign as either signatory. */
export function choosesSlot(stage) {
  return stage === STAGE.WAREHOUSE_CHECKING || stage === STAGE.TECHNICAL_INSPECTION;
}

/** What still stops a stage from being signed, in a sentence, or null when it is ready. */
export function stageBlocker(t, stage, form) {
  const technical = stage === STAGE.TECHNICAL_INSPECTION;
  const rated = choosesSlot(stage);
  const unrated = t.lines.filter((line) =>
    technical ? !line.techRating || !line.techInChargeId : !line.whRating || !line.whInChargeId,
  ).length;
  if (rated && unrated > 0) return `${unrated} line${unrated === 1 ? "" : "s"} still need a GC or NA rating.`;
  if (evidenceOf(t, stage).length === 0 && form.noPicturesReason.trim() === "") {
    return "Attach a picture or video, or give the reason none.";
  }
  if (picksOtherSigner(t, stage)) return form.otherId ? null : "Pick the other signatory.";
  return form.otherName.trim() ? null : "Type who received the goods.";
}

function move(key, section, { kind, icon, label, verb, confirm = true, hint, run }) {
  return { key, section, kind, icon, label, verb, confirm, hint, run };
}

/** The step after a stage, in words, for the consequence line. */
function nextAfter(t, stage) {
  const stages = stagesOf(t);
  const index = stages.indexOf(stage);
  const following = stages[index + 1];
  if (following) return `${STAGE_TITLE[following]}.`;
  if (hasPoLine(t) && !t.odooReceivedAt) return "Received in Odoo by, then Check by.";
  return "Check by.";
}

/**
 * @param {object} t        a shaped Transmittal
 * @param {object} rights   from rightsOf
 * @param {{ forms: Record<string, object>, odooRef: string, on: object }} ctx
 *   `on` has submit, signStage, confirmStage, recordOdoo, checkBy, askUndo and
 *   open, each taking `(…args, from)` where `from` is `{ key, origin }`.
 * @returns {{ moves: object[], declines: object[], undos: object[] }}
 */
export function movesFor(t, rights, { forms, odooRef, on }) {
  const moves = [];
  const declines = [];
  const undos = [];
  const undo = (key, section, label, target) =>
    undos.push(
      move(key, section, {
        kind: "return",
        icon: Undo2,
        label: `Undo ${label}`,
        verb: "Undo",
        // It asks for its reason in its own dialog.
        confirm: false,
        hint: "Clears the signature and keeps it as history with your name and the reason. Ratings, remarks and pictures stay.",
        run: (from) => on.askUndo({ ...target, label }, from),
      }),
    );

  if (rights.draft && rights.canChange) {
    moves.push(
      move("submit", SECTION.DETAILS, {
        kind: "approve",
        icon: Send,
        label: "Submit",
        verb: "Submit",
        confirm: false,
        hint:
          t.lines.length === 0
            ? "Add at least one line first."
            : "Opens the first stage and tells the people who check it. Edit is closed once it is submitted.",
        run: (from) => (t.lines.length === 0 ? on.open(SECTION.LINES) : on.submit(from)),
      }),
    );
  }

  for (const stage of stagesOf(t).concat(t.checkWarehouse && !t.checkTechnical ? [STAGE.WAREHOUSE_RELEASING] : [])) {
    const row = stageRowOf(t, stage);
    const title = STAGE_TITLE[stage];
    const signed = Boolean(row?.completed_at);
    if (!signed && rights.canSign[stage]) {
      const form = forms[stage] ?? EMPTY_STAGE_FORM;
      const blocker = stageBlocker(t, stage, form);
      moves.push(
        move(`sign-${stage}`, stage, {
          kind: "approve",
          icon: Check,
          label: `Sign ${title}`,
          verb: "Sign",
          confirm: !blocker,
          hint: blocker ?? `Records your signature and the other signatory's, who confirms it. Next: ${nextAfter(t, stage)}`,
          run: (from) => (blocker ? on.open(stage) : on.signStage(stage, form, from)),
        }),
      );
    }
    const confirming = rights.awaitingConfirm(stage);
    if (signed && confirming) {
      moves.push(
        move(`confirm-${stage}`, stage, {
          kind: "approve",
          icon: Check,
          label: `Confirm my signature on ${title}`,
          verb: "Confirm",
          hint: "Says the signature stored for you is yours.",
          run: (from) => on.confirmStage(row.id, true, from),
        }),
      );
      declines.push(
        move(`decline-${stage}`, stage, {
          kind: "return",
          icon: CircleX,
          label: `Decline my signature on ${title}`,
          verb: "Decline",
          hint: "Tells the person who signed for you that it is not yours.",
          run: (from) => on.confirmStage(row.id, false, from),
        }),
      );
    }
  }

  if (rights.canRecordOdoo) {
    moves.push(
      move(`sign-${SECTION.ODOO}`, SECTION.ODOO, {
        kind: "approve",
        icon: Check,
        label: "Sign Received in Odoo by",
        verb: "Sign",
        hint: `Records the receipt in Odoo as yours${odooRef.trim() ? ` (${odooRef.trim()})` : ""}. Next: Check by.`,
        run: (from) => on.recordOdoo(odooRef.trim(), from),
      }),
    );
  }

  for (const [slot, number] of [["first", 1], ["second", 2]]) {
    if (!rights.checkBy[slot]) continue;
    moves.push(
      move(`check-${number}`, SECTION.CHECK_BY, {
        kind: "approve",
        icon: Check,
        label: `Sign Check by (${number})`,
        verb: "Sign",
        hint: number === 2 || t.checkBy.second ? "Closes the slip and tells its preparer." : "Next: the second Check by, by someone else.",
        run: (from) => on.checkBy(number, from),
      }),
    );
  }

  for (const stage of [STAGE.WAREHOUSE_CHECKING, STAGE.WAREHOUSE_RELEASING, STAGE.TECHNICAL_INSPECTION]) {
    if (rights.undo.stage[stage]) {
      undo(`undo-${stage}`, stage, `${STAGE_TITLE[stage]} signature`, { kind: "stage", stage });
    }
  }
  if (rights.undo.odoo) {
    undo(`undo-${SECTION.ODOO}`, SECTION.ODOO, "Received in Odoo by", { kind: "odoo" });
  }
  for (const [slot, number] of [["first", 1], ["second", 2]]) {
    if (rights.undo.checkBy[slot]) {
      undo(`undo-check-${number}`, SECTION.CHECK_BY, `Check by (${number})`, { kind: "check_by", slot: number });
    }
  }

  return { moves, declines, undos };
}

/** The moves a section's bottom bar offers: the same moves as the card, for that section. */
export function footerMovesFor(built, sectionKey) {
  return [...built.moves, ...built.declines, ...built.undos].filter((item) => item.section === sectionKey);
}
