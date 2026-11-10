// The required files still to attach, by the same rules as the rail checklist's "Attach the
// files" and "Fill in the charges" steps (journey.js): the digest's missing documents (needed
// before signing, proof of payment per payment) and a charge with an amount but no file.
// The edit bar (#924) counts these beside the required fields and Next empty jumps to them.

import { chargesLackingFile } from "@/utils/ipasDocuments";

/** [{ label, section }] in the order the rail lists them; `section` is where to attach it. */
export function missingRequiredFiles({ ipas, digest }) {
  const byPart = digest?.docs?.missingByPart ?? {};
  const labels = [...(byPart.purchasing ?? []), ...(byPart.finance ?? []), ...(byPart.costing ?? []), ...(byPart.filing ?? [])];
  const out = labels.map((label) => ({
    label,
    section: label.startsWith("Proof of payment") ? "payments" : "documents",
  }));
  for (const charge of chargesLackingFile(ipas)) out.push({ label: "Charge file", section: "costs", id: charge.id });
  return out;
}
