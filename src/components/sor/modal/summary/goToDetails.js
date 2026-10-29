import toast from "react-hot-toast";

export const TEAM_SECTION_ID = "sor-team-assignees";

/**
 * The Summary's "Go" link for a missing Deal Team role (#793): open the edit form if it is not open,
 * then bring the Team & Assignees block into view. Someone who cannot edit is told why.
 */
export async function goToDetails(p, scroll = defaultScroll) {
  if (!p.canEdit) {
    toast.error("You cannot edit this SOR. Ask its Deal Owner or a manager to assign the missing role.");
    return;
  }
  if (!p.ctx?.isEditing) await p.handleEditToggle();
  scroll();
}

function defaultScroll() {
  requestAnimationFrame(() =>
    document.getElementById(TEAM_SECTION_ID)?.scrollIntoView({ behavior: "smooth", block: "center" }),
  );
}
