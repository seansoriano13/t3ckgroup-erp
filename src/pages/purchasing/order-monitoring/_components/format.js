/** Small helpers both Order Monitoring views share. */

export const TABLE_HEAD_CLASS = "text-label font-bold uppercase tracking-wider";

/** A late order's row is tinted, so it reads at a glance without colouring every cell. */
export const lateRowClass = (row) => (row.late ? "bg-destructive/5 hover:bg-destructive/10" : "");
