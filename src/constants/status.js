/**
 * Centralized status constants to prevent magic string bugs
 * and ensure consistency across the task and sales modules.
 */

export const TASK_STATUS = {
  INCOMPLETE: "INCOMPLETE",
  AWAITING_APPROVAL: "AWAITING APPROVAL",
  COMPLETE: "COMPLETED", // Migrated: was "COMPLETE" → now "COMPLETED"
  NOT_APPROVED: "NOT APPROVED", // Standardized to match database string
  DELETED: "DELETED",
};

export const STATUS_THEME = {
  GREEN: "green",
  AMBER: "amber",
  BLUE: "blue",
  RED: "red",
  VIOLET: "violet",
  ORANGE: "orange",
  MAUVE: "mauve",
};

// Map each task status to a consistent color theme
export const TASK_STATUS_THEME = {
  [TASK_STATUS.COMPLETE]: STATUS_THEME.GREEN,
  [TASK_STATUS.INCOMPLETE]: STATUS_THEME.AMBER,
  [TASK_STATUS.AWAITING_APPROVAL]: STATUS_THEME.BLUE,
  [TASK_STATUS.NOT_APPROVED]: STATUS_THEME.RED,
  [TASK_STATUS.DELETED]: STATUS_THEME.MAUVE,
};

// Sales Opportunity Registration pipeline (Annex C.3).
// Early discovery stages read as neutral, active pursuit as blue, secured work
// as violet/orange, and terminal outcomes as green or red.
export const OPPORTUNITY_STATUS_THEME = {
  LEAD: STATUS_THEME.MAUVE,
  QUALIFIED: STATUS_THEME.AMBER,
  PROPOSAL_SUBMITTED: STATUS_THEME.BLUE,
  BID_SUBMITTED: STATUS_THEME.BLUE,
  NEGOTIATION: STATUS_THEME.VIOLET,
  AWARDED: STATUS_THEME.GREEN,
  PO_RECEIVED: STATUS_THEME.GREEN,
  PROJECT_DELIVERY: STATUS_THEME.ORANGE,
  COLLECTION: STATUS_THEME.ORANGE,
  CLOSED_WON: STATUS_THEME.GREEN,
  RETENTION: STATUS_THEME.VIOLET,
  CLOSED_LOST: STATUS_THEME.RED,
};

// Helper function to get theme
export const getStatusTheme = (status) => {
  const safeStatus = status?.toUpperCase() || "";

  if (TASK_STATUS_THEME[safeStatus]) return TASK_STATUS_THEME[safeStatus];
  if (OPPORTUNITY_STATUS_THEME[safeStatus])
    return OPPORTUNITY_STATUS_THEME[safeStatus];

  // Legacy / Other supports
  switch (safeStatus) {
    case "WON": return STATUS_THEME.GREEN;
    case "DRAFT": return STATUS_THEME.AMBER;
    case "SUBMITTED": return STATUS_THEME.BLUE;
    case "ACTIVE": return STATUS_THEME.BLUE;
    case "CANCELLED": return STATUS_THEME.RED;
    default: return STATUS_THEME.MAUVE;
  }
};

export const getStatusDotColor = (status) => {
  const theme = getStatusTheme(status);
  
  switch(theme) {
    case STATUS_THEME.GREEN: return "bg-green-9 shadow-[0_0_8px_rgba(34,197,94,0.3)]";
    case STATUS_THEME.AMBER: return "bg-amber-9 shadow-[0_0_8px_rgba(245,158,11,0.3)]";
    case STATUS_THEME.BLUE: return "bg-blue-9 shadow-[0_0_8px_rgba(59,130,246,0.3)]";
    case STATUS_THEME.RED: return "bg-red-9 shadow-[0_0_8px_rgba(239,68,68,0.3)]";
    case STATUS_THEME.VIOLET: return "bg-violet-9 shadow-[0_0_8px_rgba(139,92,246,0.3)]";
    case STATUS_THEME.ORANGE: return "bg-orange-9 shadow-[0_0_8px_rgba(249,115,22,0.3)]";
    default: return "bg-mauve-9 shadow-[0_0_8px_rgba(158,158,158,0.3)]";
  }
};

export const getStatusColorAlpha = (theme) => {
  switch(theme) {
    case STATUS_THEME.GREEN: return "bg-green-a7 shadow-green-5";
    case STATUS_THEME.AMBER: return "bg-amber-a7 shadow-amber-5";
    case STATUS_THEME.BLUE: return "bg-blue-a7 shadow-blue-5";
    case STATUS_THEME.RED: return "bg-red-a7 shadow-red-5";
    case STATUS_THEME.VIOLET: return "bg-violet-a7 shadow-violet-5";
    case STATUS_THEME.ORANGE: return "bg-orange-a7 shadow-orange-5";
    default: return "bg-mauve-a7 shadow-mauve-5";
  }
};
