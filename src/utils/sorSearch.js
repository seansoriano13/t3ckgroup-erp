/**
 * The one search matcher for anything that lists SORs: the IPAS list and the Costing Matrix page
 * (spec #595). Both call it, so the same words find the same rows on either page.
 *
 * A search is a case-insensitive "contains" on the SO number, the SOR number and the project name,
 * or on the SO number (or SOR number) and project written together the way Purchasing writes them
 * ("S04081 BFP Command Bus"). Runs of spaces are folded, so a double space still matches.
 */

const fold = (text) => String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The searchable texts of one SOR, including the two "number + project" writings. */
export function sorSearchFields({ salesReference, sorCode, projectTitle }) {
  const project = projectTitle ?? "";
  return [
    sorCode,
    salesReference,
    projectTitle,
    salesReference ? `${salesReference} ${project}` : null,
    sorCode ? `${sorCode} ${project}` : null,
  ];
}

/** Whether the search is (part of) this SOR number. An empty search matches nothing. */
export function matchesSorCode(search, sorCode) {
  const term = fold(search);
  return Boolean(term && sorCode && fold(sorCode).includes(term));
}

/** Whether any of the fields contains the search. An empty search matches everything. */
export function matchesSearch(search, fields) {
  const term = fold(search);
  if (!term) return true;
  return fields.some((field) => typeof field === "string" && fold(field).includes(term));
}
