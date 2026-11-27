import { shortDay } from "./ipasSummary";

/** The tooltip text for a done Compliance Requirement kind: the day, then the note unless `withNote` is false (the SOR). */
export function doneTooltipText(kind, { withNote = true } = {}) {
  const note = withNote && kind.note ? ` · ${kind.note}` : "";
  return `Done ${shortDay(kind.doneOn)}${note}`;
}
