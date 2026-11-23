// An archived SOR (#1193) is put away from the daily lists (My work, List, Board) but still counts
// in Overview, registers, dashboards and commission, and still opens. Only the daily lists call this.
export const isArchivedSor = (opportunity) => Boolean(opportunity?.archived_at);

export const withoutArchived = (opportunities) => (opportunities || []).filter((o) => !isArchivedSor(o));
