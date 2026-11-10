import { TRACKER_STAGES, stageStates } from "../../../../utils/purchasingTracker";
import { listAge, listDate } from "../../../../utils/listDates";

/**
 * The Dashboard table's columns, sort keys and Excel sheet, kept in one place
 * so the table, the Columns menu and the export read the same list.
 */

/** Every column in order. The stage circles are not sortable; the rest are. */
export const TRACKER_COLUMNS = [
  { key: "sor", label: "SOR", locked: true },
  ...TRACKER_STAGES.map((stage) => ({ key: stage.key, label: stage.label, stage })),
  { key: "next-move", label: "Next move" },
  { key: "deadline", label: "Deadline" },
];

/** What each sortable heading sorts by (see useTableSort). */
export const TRACKER_SORT = {
  sor: (sor) => (sor.direct || sor.noSor ? sor.short : (sor.salesReference ?? sor.short)),
  "next-move": (sor) => sor.next.move?.label,
  deadline: (sor) => (sor.deadline?.dueAt ? new Date(sor.deadline.dueAt).getTime() : null),
};

const moveText = (next) => {
  const move = next.move;
  if (!move) return "Nothing open";
  const owner = move.ours ? move.ownerLabel : `waiting on ${move.ownerLabel.toLowerCase()}`;
  return `${move.label} · ${move.ref} · ${owner} · ${move.days}d`;
};

export const TRACKER_EXPORT_HEADER = [
  "SOR",
  "Name",
  ...TRACKER_STAGES.map((stage) => stage.label),
  "Next move",
  "Client deadline",
  "Age",
];

/** The SORs shown, in the order shown, as the sheet's cells. */
export function trackerExportRows(sors, today = new Date()) {
  return sors.map((sor) => [
    sor.short,
    sor.projectTitle || null,
    ...stageStates(sor).map((state) => state.n),
    moveText(sor.next),
    listDate(sor.deadline?.dueAt, today) || null,
    listAge(sor.oldest, today) || null,
  ]);
}
