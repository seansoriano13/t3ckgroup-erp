/**
 * The Compliance Requirements line, one reading for the IPAS window and the SOR's IPAS summary
 * (#1257, spec #1247). Pure: no network, no React.
 *
 * `view` is `null` when the IPAS does not ask (older IPAS), else
 *   { state: "unanswered" | "none" | "kinds", kinds: [{ id, label, doneOn, note }], open: [...] }
 */
import { shortDay } from "./ipasSummary";

export const COMPLIANCE_LABEL = "Compliance Requirements";

/** Build the view from an `asked` flag, the answer (`needed`: true / false / null) and the kinds. */
export function complianceView({ asked, needed, kinds }) {
  if (!asked) return null;
  const shaped = (kinds ?? []).map((kind) => ({
    id: kind.id,
    label: kind.label ?? "",
    doneOn: kind.doneOn ?? null,
    note: kind.note ?? null,
  }));
  if (needed === false) return { state: "none", kinds: [], open: [] };
  if (needed !== true) return { state: "unanswered", kinds: [], open: [] };
  return { state: "kinds", kinds: shaped, open: shaped.filter((kind) => !kind.doneOn) };
}

/** The view of an IPAS record as `ipasService.get` returns it. */
export function complianceViewOfIpas(ipas) {
  const kinds = [...(ipas?.compliance_requirements ?? [])]
    .sort((a, b) => (a.kind?.sort ?? 0) - (b.kind?.sort ?? 0) || (a.kind?.label ?? "").localeCompare(b.kind?.label ?? ""))
    .map((row) => ({ id: row.id, label: row.kind?.label ?? "", doneOn: row.done_on, note: row.note }));
  return complianceView({ asked: ipas?.compliance_asked === true, needed: ipas?.compliance_needed ?? null, kinds });
}

/** The view of an SOR summary (`shapeIpasSummary(...).compliance`): no note comes with it. */
export function complianceViewOfSummary(compliance) {
  if (!compliance) return null;
  return complianceView({ asked: true, needed: compliance.needed, kinds: compliance.kinds });
}

/** What a hover on a done kind says. The SOR passes `withNote: false`. */
export function doneHover(kind, { withNote = true } = {}) {
  const day = shortDay(kind.doneOn);
  const note = withNote && kind.note ? ` · ${kind.note}` : "";
  return `Done ${day}${note}`;
}

/** Filing's warning while a kind is open or the question is unanswered; null otherwise. Never blocks. */
export function complianceWarning(view) {
  if (!view) return null;
  if (view.state === "unanswered") return `${COMPLIANCE_LABEL} not answered yet.`;
  if (view.open.length > 0) return `${COMPLIANCE_LABEL} still open: ${view.open.map((kind) => kind.label).join(", ")}.`;
  return null;
}
