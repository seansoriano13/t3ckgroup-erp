/**
 * The Compliance Requirements line, one reading for the IPAS window and the SOR's IPAS summary
 * (#1257, spec #1247). Pure: no network, no React.
 *
 * `view` is `null` when the IPAS does not ask (older IPAS), else
 *   { state: "unanswered" | "none" | "kinds", kinds: [{ id, kindId, label, doneOn, note }], open: [...] }
 * It is the one shape of an IPAS's compliance state: the IPAS window, Your move and the SOR summary all read it.
 */
import { IPAS_COMPLIANCE_LABEL } from "@/constants/ipas";

/** Build the view from an `asked` flag, the answer (`needed`: true / false / null) and the kinds. */
export function complianceView({ asked, needed, kinds }) {
  if (!asked) return null;
  const shaped = (kinds ?? []).map((kind) => ({
    id: kind.id,
    kindId: kind.kindId ?? null,
    label: kind.label ?? "",
    doneOn: kind.doneOn ?? null,
    note: kind.note ?? null,
    files: kind.files ?? [],
  }));
  if (needed === false) return { state: "none", kinds: [], open: [] };
  if (needed !== true) return { state: "unanswered", kinds: [], open: [] };
  return { state: "kinds", kinds: shaped, open: shaped.filter((kind) => !kind.doneOn) };
}

/** The view of an IPAS record as `ipasService.get` returns it. */
export function complianceViewOfIpas(ipas) {
  const kinds = [...(ipas?.compliance_requirements ?? [])]
    .sort((a, b) => (a.kind?.sort ?? 0) - (b.kind?.sort ?? 0) || (a.kind?.label ?? "").localeCompare(b.kind?.label ?? ""))
    .map((row) => ({
      id: row.id,
      kindId: row.kind_id,
      label: row.kind?.label ?? "",
      doneOn: row.done_on,
      note: row.note,
      // The kind's papers, oldest first (#1287). The SOR summary never carries them.
      files: [...(row.files ?? [])]
        .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
        .map((file) => ({ id: file.id, url: file.url, fileName: file.file_name })),
    }));
  return complianceView({ asked: ipas?.compliance_asked === true, needed: ipas?.compliance_needed ?? null, kinds });
}

/** Filing's warning while a kind is open or the question is unanswered; null otherwise. Never blocks. */
export function complianceWarning(view) {
  if (!view) return null;
  if (view.state === "unanswered") return `${IPAS_COMPLIANCE_LABEL} not answered yet.`;
  if (view.open.length > 0) return `${IPAS_COMPLIANCE_LABEL} still open: ${view.open.map((kind) => kind.label).join(", ")}.`;
  return null;
}
