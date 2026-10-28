/** The verdict of a whole row from its parts: Deviates if any deviates, Complies if all comply, else not judged. */
export function lineVerdict(line) {
  const parts = line.components ?? [];
  if (parts.length === 0) return null;
  if (parts.some((part) => part.compliance === "deviates")) return "deviates";
  return parts.every((part) => part.compliance === "complies") ? "complies" : null;
}
